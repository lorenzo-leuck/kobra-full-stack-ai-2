# Architecture

Three single-purpose services. The browser is the only place with a UI; the two
backends are headless.

## Services

| Service | Lang | Endpoints | Notes |
| --- | --- | --- | --- |
| `apps/dashboard` | React/Vite/TS | n/a (SPA on `:3000`) | Chart, voice hook, animation. |
| `apps/agent` | Python/FastAPI | `POST /realtime/session`, `GET /health` (`:8000`) | Only mints tokens; OpenAI key stays here. |
| `apps/market-service` | Node/TS | `GET /history`, `GET /health` (`:3001`) | Fetches + shapes market data; ~5 min cache. |

## The `/history` data contract (single source of truth)

One JSON structure drives **both** the chart and the agent. Don't fork it.

```jsonc
{
  "generatedAt": 1719000000000,
  "period": "15d", "interval": "1day",
  "symbols": ["AAPL","MSFT","TSLA","NVDA","AMZN"],
  "dates": ["2026-06-05", … 15 …],           // shared chronological x-axis
  "series": [
    { "symbol": "AAPL", "currency": "USD",
      "closes": [..15.. | null],             // aligned to `dates`; null = gap
      "first": 195.1, "last": 210.3,
      "changePct": 7.8, "trend": "up" }
  ],
  "summary": {
    "bestPerformer": "NVDA", "worstPerformer": "TSLA",
    "ranking": [ { "symbol": "NVDA", "changePct": 12.3 }, … ]  // sorted desc
  }
}
```

- Chart: iterate `series`, plot `closes` against `dates` (normalized to %
  change from day 0 so symbols at different price scales are comparable).
- Agent: read `summary.ranking` / per-series `changePct` to answer
  "which to buy / which rose most" with no math.

## Why each technology

- **Node/TS for market-service** — pure async I/O fan-out (Twelve Data) + JSON
  shaping + caching; no CPU work; shares the data-model type with the React app.
- **Python/FastAPI for agent** — idiomatic AI backend; async + httpx; kept thin
  so the OpenAI key never reaches the browser (ephemeral-token pattern).
- **WebRTC (not WebSocket)** — browser-native audio capture/playback, jitter
  buffering, echo cancellation, low latency; data channel carries JSON events.

