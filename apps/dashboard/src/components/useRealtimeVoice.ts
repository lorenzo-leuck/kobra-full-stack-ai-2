import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, ChatRole } from "./ChatTranscript";

const AGENT_BASE = ((import.meta as any).env?.VITE_AGENT_API_BASE as string) || "http://localhost:8000";
const MARKET_BASE = ((import.meta as any).env?.VITE_MARKET_API_BASE as string) || "http://localhost:3001";

// Fixed OpenAI Realtime WebRTC endpoint (the ephemeral token is bound to a
// session that already carries the model/voice/tools — no query params needed).
const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

// Transcription model for the *user's* speech. Configured both server-side (on
// the token) and via a session.update on connect, since input transcription is
// otherwise off by default.
const INPUT_TRANSCRIBE_MODEL = "whisper-1";

export type VoiceStatus = "idle" | "connecting" | "live" | "error";

type ToolResult = Record<string, unknown> | { error: string };

async function executeTool(name: string, args: any): Promise<ToolResult> {
  if (name === "get_market_history") {
    const res = await fetch(`${MARKET_BASE}/history`);
    if (!res.ok) return { error: `history HTTP ${res.status}` };
    const j: any = await res.json();
    // Keep the payload compact for the model.
    return {
      period: j.period,
      generatedAt: j.generatedAt,
      summary: j.summary,
      series: Array.isArray(j.series)
        ? j.series.map((s: any) => ({
            symbol: s.symbol,
            first: s.first,
            last: s.last,
            changePct: s.changePct,
            trend: s.trend,
          }))
        : [],
    };
  }
  if (name === "sell_stocks") {
    window.dispatchEvent(
      new CustomEvent("sell:tool-result", {
        detail: { toolName: "sell_stocks", result: { sold: true }, timestamp: Date.now() },
      })
    );
    return { ok: true, message: "Selling the stocks — cha-ching! 💸" };
  }
  return { error: `unknown tool ${name}` };
}

export function useRealtimeVoice() {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [assistantSpeaking, setAssistantSpeaking] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Conversation ordering: assign a monotonic sequence to each message key the
  // first time we see its item (the user's committed turn appears before the
  // model's response item). Sorting by this fixes the reversed order caused by
  // the user's transcription arriving after the assistant has begun replying.
  const orderRef = useRef<Record<string, number>>({});
  const orderSeqRef = useRef(0);

  const touch = useCallback((key: string) => {
    if (orderRef.current[key] == null) {
      orderSeqRef.current += 1;
      orderRef.current[key] = orderSeqRef.current;
    }
    return orderRef.current[key];
  }, []);

  // `key` is a stable, unique id per realtime item (e.g. "asst:item_123"), so we
  // use it directly as the message id. The updater stays PURE (no refs mutated,
  // no ids generated inside it) so React StrictMode's double-invoke is safe.
  const upsert = useCallback(
    (key: string, role: ChatRole, text: string, mode: "append" | "set") => {
      const order = touch(key); // registered earlier if the item was already seen
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === key);
        if (idx >= 0) {
          const cur = prev[idx];
          const next = prev.slice();
          next[idx] = { ...cur, content: mode === "append" ? cur.content + text : text };
          return next;
        }
        return [...prev, { id: key, role, content: text, createdAt: Date.now(), order }];
      });
    },
    [touch]
  );

  const send = useCallback((obj: unknown) => {
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") {
      dc.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }, []);

  const handleEvent = useCallback(
    async (evt: any) => {
      const t: string = evt?.type || "";

      // --- User speech transcription (live) ---
      if (t === "conversation.item.input_audio_transcription.delta") {
        upsert(`user:${evt.item_id}`, "user", evt.delta ?? "", "append");
        return;
      }
      if (t === "conversation.item.input_audio_transcription.completed") {
        upsert(`user:${evt.item_id}`, "user", (evt.transcript ?? "").trim(), "set");
        return;
      }

      // Name-agnostic fallback: whenever a conversation/response item is
      // added/updated, pull any transcript/text straight off its content. This
      // keeps the panel populated regardless of which granular transcript
      // events the API emits (the assistant transcript arrives on
      // response.output_item.done; the user transcript on conversation.item.*).
      if (
        t === "conversation.item.added" ||
        t === "conversation.item.done" ||
        t === "conversation.item.created" ||
        t === "response.output_item.added" ||
        t === "response.output_item.done"
      ) {
        const item = evt.item;
        if (item && item.id) {
          // Register sequence as soon as the item exists (user-committed turn
          // appears before the model's response item) — even before its text.
          const role: ChatRole = item.role === "user" ? "user" : "assistant";
          touch(`${role === "user" ? "user" : "asst"}:${item.id}`);
        }
        if (item && Array.isArray(item.content)) {
          let text = "";
          for (const c of item.content) {
            if (typeof c?.transcript === "string") text += c.transcript;
            else if (typeof c?.text === "string") text += c.text;
            else if (typeof c?.audio?.transcript === "string") text += c.audio.transcript;
          }
          text = text.trim();
          if (text) {
            const role: ChatRole = item.role === "user" ? "user" : "assistant";
            upsert(`${role === "user" ? "user" : "asst"}:${item.id}`, role, text, "set");
          }
        }
        return;
      }

      // --- Assistant transcript (live, GA + legacy names) ---
      if (
        t === "response.output_audio_transcript.delta" ||
        t === "response.audio_transcript.delta" ||
        t === "response.output_text.delta" ||
        t === "response.text.delta"
      ) {
        setAssistantSpeaking(true);
        upsert(`asst:${evt.item_id ?? evt.response_id}`, "assistant", evt.delta ?? "", "append");
        return;
      }

      // Safety net: ensure the final assistant transcript is present even if no
      // deltas arrived (set the full text on the done event).
      if (
        t === "response.output_audio_transcript.done" ||
        t === "response.audio_transcript.done" ||
        t === "response.output_text.done" ||
        t === "response.text.done"
      ) {
        if (typeof evt.transcript === "string" && evt.transcript.trim()) {
          upsert(`asst:${evt.item_id ?? evt.response_id}`, "assistant", evt.transcript, "set");
        } else if (typeof evt.text === "string" && evt.text.trim()) {
          upsert(`asst:${evt.item_id ?? evt.response_id}`, "assistant", evt.text, "set");
        }
        return;
      }

      // --- Lifecycle ---
      if (t === "response.created") {
        setAssistantSpeaking(true);
        return;
      }
      if (t === "response.done") {
        setAssistantSpeaking(false);
        return;
      }

      // --- Tool / function calling ---
      if (t === "response.function_call_arguments.done") {
        const name: string = evt.name;
        const callId: string = evt.call_id;
        let args: any = {};
        try {
          args = evt.arguments ? JSON.parse(evt.arguments) : {};
        } catch {
          args = {};
        }
        let result: ToolResult;
        try {
          result = await executeTool(name, args);
        } catch (e: any) {
          result = { error: e?.message || "tool failed" };
        }
        send({
          type: "conversation.item.create",
          item: { type: "function_call_output", call_id: callId, output: JSON.stringify(result) },
        });
        send({ type: "response.create" });
        return;
      }

      if (t === "error") {
        const msg = evt?.error?.message || "Realtime error";
        setError(msg);
        return;
      }
    },
    [send, upsert, touch]
  );

  const stop = useCallback(() => {
    try {
      dcRef.current?.close();
    } catch {
      /* ignore */
    }
    try {
      pcRef.current?.getSenders().forEach((s) => s.track?.stop());
      pcRef.current?.close();
    } catch {
      /* ignore */
    }
    try {
      micRef.current?.getTracks().forEach((tr) => tr.stop());
    } catch {
      /* ignore */
    }
    dcRef.current = null;
    pcRef.current = null;
    micRef.current = null;
    setAssistantSpeaking(false);
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    if (status === "connecting" || status === "live") return;
    setError(null);
    setStatus("connecting");
    try {
      // 1) Mint an ephemeral session token from our backend.
      const tokenRes = await fetch(`${AGENT_BASE}/realtime/session`, { method: "POST" });
      if (!tokenRes.ok) throw new Error(`session HTTP ${tokenRes.status}`);
      const tokenJson: any = await tokenRes.json();
      const ephemeralKey: string = tokenJson?.value ?? tokenJson?.client_secret?.value;
      if (!ephemeralKey) throw new Error("no ephemeral key in session response");

      // 2) Peer connection + remote audio playback.
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      if (!audioRef.current) {
        const el = document.createElement("audio");
        el.autoplay = true;
        audioRef.current = el;
      }
      pc.ontrack = (e) => {
        if (audioRef.current) audioRef.current.srcObject = e.streams[0];
      };

      // 3) Microphone input.
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      micRef.current = mic;
      mic.getTracks().forEach((track) => pc.addTrack(track, mic));

      // 4) Data channel for events.
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.addEventListener("open", () => {
        setStatus("live");
        // Force-enable live transcription of the user's speech + server VAD.
        // (Input transcription is off unless explicitly configured.)
        try {
          dc.send(
            JSON.stringify({
              type: "session.update",
              session: {
                type: "realtime",
                output_modalities: ["audio"],
                audio: {
                  input: {
                    transcription: { model: INPUT_TRANSCRIBE_MODEL },
                    turn_detection: { type: "server_vad", create_response: true, interrupt_response: true },
                  },
                },
              },
            })
          );
        } catch {
          /* ignore */
        }
      });
      dc.addEventListener("message", (e) => {
        let parsed: any;
        try {
          parsed = JSON.parse(e.data);
        } catch {
          return;
        }
        if ((import.meta as any).env?.DEV) console.log("[realtime]", parsed?.type, parsed);
        void handleEvent(parsed);
      });

      pc.addEventListener("connectionstatechange", () => {
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          setError("connection lost");
          stop();
        }
      });

      // 5) SDP offer/answer with the Realtime API (ephemeral-authenticated).
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch(REALTIME_CALLS_URL, {
        method: "POST",
        body: offer.sdp,
        headers: { Authorization: `Bearer ${ephemeralKey}`, "Content-Type": "application/sdp" },
      });
      if (!sdpRes.ok) throw new Error(`realtime SDP HTTP ${sdpRes.status}`);
      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (e: any) {
      setError(e?.message || "failed to start voice session");
      setStatus("error");
      stop();
    }
  }, [status, handleEvent, stop]);

  useEffect(() => stop, [stop]);

  return { status, error, messages, assistantSpeaking, start, stop };
}
