import React, { useEffect, useMemo, useRef } from "react";

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt?: number; // optional epoch ms
  order?: number; // optional conversation sequence index (preferred for sorting)
  meta?: {
    tool?: string;
    hiToolResult?: unknown;
  };
};

type ChatTranscriptProps = {
  messages: ChatMessage[];
  isStreaming?: boolean;
  className?: string;

  onRequestClear?: () => void;
  onRetryLast?: () => void;

  /**
   * Optional: if you have a top-level controller that triggers tool animations,
   * you can pass a callback when a tool result is detected.
   */
  onToolHiResult?: (result: unknown) => void;
};

function formatTime(ts?: number) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function roleLabel(role: ChatRole) {
  switch (role) {
    case "user":
      return "You";
    case "assistant":
      return "Assistant";
    case "system":
      return "System";
    default:
      return role;
  }
}

export default function ChatTranscript({
  messages,
  isStreaming,
  className,
  onRequestClear,
  onRetryLast,
  onToolHiResult,
}: ChatTranscriptProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const prevLastToolRef = useRef<string | null>(null);

  const sortedMessages = useMemo(() => {
    // Prefer the conversation sequence (order) when present, since transcript
    // timestamps can arrive out of order (user transcription lands late).
    const hasOrder = messages.some((m) => typeof m.order === "number");
    if (hasOrder) {
      return [...messages].sort((a, b) => {
        const ao = typeof a.order === "number" ? a.order : Number.MAX_SAFE_INTEGER;
        const bo = typeof b.order === "number" ? b.order : Number.MAX_SAFE_INTEGER;
        return ao - bo;
      });
    }

    // Otherwise fall back to chronological order if createdAt exists.
    const hasCreatedAt = messages.some((m) => typeof m.createdAt === "number");
    if (!hasCreatedAt) return messages;

    return [...messages].sort((a, b) => {
      const at = a.createdAt ?? 0;
      const bt = b.createdAt ?? 0;
      return at - bt;
    });
  }, [messages]);

  useEffect(() => {
    // Auto-scroll to bottom when new messages arrive or while streaming.
    // Keep it simple and always scroll for dashboard chat.
    const el = containerRef.current;
    if (!el) return;

    // Use rAF for layout consistency
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [sortedMessages.length, isStreaming]);

  useEffect(() => {
    if (!onToolHiResult) return;

    // Detect last message with hiToolResult or meta.tool === 'hi'
    const last = sortedMessages[sortedMessages.length - 1];
    if (!last) return;

    const result = last.meta?.hiToolResult ?? null;
    const tool = last.meta?.tool;

    // Generate a signature to avoid repeated triggers on the same message
    const signature = `${last.id}:${tool ?? "hi"}:${typeof result === "string" ? result : JSON.stringify(result ?? "")}`;
    if (prevLastToolRef.current === signature) return;

    if (last.role === "assistant" && (tool === "hi" || result !== null)) {
      prevLastToolRef.current = signature;
      onToolHiResult(result);
    }
  }, [sortedMessages, onToolHiResult]);

  const showToolbar = Boolean(onRequestClear || onRetryLast);

  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {showToolbar ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "10px 12px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(0,0,0,0.12)",
          }}
        >
          <div style={{ fontWeight: 700, letterSpacing: 0.2 }}>Transcript</div>
          <div style={{ display: "flex", gap: 8 }}>
            {onRetryLast ? (
              <button
                type="button"
                onClick={onRetryLast}
                style={{
                  cursor: "pointer",
                  borderRadius: 10,
                  padding: "8px 10px",
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(255,255,255,0.06)",
                  color: "rgba(255,255,255,0.92)",
                }}
              >
                Retry
              </button>
            ) : null}
            {onRequestClear ? (
              <button
                type="button"
                onClick={onRequestClear}
                style={{
                  cursor: "pointer",
                  borderRadius: 10,
                  padding: "8px 10px",
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(255,255,255,0.06)",
                  color: "rgba(255,255,255,0.92)",
                }}
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px 12px 16px 12px",
          scrollbarGutter: "stable",
        }}
      >


        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sortedMessages.map((m) => {
            const isUser = m.role === "user";
            const isSystem = m.role === "system";
            const bubbleBg = isUser
              ? "rgba(84,122,255,0.20)"
              : isSystem
                ? "rgba(255,255,255,0.06)"
                : "rgba(255,255,255,0.06)";

            const border = isUser ? "rgba(84,122,255,0.55)" : "rgba(255,255,255,0.12)";

            return (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  justifyContent: isUser ? "flex-end" : "flex-start",
                }}
              >
                <div
                  style={{
                    maxWidth: "82%",
                    borderRadius: 16,
                    padding: "10px 12px",
                    background: bubbleBg,
                    border: `1px solid ${border}`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.9)" }}>
                      {roleLabel(m.role)}
                    </div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>{formatTime(m.createdAt)}</div>
                  </div>

                  <div
                    style={{
                      marginTop: 6,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      lineHeight: 1.45,
                      color: "rgba(255,255,255,0.94)",
                    }}
                  >
                    {m.content}
                  </div>

                  {m.meta?.tool ? (
                    <div style={{ marginTop: 8, fontSize: 11, color: "rgba(255,255,255,0.6)" }}>
                      Tool: {m.meta.tool}
                    </div>
                  ) : null}

                  {m.meta?.hiToolResult !== undefined ? (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ cursor: "pointer", fontSize: 11, color: "rgba(255,255,255,0.7)" }}>
                        Tool result
                      </summary>
                      <pre
                        style={{
                          marginTop: 8,
                          marginBottom: 0,
                          padding: 10,
                          borderRadius: 12,
                          border: "1px solid rgba(255,255,255,0.12)",
                          background: "rgba(0,0,0,0.25)",
                          overflowX: "auto",
                          color: "rgba(255,255,255,0.86)",
                          fontSize: 11,
                          lineHeight: 1.35,
                        }}
                      >
                        {typeof m.meta.hiToolResult === "string"
                          ? m.meta.hiToolResult
                          : JSON.stringify(m.meta.hiToolResult, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </div>
              </div>
            );
          })}

          {isStreaming ? (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div
                style={{
                  maxWidth: "82%",
                  borderRadius: 16,
                  padding: "10px 12px",
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.9)" }}>Assistant</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 999,
                      background: "rgba(255,255,255,0.7)",
                      animation: "pulseDot 1.1s infinite ease-in-out",
                    }}
                  />
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 999,
                      background: "rgba(255,255,255,0.7)",
                      animation: "pulseDot 1.1s infinite ease-in-out 0.12s",
                    }}
                  />
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 999,
                      background: "rgba(255,255,255,0.7)",
                      animation: "pulseDot 1.1s infinite ease-in-out 0.24s",
                    }}
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <style>
        {`
          @keyframes pulseDot {
            0% { transform: translateY(0px); opacity: 0.55; }
            50% { transform: translateY(-2px); opacity: 1; }
            100% { transform: translateY(0px); opacity: 0.55; }
          }
        `}
      </style>
    </div>
  );
}