import test from "node:test";
import assert from "node:assert/strict";
import { LlmArena, arenaConfigSchema } from "../src/server/llm-arena.ts";
import type { MarketService } from "../src/server/markets.ts";
import type { Market } from "../src/shared/types.ts";

const base = {
  name: "Momentum agent",
  model: "fixture",
  venue: "lighter",
  intervalMinutes: 1,
  initialEquity: 1000,
  marginPerTrade: 50,
  leverage: 2,
  maxDailyLoss: 50,
  maxDailyNotional: 1000,
  maxAiSpendDaily: 1,
  maxRunsDaily: 20,
  stopLossPct: 3,
  takeProfitPct: 6,
  minVolume24h: 10000,
  maxAbsFundingBps: 10,
  allowedSide: "both",
  minConfidence: 0.6,
  feeBps: 5,
  slippageBps: 5,
  rules: "Find momentum across liquid markets. Hold when uncertain.",
};
function fixture() {
  let now = Date.UTC(2026, 9, 20, 12),
    calls = 0;
  let decision: unknown = {
    action: "long",
    symbol: "ETH-USDC",
    confidence: 0.9,
    rationale: "Offline selected second candidate.",
  };
  const prompts: Array<Record<string, unknown>> = [];
  const books: string[] = [];
  const histories: string[] = [];
  const rows: Market[] = ["BTC", "ETH", "SOL"].map((base, index) => ({
    venue: "lighter",
    symbol: base + "-USDC",
    base,
    quote: "USDC",
    price: String(100 + index * 100),
    change24h: index,
    volume24h: String(1000000 - index * 100000),
    fundingRate: 0,
    openInterest: "100000",
    maxLeverage: 5,
    sizeDecimals: 3,
    priceDecimals: 2,
    minSize: ".001",
    minNotional: "10",
    updatedAt: now,
  }));
  const markets: MarketService = {
    list: async () => structuredClone(rows),
    candles: async (_venue, symbol, interval) => {
      histories.push(symbol + ":" + interval);
      return Array.from({ length: 48 }, (_, index) => ({
        time: now / 1000 - (47 - index) * 60,
        open: 100,
        high: 102,
        low: 99,
        close: 100,
        volume: 100,
      }));
    },
    book: async (_venue, symbol) => {
      books.push(symbol);
      const row = rows.find((row) => row.symbol === symbol);
      assert(row);
      return {
        bids: [{ price: row.price, size: "1000" }],
        asks: [{ price: row.price, size: "1000" }],
        updatedAt: now,
      };
    },
  };
  const request: typeof fetch = async (url, init) => {
    if (String(url).includes("/models"))
      return Response.json({
        data: [
          {
            id: "fixture",
            context_length: 32768,
            pricing: {
              prompt: 1,
              completion: 2,
              unit: "per_million_tokens",
              currency: "USD",
            },
          },
        ],
      });
    assert.equal(String(url), 'https://nano-gpt.com/api/v1/chat/completions');
    calls++;
    const body = JSON.parse(String(init?.body));
    prompts.push(JSON.parse(body.messages[1].content));
    return Response.json({
      choices: [{ message: { content: JSON.stringify(decision) } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });
  };
  const arena = new LlmArena(":memory:", markets, {
    request,
    clock: () => now,
  });
  return {
    arena,
    rows,
    books,
    histories,
    prompts,
    markets,
    calls: () => calls,
    decision: (value: unknown) => {
      decision = value;
    },
    advance: () => {
      now += 60001;
      for (const row of rows) row.updatedAt = now;
    },
  };
}

test("liquid universe requires no single coin and sends bounded candidates at selected timeframe", async () => {
  const f = fixture();
  try {
    const b = f.arena.create({
      ...base,
      universe: { kind: "liquid", maxCandidates: 2, ranking: "volume" },
      timeframe: "1m",
    });
    await f.arena.start(b.id, "fixture-key");
    const result = await f.arena.evaluate(b.id);
    assert.equal(result.status, "running");
    assert.equal(result.paper.position?.symbol, "ETH-USDC");
    assert.equal(result.activeSymbol, "ETH-USDC");
    assert.equal(result.lastScan?.considered, 2);
    assert.deepEqual(result.lastScan?.symbols, ["BTC-USDC", "ETH-USDC"]);
    assert.deepEqual(f.histories, ["BTC-USDC:1m", "ETH-USDC:1m"]);
    assert.deepEqual(f.books, ["ETH-USDC"]);
    assert.equal(f.calls(), 1);
  } finally {
    f.arena.close();
  }
});

test("off-universe model selection cannot read its book or open a position", async () => {
  const f = fixture();
  try {
    f.decision({
      action: "long",
      symbol: "SOL-USDC",
      confidence: 1,
      rationale: "Not authorized by this snapshot.",
    });
    const b = f.arena.create({
      ...base,
      universe: {
        kind: "watchlist",
        symbols: ["BTC-USDC", "ETH-USDC"],
        maxCandidates: 2,
      },
    });
    await f.arena.start(b.id, "fixture-key");
    const result = await f.arena.evaluate(b.id);
    assert.equal(result.paper.position, null);
    assert.equal(f.books.length, 0);
    assert.match(
      result.history.at(-1)?.rationale ?? "",
      /candidate|universe|snapshot/i,
    );
  } finally {
    f.arena.close();
  }
});

test("watchlist stays exact, filters incompatible leverage and skips unavailable histories before paid inference", async () => {
  const f = fixture();
  try {
    f.rows[0]!.maxLeverage = 1;
    f.markets.candles = async () => [];
    const b = f.arena.create({
      ...base,
      universe: {
        kind: "watchlist",
        symbols: ["BTC-USDC", "ETH-USDC"],
        maxCandidates: 2,
      },
    });
    await f.arena.start(b.id, "fixture-key");
    const result = await f.arena.evaluate(b.id);
    assert.equal(result.status, "running");
    assert.equal(f.calls(), 0);
    assert.equal(result.paper.position, null);
    assert.match(result.history.at(-1)?.rationale ?? "", /history|candidate/i);
  } finally {
    f.arena.close();
  }
});

test("selection changes only after closing and persists the actual position instrument", async () => {
  const f = fixture();
  try {
    const b = f.arena.create({
      ...base,
      universe: { kind: "liquid", maxCandidates: 3 },
      timeframe: "1m",
    });
    await f.arena.start(b.id, "fixture-key");
    await f.arena.evaluate(b.id);
    f.advance();
    f.decision({
      action: "close",
      symbol: "ETH-USDC",
      confidence: 1,
      rationale: "Close owned market.",
    });
    let result = await f.arena.evaluate(b.id);
    assert.equal(result.paper.position, null);
    assert.equal(f.books.at(-1), "ETH-USDC");
    f.advance();
    f.decision({
      action: "long",
      symbol: "SOL-USDC",
      confidence: 1,
      rationale: "Rotate after closing.",
    });
    result = await f.arena.evaluate(b.id);
    assert.equal(result.paper.position?.symbol, "SOL-USDC");
    assert.equal(f.books.at(-1), "SOL-USDC");
  } finally {
    f.arena.close();
  }
});

test("universe validates native watchlist bounds and preserves legacy single market configuration", () => {
  assert.equal(
    arenaConfigSchema.parse({
      ...base,
      symbol: "BTC-USDC",
      intervalMinutes: 15,
    }).universe.kind,
    "single",
  );
  assert.equal(
    arenaConfigSchema.safeParse({
      ...base,
      universe: { kind: "watchlist", symbols: [] },
    }).success,
    false,
  );
  assert.equal(
    arenaConfigSchema.safeParse({
      ...base,
      universe: { kind: "watchlist", symbols: ["BTC-USDC", "BTC-USDC"] },
    }).success,
    false,
  );
  assert.equal(
    arenaConfigSchema.safeParse({
      ...base,
      universe: { kind: "liquid", maxCandidates: 99 },
    }).success,
    false,
  );
  assert.equal(
    arenaConfigSchema.safeParse({ ...base, universe: { kind: "single" } })
      .success,
    false,
  );
});

test("paper daily order cap reserves protection and prevents oversized protected entries", async () => {
  const f = fixture();
  try {
    const b = f.arena.create({
      ...base,
      maxDailyNotional: 200,
      universe: { kind: "liquid", maxCandidates: 2 },
      timeframe: "1m",
    });
    await f.arena.start(b.id, "fixture-key");
    const result = await f.arena.evaluate(b.id);
    assert.equal(result.paper.position, null);
    assert.match(result.history.at(-1)?.rationale ?? "", /budget/i);
    assert.equal(result.daily.orderNotional, 0);
  } finally {
    f.arena.close();
  }
});

test("paper protection remains executable after its daily entry budget is consumed", async () => {
  const f = fixture();
  try {
    const b = f.arena.create({
      ...base,
      maxDailyNotional: 304,
      universe: { kind: "liquid", maxCandidates: 2 },
      timeframe: "1m",
    });
    await f.arena.start(b.id, "fixture-key");
    const opened = await f.arena.evaluate(b.id);
    assert(opened.paper.position);
    assert(opened.daily.orderNotional > 300);
    f.arena.pause(b.id);
    f.rows[1]!.price = "190";
    await f.arena.tick();
    const result = f.arena.get(b.id);
    assert.equal(result.paper.position, null);
    assert.equal(f.calls(), 1);
  } finally {
    f.arena.close();
  }
});
