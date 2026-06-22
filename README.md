# Kobra Full-Stack AI 2

A voice-controlled financial dashboard powered by an AI assistant that analyzes data in real time.

<img src="https://img.shields.io/badge/React-v18.2.0-61DAFB?style=for-the-badge&logo=react&logoColor=white" alt="React" />  

<img src="https://img.shields.io/badge/TypeScript-v5.2.2-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />  

<img src="https://img.shields.io/badge/FastAPI-v0.110.0-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI" />  

<img src="https://img.shields.io/badge/Python-3.11+-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python 3.11+" />  

<img src="https://img.shields.io/badge/Node.js-v20-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />  

<img src="https://img.shields.io/badge/Vite-v5.2.0-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />  

<img src="https://img.shields.io/badge/WebRTC-Standard-333333?style=for-the-badge&logo=webrtc&logoColor=white" alt="WebRTC" />  

<img src="https://img.shields.io/badge/OpenAI_Realtime-API-412991?style=for-the-badge&logo=openai&logoColor=white" alt="OpenAI Realtime API" />

<img src="https://img.shields.io/badge/Docker-latest-2CA5E0?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" />

# Setup

## Requirements

- Docker and Docker Compose (recommended)
- Node.js 20+ (for local development)
- Python 3.11+ (for local development)
- OpenAI API key (with Realtime API access)
- Twelve Data API key

## Docker Compose

The project is containerized using Docker with separate services:

1. **Dashboard (React + Vite)**: Served on port `3000`
2. **Market Service (Node.js)**: Runs on port `3001`
3. **Agent (FastAPI)**: Runs on port `8000`

```bash
cp .env.example .env
# Edit .env with your keys
docker compose up --build
```

Access the dashboard at http://localhost:3000

### Environment Variables

Create a `.env` file in the project root with:

```env
OPENAI_API_KEY=your_openai_api_key
TWELVE_DATA_API_KEY=your_twelvedata_api_key
REALTIME_MODEL=gpt-realtime-mini
REALTIME_VOICE=marin
REALTIME_TRANSCRIBE_MODEL=whisper-1
SYMBOLS=AAPL,MSFT,TSLA,NVDA,AMZN
HISTORY_DAYS=15
```

# Architecture

This project demonstrates a complete AI voice orchestration loop: transcribe > reason > call tool > observe result > continue, over a single Realtime session.

## Agent (Python/FastAPI)

The Python service acts as the security boundary and prompt manager.

### Why Python + FastAPI?

Python is the lingua franca of AI tooling, and FastAPI provides asynchronous support + OpenAPI with almost no boilerplate. The agent is deliberately **thin**: its only job is to mint ephemeral credentials so the OpenAI API key never ships to the browser, adhering to the recommended security pattern for browser Realtime clients.

### Ephemeral Token Minting

The browser asks the agent for a short-lived token bound to a fully-configured session (model, prompt, tools). The actual API key never leaves the server.

```python
# apps/agent/src/main.py
@app.post("/realtime/session")
async def realtime_session():
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not set")

    session_config = {"session": {
        "type": "realtime",
        "model": REALTIME_MODEL,                 # gpt-realtime-mini
        "instructions": REALTIME_INSTRUCTIONS,
        "tools": REALTIME_TOOLS,
    }}

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{OPENAI_BASE_URL}/realtime/client_secrets",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            json=session_config,
        )
    return resp.json()   # -> { "value": "ek_...", ... }  (browser uses .value)
```

## Market Service (Node.js/TS)

A pure asynchronous I/O service built with Node.js and TypeScript.

### Why Node + TypeScript?

This service is purely I/O bound: it fans out to the Twelve Data API for multiple symbols, shapes the responses, and caches them. There is no CPU-bound work, making Node's event loop ideal—concurrent outbound HTTP with `Promise.allSettled` allows a fast cold start and tiny memory footprint. Using TypeScript also lets the service share the exact data-model shape with the React frontend so the chart and API never drift.

### Data Fetching & Shaping

The service aligns every symbol onto a shared chronological date axis, ranking the best/worst performers. This single JSON structure drives both the UI chart and the LLM's understanding of the market.

```typescript
// apps/market-service/src/index.ts (abridged)
const results = await Promise.allSettled(SYMBOLS.map((s) => twelvedataTimeSeries(s, days)));
const dates = [...allDates].sort().slice(-days);            // shared, chronological axis

const series = SYMBOLS.map((symbol) => {
  const closes = dates.map((d) => bySymbol.get(symbol)?.get(d) ?? null);
  const present = closes.filter((c): c is number => c != null);
  const [first, last] = [present[0], present.at(-1)];
  const changePct = first ? ((last - first) / first) * 100 : undefined;
  
  return { symbol, closes, first, last, changePct, trend: classify(changePct) };
});
```

## Dashboard (React/Vite)

The user interface for the realtime stock chart and WebRTC voice session.

### Why React + Vite?

React provides robust component state management crucial for synchronizing the live stock chart with the fast-changing voice interaction data. Running tool calls directly in the client keeps the loop low-latency, letting the agent trigger UI animations directly (like a cash-out visual effect) without an extra server hop.

### WebRTC Bootstrap & Tool-Calling Loop

The frontend mints the ephemeral token, wires up audio tracks natively in the browser, and opens the "oai-events" data channel.

```typescript
// apps/dashboard/src/components/useRealtimeVoice.ts
const { value: ephemeralKey } = await (await fetch(`${AGENT_BASE}/realtime/session`, { method: "POST" })).json();

const pc = new RTCPeerConnection();
pc.ontrack = (e) => { audioEl.srcObject = e.streams[0]; };          // model speech out

const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
mic.getTracks().forEach((track) => pc.addTrack(track, mic));        // user speech in

const dc = pc.createDataChannel("oai-events");                      // JSON events
// ... SDP exchange ...
```

When the model calls a tool over the data channel, the browser runs it (e.g. fetches market history) and returns the result back to the model over the same channel:

```typescript
if (evt.type === "response.function_call_arguments.done") {
  const result = await executeTool(evt.name, JSON.parse(evt.arguments || "{}"));
  send({ 
    type: "conversation.item.create",
    item: { 
      type: "function_call_output", 
      call_id: evt.call_id,
      output: JSON.stringify(result) 
    } 
  });
  send({ type: "response.create" });   // let the model speak the answer
}
```

# Model Choice

## OpenAI Realtime API (`gpt-realtime-mini`)

**Selected Model**: `gpt-realtime-mini` over WebRTC.

### Why Realtime over WebRTC?

- **Speech-to-Speech**: Bypasses the traditional latency of transcribe > generate text > text-to-speech pipelines.
- **WebRTC advantages**: Handles capture, jitter buffering, echo cancellation, adaptive bitrate, and low-latency playback natively. A single data channel carries the structured JSON events synchronously with the audio.
- **Client-Side Tools**: Keeps the execution loop low-latency and allows tools to directly manipulate the UI.

# AI Agents Workflow

The first step wasn't code, it was **planning mode in opencode**. Before building anything, the project's directives, conventions, and architecture were worked out in a planning session, then captured as durable config. This ensures the agent stays productive without rediscovering the same pitfalls each session.

- **`AGENTS.md`** (auto-loaded): The operating manual containing golden rules, verify commands, and a map to the deeper docs.
- **`.opencode/docs/`**: Focused references (like `realtime-voice.md` or `frontend-gotchas.md`) read on demand, so the agent pulls only what its task needs.
- **`.opencode/opencode.json`**: A hard guardrail with permission rules that prevent reading or editing `.env` files so secrets don't leak by accident.

**Why it matters:** Agents are only as good as their context. By proactively documenting complex technical nuances—such as specific React state behaviors or containerization dependencies—into the project's configuration, both AI agents and human developers can seamlessly avoid common pitfalls and get it right the first time.


# Considerations

This project demonstrates how to connect modern web development with advanced AI voice systems, focusing on the integration between a React frontend, a FastAPI backend, and the OpenAI Realtime API using WebRTC. The main goal is to show how these technologies can work together in a cohesive, low-latency, full-stack application to solve complex orchestration challenges. 


# License

<img style="height:22px!important;margin-left:3px;vertical-align:text-bottom;" src="https://mirrors.creativecommons.org/presskit/icons/cc.svg?ref=chooser-v1">
