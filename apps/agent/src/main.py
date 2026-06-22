import os
from datetime import datetime

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware


# -----------------------------
# Configuration
# -----------------------------
PORT = int(os.getenv("PORT", "8000"))
HOST = os.getenv("HOST", "0.0.0.0")
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").strip()

# Realtime API (speech-to-speech over WebRTC).
REALTIME_MODEL = os.getenv("REALTIME_MODEL", "gpt-realtime-mini")
REALTIME_VOICE = os.getenv("REALTIME_VOICE", "marin")
# Live transcription of the *user's* speech (the model's own speech transcript
# arrives natively over the data channel).
REALTIME_TRANSCRIBE_MODEL = os.getenv("REALTIME_TRANSCRIBE_MODEL", "whisper-1")


# -----------------------------
# App
# -----------------------------
app = FastAPI(title="Agent Python Service")

origins = ["*"] if CORS_ORIGINS.strip() == "*" else [o.strip() for o in CORS_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -----------------------------
# Realtime (speech-to-speech) session minting
# -----------------------------
REALTIME_INSTRUCTIONS = (
    "You are Kobra, a friendly, concise stock-market voice assistant. "
    "You track 5 stocks: AAPL, MSFT, TSLA, NVDA and AMZN over a 15-day window. "
    "When the user asks anything about prices, performance, which stock to buy, or "
    "which one rose/fell the most, ALWAYS call the get_market_history tool and answer "
    "from its `summary.ranking` (sorted best-to-worst by 15-day % change) and each "
    "series' `changePct`/`trend`. Keep spoken answers short and natural — one or two "
    "sentences. When the user asks to sell the stocks (e.g. 'sell the stocks', 'sell "
    "everything', 'dump them', 'cash out'), call the sell_stocks tool. Never invent prices."
)

REALTIME_TOOLS = [
    {
        "type": "function",
        "name": "get_market_history",
        "description": (
            "Get the 15-day daily price history and performance ranking for the 5 tracked "
            "stocks (AAPL, MSFT, TSLA, NVDA, AMZN). Returns a summary ranking sorted by "
            "15-day percent change plus per-symbol first/last price, changePct and trend."
        ),
        "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "type": "function",
        "name": "sell_stocks",
        "description": "Trigger the money 'sell' animation in the dashboard when the user asks to sell the stocks / sell everything / cash out.",
        "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
    },
]


@app.post("/realtime/session")
async def realtime_session():
    """Mint a short-lived ephemeral client secret for a browser WebRTC session.

    The browser uses the returned `value` to authenticate directly with the
    OpenAI Realtime API; the standard API key never leaves this server.
    """
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not set")

    session_config = {
        "session": {
            "type": "realtime",
            "model": REALTIME_MODEL,
            "instructions": REALTIME_INSTRUCTIONS,
            "audio": {
                "input": {"transcription": {"model": REALTIME_TRANSCRIBE_MODEL}},
                "output": {"voice": REALTIME_VOICE},
            },
            "tools": REALTIME_TOOLS,
        }
    }

    url = f"{OPENAI_BASE_URL.rstrip('/')}/realtime/client_secrets"
    headers = {"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"}

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, headers=headers, json=session_config)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to reach Realtime API: {e}")

    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=f"client_secrets failed: {resp.text}")

    return resp.json()


@app.get("/health")
async def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat() + "Z"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT)
