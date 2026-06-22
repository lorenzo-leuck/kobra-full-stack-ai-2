# Realtime voice (OpenAI Realtime over WebRTC)

Read it fully before touching
`apps/dashboard/src/components/useRealtimeVoice.ts` or the agent's
`/realtime/session`.

Reference docs:
- WebRTC: <https://platform.openai.com/docs/guides/realtime-webrtc>
- Conversations / events: <https://platform.openai.com/docs/guides/realtime-conversations>

## The model is `gpt-realtime-mini` (GA), speech-to-speech, over WebRTC

The Realtime model does speech-in **and** speech-out natively. You do **not**
need a separate Whisper upload endpoint or a TTS call. `whisper-1` is only the
*input transcription* model configured inside the session.

## Connection flow (GA — no `OpenAI-Beta` header)

1. Browser `POST {AGENT_BASE}/realtime/session` → the agent calls
   `POST {OPENAI_BASE_URL}/realtime/client_secrets` with the standard key and
   returns the JSON. The browser uses `json.value` (an `ek_...` ephemeral key).
   The key/voice/tools/prompt are bound to the token server-side.
2. Browser WebRTC:
   - `new RTCPeerConnection()`; `pc.ontrack` → play `e.streams[0]`.
   - `getUserMedia({audio:true})`; add the track.
   - `pc.createDataChannel("oai-events")`.
   - `createOffer` → `setLocalDescription` → `POST https://api.openai.com/v1/realtime/calls`
     with `Authorization: Bearer <ephemeral>` and `Content-Type: application/sdp`,
     body = `offer.sdp`. The response text is the answer SDP → `setRemoteDescription`.
   - No `?model=` on `/calls` — the model is bound to the token.

## Server-side session config (`/realtime/session`)

```jsonc
{ "session": {
  "type": "realtime",
  "model": "gpt-realtime-mini",
  "instructions": "<prompt that maps intents → tools, forbids inventing prices>",
  "audio": {
    "input":  { "transcription": { "model": "whisper-1" } },
    "output": { "voice": "marin" }
  },
  "tools": [ /* get_market_history, sell_stocks — JSON-Schema params */ ]
}}
```

## Events to handle on the data channel — and the traps

### Assistant transcript (THE trap)

The streamed transcript arrives as `response.output_audio_transcript.delta` /
`.done`, **but the final assistant text is also delivered on
`response.output_item.done` inside `item.content[].transcript`**. Early on, only
the `response.output_audio_transcript.*` names were handled and the assistant
text never showed. Handle a name-agnostic fallback that reads transcript/text
straight off the item content for `conversation.item.*` **and**
`response.output_item.added/done`.

### User transcription is OFF by default

You only get `conversation.item.input_audio_transcription.delta/.completed` if
input transcription is enabled. Binding it on the token alone proved unreliable —
**also send a `session.update` when the data channel opens**:

```ts
dc.addEventListener("open", () => {
  dc.send(JSON.stringify({ type: "session.update", session: {
    type: "realtime",
    audio: { input: {
      transcription: { model: "whisper-1" },
      turn_detection: { type: "server_vad" },
    }},
  }}));
});
```

### Tool-calling loop

```ts
if (evt.type === "response.function_call_arguments.done") {
  const result = await executeTool(evt.name, JSON.parse(evt.arguments || "{}"));
  send({ type: "conversation.item.create",
         item: { type: "function_call_output", call_id: evt.call_id,
                 output: JSON.stringify(result) } });
  send({ type: "response.create" });
}
```

Tools run in the **browser**: `get_market_history` → `GET /history`;
`sell_stocks` → `window.dispatchEvent(new CustomEvent("sell:tool-result", …))`
which the animation panel listens for.

### Transcript ordering

User speech is transcribed (Whisper) *after* the model has already started
replying, so sorting messages by arrival time puts the assistant first. The API
emits the user's committed item **before** the model's response item — assign a
monotonic sequence the first time each item id is seen and sort by that.

## Diagnosing

`console.debug` is hidden at Chrome's default log level. Log event types with
`console.log("[realtime]", evt.type, evt)` while debugging.
