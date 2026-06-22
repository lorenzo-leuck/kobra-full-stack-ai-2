# AGENTS.md — operating manual for AI agents in this repo

This file is auto-loaded by opencode. Read it before doing anything. The detailed docs are under `.opencode/docs/`.

## What this is

A realtime, speech-to-speech AI stock assistant (3 services):

- `apps/dashboard` — React + Vite (TS). The only UI: 15-day chart, **realtime
  voice** (OpenAI Realtime over WebRTC), and a voice-triggered animation.
- `apps/agent` — Python + FastAPI. Thin service that mints **ephemeral**
  Realtime session tokens. `POST /realtime/session`, `GET /health`.
- `apps/market-service` — Node + TS. Serves the 15-day market data.
  `GET /history`, `GET /health`.

## Golden rules


3. **The voice model is `gpt-realtime-mini` over WebRTC.** Never substitute a
   plain text/chat completion model for the voice feature.
4. **Flat UI.** Match the existing card style — background
   `rgba(2,6,23,0.35)`, border `rgba(148,163,184,0.22)`. No gradients or drop
   shadows on buttons/message bubbles. Match sibling panels' title size/weight.
5. **No code comments unless explicitly requested.**
6. **Always verify before claiming done** (commands below).

## Verify your changes (do this every time)

```bash
# dashboard (type-check; build catches runtime/import issues)
cd apps/dashboard && npx tsc -b && npx vite build

# market-service
cd apps/market-service && npm run typecheck

# agent
python3 -m py_compile apps/agent/src/main.py
```

## Run it

- Dev with hot reload: `docker compose up --build` (override auto-merged).
- Production: `docker compose -f docker-compose.yml up --build`.
- See `.opencode/docs/local-dev.md` for the multi-stage / node_modules gotcha.

## Read before working on…

| Area | Doc |
| --- | --- |
| The voice assistant, WebRTC, transcripts, tool calling | `.opencode/docs/realtime-voice.md` |
| React/UI pitfalls (StrictMode, logging, ordering, style) | `.opencode/docs/frontend-gotchas.md` |
| Services, ports, endpoints, the `/history` data contract | `.opencode/docs/architecture.md` |
| Docker hot reload + verify commands | `.opencode/docs/local-dev.md` |

## Top gotchas (one-liners — full context in the docs)

- The assistant transcript also arrives on `response.output_item.done`
  (`item.content[].transcript`), not only `response.output_audio_transcript.*`.
- User-speech transcription is **off by default** — enable it with a
  `session.update` on data-channel open.
- React state updaters must be **pure**: StrictMode double-invokes them and
  silently drops messages if you mutate a ref / mint an id inside `setMessages`.
- `console.debug` is hidden at Chrome's default log level — use `console.log`
  for diagnostics.
- User speech is transcribed *after* the model starts replying — order the
  transcript by conversation sequence, not arrival time.
