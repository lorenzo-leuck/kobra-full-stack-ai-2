import http from "http";
import url from "url";
import crypto from "crypto";

// -----------------------------
// Types
// -----------------------------
// Single JSON structure that powers BOTH the 15-day multi-line chart and the
// voice assistant. Each series is aligned to the shared `dates` axis; summary
// pre-ranks the symbols so the assistant can answer "which rose most / which to
// buy" directly.
type HistorySeries = {
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

type HistoryPayload = {
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

// -----------------------------
// Config
// -----------------------------
const PORT = Number(process.env.PORT ?? "3001");
const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY ?? "";
const SYMBOLS = (process.env.SYMBOLS ?? "AAPL,MSFT,TSLA,NVDA,AMZN")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const SERVER_ID = `market-${crypto.randomBytes(4).toString("hex")}`;

// History (15-day daily candles) configuration.
const HISTORY_DAYS = clamp(Number(process.env.HISTORY_DAYS ?? "15"), 2, 90);
// Daily candles barely change intraday, so cache aggressively to save credits.
const HISTORY_COOLDOWN_MS = clamp(Number(process.env.HISTORY_COOLDOWN_MS ?? "300000"), 0, 24 * 3600000);

// -----------------------------
// Helpers
// -----------------------------
function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n));
}

function toNumberOrUndef(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
}

async function fetchJSONWithTimeout(input: string | URL, timeoutMs = 10000): Promise<any> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(input, { signal: controller.signal });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    if (!res.ok) return { __httpError: true, status: res.status, body: json ?? text };
    return json ?? text;
  } finally {
    clearTimeout(id);
  }
}

// -----------------------------
// Twelve Data client (time_series endpoint -> 15-day daily history)
// -----------------------------
async function twelvedataTimeSeries(
  symbol: string,
  outputsize: number
): Promise<{ symbol: string; currency?: string; rows: { date: string; close: number }[] }> {
  const endpoint = new URL("https://api.twelvedata.com/time_series");
  endpoint.searchParams.set("symbol", symbol);
  endpoint.searchParams.set("interval", "1day");
  endpoint.searchParams.set("outputsize", String(outputsize));
  endpoint.searchParams.set("apikey", TWELVE_DATA_API_KEY);
  endpoint.searchParams.set("format", "json");

  const json = await fetchJSONWithTimeout(endpoint);
  if (!json || json.__httpError) {
    throw new Error(`TwelveData time_series HTTP error for ${symbol}: ${json?.status ?? "unknown"}`);
  }
  if (json.status === "error" || json.code === 400 || json.code === 429) {
    throw new Error(`TwelveData time_series error for ${symbol}: ${json.message ?? json.code ?? "unknown"}`);
  }

  const currency = json?.meta?.currency ? String(json.meta.currency) : undefined;
  const values: any[] = Array.isArray(json?.values) ? json.values : [];
  // Twelve Data returns newest-first; reverse to chronological (oldest-first).
  const rows = values
    .map((v) => ({ date: String(v?.datetime ?? ""), close: toNumberOrUndef(v?.close) }))
    .filter((r): r is { date: string; close: number } => r.date !== "" && typeof r.close === "number")
    .reverse();

  return { symbol, currency, rows };
}

function emptyHistory(): HistoryPayload {
  return {
    generatedAt: Date.now(),
    period: `${HISTORY_DAYS}d`,
    interval: "1day",
    symbols: SYMBOLS,
    dates: [],
    series: SYMBOLS.map((symbol) => ({ symbol, closes: [], trend: "flat" })),
    summary: { bestPerformer: null, worstPerformer: null, ranking: [] },
  };
}

async function buildHistory(outputsize: number): Promise<HistoryPayload> {
  if (!TWELVE_DATA_API_KEY) return emptyHistory();

  const results = await Promise.allSettled(SYMBOLS.map((s) => twelvedataTimeSeries(s, outputsize)));

  const dateSet = new Set<string>();
  const perSymbol = new Map<string, Map<string, number>>();
  const currencies = new Map<string, string | undefined>();

  results.forEach((r, i) => {
    const sym = SYMBOLS[i];
    if (r.status === "fulfilled") {
      const m = new Map<string, number>();
      for (const row of r.value.rows) {
        m.set(row.date, row.close);
        dateSet.add(row.date);
      }
      perSymbol.set(sym, m);
      currencies.set(sym, r.value.currency);
    } else {
      console.warn(`[market-service] history error for ${sym}: ${(r as PromiseRejectedResult).reason}`);
    }
  });

  // YYYY-MM-DD sorts lexically == chronologically. Keep the last N days.
  const allDates = [...dateSet].sort();
  const dates = allDates.slice(Math.max(0, allDates.length - outputsize));

  const series: HistorySeries[] = SYMBOLS.map((symbol) => {
    const m = perSymbol.get(symbol);
    const closes = dates.map((d) => (m && m.has(d) ? m.get(d)! : null));
    const present = closes.filter((c): c is number => c != null);

    const first = present[0];
    const last = present[present.length - 1];
    const min = present.length ? Math.min(...present) : undefined;
    const max = present.length ? Math.max(...present) : undefined;

    let changeAbs: number | undefined;
    let changePct: number | undefined;
    let trend: "up" | "down" | "flat" = "flat";
    if (typeof first === "number" && typeof last === "number" && first !== 0) {
      changeAbs = last - first;
      changePct = (changeAbs / first) * 100;
      trend = changePct > 0.05 ? "up" : changePct < -0.05 ? "down" : "flat";
    }

    return { symbol, currency: currencies.get(symbol), closes, first, last, min, max, changeAbs, changePct, trend };
  });

  const ranking = series
    .map((s) => ({ symbol: s.symbol, changePct: s.changePct ?? null, last: s.last }))
    .sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity));
  const ranked = ranking.filter((r) => r.changePct != null);

  return {
    generatedAt: Date.now(),
    period: `${outputsize}d`,
    interval: "1day",
    symbols: SYMBOLS,
    dates,
    series,
    summary: {
      bestPerformer: ranked[0]?.symbol ?? null,
      worstPerformer: ranked.length ? ranked[ranked.length - 1].symbol : null,
      ranking,
    },
  };
}

// Cache + single-flight guard so concurrent requests share one fetch.
let historyCache: HistoryPayload | null = null;
let historyFetchedAt = 0;
let historyInFlight: Promise<HistoryPayload> | null = null;

async function ensureHistory(): Promise<HistoryPayload> {
  const now = Date.now();
  if (historyCache && now - historyFetchedAt < HISTORY_COOLDOWN_MS) return historyCache;
  if (historyInFlight) return historyInFlight;
  historyInFlight = buildHistory(HISTORY_DAYS)
    .then((p) => {
      historyCache = p;
      historyFetchedAt = Date.now();
      return p;
    })
    .catch((e) => {
      console.warn(`[market-service] buildHistory failed: ${e}`);
      return historyCache ?? emptyHistory();
    })
    .finally(() => {
      historyInFlight = null;
    });
  return historyInFlight;
}

// -----------------------------
// HTTP server (/health + /history) with CORS
// -----------------------------
function start() {
  if (!TWELVE_DATA_API_KEY) {
    console.warn("[market-service] TWELVE_DATA_API_KEY is not set — history will be empty.");
  }

  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    const parsed = url.parse(req.url || "", true);
    const json = (code: number, body: unknown) => {
      res.statusCode = code;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    };

    if (req.method === "GET" && parsed.pathname === "/health") {
      return json(200, {
        ok: true,
        serverId: SERVER_ID,
        ts: Date.now(),
        symbols: SYMBOLS.length,
        historyCached: historyCache != null,
      });
    }
    if (req.method === "GET" && parsed.pathname === "/history") {
      ensureHistory()
        .then((payload) => json(200, payload))
        .catch((e) => json(500, { error: e?.message ?? String(e) }));
      return;
    }
    json(404, { error: "not found" });
  });

  server.listen(PORT, () => {
    console.log(`[market-service] http listening on :${PORT} (GET /history, /health)`);
  });

  const shutdown = () => {
    try {
      server.close();
    } catch {
      // ignore
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start();
