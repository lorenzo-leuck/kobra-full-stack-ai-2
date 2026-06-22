import { useCallback, useEffect, useState, type CSSProperties } from "react";
import HistoryChart, { type HistoryPayload } from "./HistoryChart";
import ChatTranscript from "./ChatTranscript";
import SellAnimationPanel from "./SellAnimationPanel";
import { useRealtimeVoice } from "./useRealtimeVoice";

const MARKET_BASE = ((import.meta as any).env?.VITE_MARKET_API_BASE as string) || "http://localhost:3001";

export default function App() {
  const [history, setHistory] = useState<HistoryPayload | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const voice = useRealtimeVoice();

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch(`${MARKET_BASE}/history`);
      if (!res.ok) throw new Error(`history HTTP ${res.status}`);
      const json: HistoryPayload = await res.json();
      setHistory(json);
    } catch (e: any) {
      setHistoryError(e?.message || "failed to load history");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // ---- 15-day daily history (market-service /history) ----
  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const live = voice.status === "live";
  const connecting = voice.status === "connecting";

  const micLabel = live ? "Stop" : connecting ? "Connecting…" : "Talk";

  const card: CSSProperties = {
    borderRadius: 16,
    border: "1px solid rgba(148,163,184,0.22)",
    background: "rgba(2,6,23,0.35)",
    padding: 16,
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(1100px 600px at 20% -10%, rgba(124,58,237,0.25), rgba(2,6,23,0) 60%), radial-gradient(900px 550px at 95% 0%, rgba(59,130,246,0.22), rgba(2,6,23,0) 50%), #020617",
        color: "rgba(226,232,240,0.92)",
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
        padding: 18,
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ marginBottom:5, fontSize: 12, color: "rgba(226,232,240,0.7)" }}>Lorenzo Leuck</div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>AI Finance Dashboard</div>
          </div>
          <div style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>

          </div>
        </header>

        {/* Row 1: chart, full width */}
        <div style={card}>
          <HistoryChart data={history} loading={historyLoading} error={historyError} />
        </div>

        {/* Row 2: chat things + animation panel */}
        <div className="kobra-row2">
          <section style={{ ...card, display: "grid", gap: 12, minHeight: 460 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 750, lineHeight: 1.1, color: "rgba(255,255,255,0.92)" }}>Assistant</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  onClick={() => (live || connecting ? voice.stop() : voice.start())}
                  disabled={connecting}
                  style={{
                    cursor: connecting ? "wait" : "pointer",
                    padding: "10px 16px",
                    borderRadius: 999,
                    border: "1px solid rgba(148,163,184,0.25)",
                    background: live ? "rgba(239,68,68,0.28)" : "rgba(124,58,237,0.32)",
                    color: "rgba(243,244,246,0.98)",
                    fontWeight: 800,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: 999,
                      background: live ? "#fca5a5" : "rgba(226,232,240,0.9)",
                    }}
                  />
                  {micLabel}
                </button>
              </div>
            </div>

            <div style={{ flex: 1, height: 360, border: "1px solid rgba(148,163,184,0.2)", borderRadius: 12, overflow: "hidden" }}>
              <ChatTranscript messages={voice.messages} isStreaming={voice.assistantSpeaking} />
            </div>
          </section>

          <SellAnimationPanel />
        </div>
      </div>
    </div>
  );
}
