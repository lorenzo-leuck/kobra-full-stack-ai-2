import React, { useMemo, useRef, useState } from "react";

export type HistorySeries = {
  symbol: string;
  currency?: string;
  closes: (number | null)[];
  first?: number;
  last?: number;
  min?: number;
  max?: number;
  changeAbs?: number;
  changePct?: number;
  trend: "up" | "down" | "flat";
};

export type HistoryPayload = {
  generatedAt: number;
  period: string;
  interval: string;
  symbols: string[];
  dates: string[];
  series: HistorySeries[];
  summary: {
    bestPerformer: string | null;
    worstPerformer: string | null;
    ranking: Array<{ symbol: string; changePct: number | null; last?: number }>;
  };
};

type HistoryChartProps = {
  data: HistoryPayload | null;
  loading?: boolean;
  error?: string | null;
};

const COLORS = ["#a78bfa", "#22d3ee", "#34d399", "#f472b6", "#f59e0b", "#60a5fa", "#fb7185"];

function fmtPct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

/**
 * 15-day, multi-symbol chart. Each series is normalized to its percent change
 * from the first day so all symbols share one y-axis and "which rose most" is
 * visually obvious. The parent owns the data (single /history payload).
 */
export default function HistoryChart({ data, loading, error }: HistoryChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const dims = { w: 860, h: 180, padL: 48, padR: 16, padT: 16, padB: 28 };
  const plotW = dims.w - dims.padL - dims.padR;
  const plotH = dims.h - dims.padT - dims.padB;

  const model = useMemo(() => {
    const dates = data?.dates ?? [];
    const n = dates.length;

    const lines = (data?.series ?? []).map((s, i) => {
      const base = s.closes.find((c): c is number => c != null);
      const pct = s.closes.map((c) => (c != null && base ? (c / base - 1) * 100 : null));
      return { symbol: s.symbol, changePct: s.changePct, color: COLORS[i % COLORS.length], pct };
    });

    let minY = 0;
    let maxY = 0;
    for (const l of lines) {
      for (const v of l.pct) {
        if (v == null) continue;
        if (v < minY) minY = v;
        if (v > maxY) maxY = v;
      }
    }
    if (minY === maxY) {
      minY -= 1;
      maxY += 1;
    } else {
      const pad = (maxY - minY) * 0.1;
      minY -= pad;
      maxY += pad;
    }

    const xAt = (idx: number) => dims.padL + (n <= 1 ? plotW / 2 : (idx / (n - 1)) * plotW);
    const yAt = (v: number) => dims.padT + (1 - (v - minY) / (maxY - minY || 1)) * plotH;

    const paths = lines.map((l) => {
      let d = "";
      let started = false;
      l.pct.forEach((v, idx) => {
        if (v == null) {
          started = false;
          return;
        }
        const xx = xAt(idx);
        const yy = yAt(v);
        d += !started ? `M ${xx.toFixed(2)} ${yy.toFixed(2)}` : ` L ${xx.toFixed(2)} ${yy.toFixed(2)}`;
        started = true;
      });
      return { ...l, d };
    });

    const grid: { y: number; v: number }[] = [];
    for (let i = 0; i <= 4; i++) {
      const v = maxY - (i / 4) * (maxY - minY);
      grid.push({ y: yAt(v), v });
    }

    return { dates, n, paths, grid, xAt, yAt };
  }, [data, plotW, plotH]);

  const onMouseMove: React.MouseEventHandler<HTMLDivElement> = (e) => {
    const el = containerRef.current;
    if (!el || model.n === 0) return;
    const rect = el.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * dims.w;
    const ratio = (mx - dims.padL) / (plotW || 1);
    const idx = Math.round(ratio * (model.n - 1));
    setHoverIdx(Math.max(0, Math.min(model.n - 1, idx)));
  };

  const ranking = data?.summary?.ranking ?? [];
  const hoverDate = hoverIdx != null ? model.dates[hoverIdx] : null;

  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <div style={{ fontWeight: 700 }}>
          Stock Prices
        </div>
        <div style={{ fontSize: 12, color: "rgba(226,232,240,0.7)" }}>
          {loading ? "loading…" : error ? "error" : ""}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        {model.paths.map((l) => (
          <div key={l.symbol} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <span style={{ width: 12, height: 3, borderRadius: 2, background: l.color, display: "inline-block" }} />
            <span style={{ fontWeight: 700 }}>{l.symbol}</span>
            <span
              style={{
                color: (l.changePct ?? 0) >= 0 ? "#34d399" : "#f87171",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {fmtPct(l.changePct)}
            </span>
          </div>
        ))}
      </div>

      <div
        ref={containerRef}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
        style={{
          width: "100%",
          overflow: "hidden",
          borderRadius: 12,
          border: "1px solid rgba(148,163,184,0.30)",
          background: "linear-gradient(180deg, rgba(15,23,42,0.35) 0%, rgba(15,23,42,0.12) 100%)",
        }}
      >
        <svg width="100%" viewBox={`0 0 ${dims.w} ${dims.h}`} preserveAspectRatio="none" role="img" aria-label="15-day performance chart">
          {model.grid.map((g, i) => (
            <g key={i}>
              <line
                x1={dims.padL}
                x2={dims.w - dims.padR}
                y1={g.y}
                y2={g.y}
                stroke={Math.abs(g.v) < 1e-9 ? "rgba(148,163,184,0.45)" : "rgba(148,163,184,0.18)"}
                strokeDasharray="4 4"
              />
              <text x={dims.padL - 8} y={g.y + 4} fill="rgba(148,163,184,0.9)" fontSize="11" textAnchor="end">
                {`${g.v >= 0 ? "+" : ""}${g.v.toFixed(1)}%`}
              </text>
            </g>
          ))}

          {model.n === 0 ? (
            <text x={dims.padL + plotW / 2} y={dims.padT + plotH / 2} fill="rgba(148,163,184,0.85)" fontSize="12" textAnchor="middle">
              {loading ? "Loading 15-day history…" : error ? error : "No history yet"}
            </text>
          ) : (
            model.paths.map((l) =>
              l.d ? <path key={l.symbol} d={l.d} fill="none" stroke={l.color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" /> : null
            )
          )}

          {hoverIdx != null && model.n > 0 ? (
            <>
              <line x1={model.xAt(hoverIdx)} x2={model.xAt(hoverIdx)} y1={dims.padT} y2={dims.padT + plotH} stroke="rgba(148,163,184,0.35)" strokeDasharray="4 4" />
              {model.paths.map((l) => {
                const v = l.pct[hoverIdx];
                if (v == null) return null;
                return <circle key={l.symbol} cx={model.xAt(hoverIdx)} cy={model.yAt(v)} r={3.5} fill={l.color} />;
              })}
            </>
          ) : null}
        </svg>
      </div>

      {hoverDate ? (
        <div style={{ marginTop: 8, fontSize: 12, color: "rgba(226,232,240,0.85)" }}>
          <span style={{ fontWeight: 700 }}>{hoverDate}</span>
          {"  "}
          {model.paths.map((l) => {
            const v = hoverIdx != null ? l.pct[hoverIdx] : null;
            return (
              <span key={l.symbol} style={{ marginLeft: 10, color: l.color }}>
                {l.symbol} {fmtPct(v)}
              </span>
            );
          })}
        </div>
      ) : (
        <div style={{ marginTop: 8, fontSize: 12, color: "rgba(226,232,240,0.75)" }}>
          {ranking.length ? (
            <>
              Top mover: <b>{ranking[0]?.symbol}</b> {fmtPct(ranking[0]?.changePct)} · Weakest:{" "}
              <b>{ranking[ranking.length - 1]?.symbol}</b> {fmtPct(ranking[ranking.length - 1]?.changePct)}
            </>
          ) : (
            "—"
          )}
        </div>
      )}
    </div>
  );
}
