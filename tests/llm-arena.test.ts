import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { LlmArena } from "../src/server/llm-arena.ts";
import { createApp } from "../src/server/app.ts";
import { DeskStore } from "../src/server/store.ts";
import { TradingDesk } from "../src/server/trading.ts";
import type { MarketService } from "../src/server/markets.ts";

const config = {
  name: "Paper model",
  model: "fixture",
  venue: "lighter",
  symbol: "BTC-USDC",
  intervalMinutes: 15,
  initialEquity: 1000,
  marginPerTrade: 100,
  leverage: 2,
  maxDailyLoss: 50,
  maxAiSpendDaily: 1,
  maxRunsDaily: 20,
  stopLossPct: 2,
  takeProfitPct: 4,
  minVolume24h: 10000,
  maxAbsFundingBps: 10,
  allowedSide: "both",
  minConfidence: 0.6,
  feeBps: 5,
  slippageBps: 5,
  rules: "Trade only when evidence is clear.",
};

for (const hours of [-3, 3]) {
  test(`arena refuses ${hours < 0 ? "stale" : "future"} second-based candles without paid inference`, async () => {
    const f = fixture();
    try {
      const candles = await f.markets.candles(
        "lighter",
        "BTC-USDC",
        "1h",
        "perpetual",
      );
      f.markets.candles = async () =>
        candles.map((c) => ({ ...c, time: c.time + hours * 3600 }));
      const bot = f.arena.create(config);
      await f.arena.start(bot.id, "fixture-key");
      const result = await f.arena.evaluate(bot.id);
      assert.equal(result.status, "error");
      assert.equal(result.daily.calls, 0);
      assert.equal(result.paper.position, null);
    } finally {
      f.arena.close();
    }
  });
}
function fixture() {
  let now = Date.UTC(2026, 9, 19, 12),
    price = 100,
    calls = 0,
    fail = false,
    quote = "USDC";
  let tokenUsage = { prompt_tokens: 100, completion_tokens: 40 };
  let block: Promise<void> | undefined;
  let bookBlock: Promise<void> | undefined;
  let catalogBlock: Promise<void> | undefined;
  let decision = {
    action: "long",
    confidence: 0.9,
    rationale: "Offline fixture only.",
  };
  const markets: MarketService = {
    list: async () => [
      {
        venue: "lighter",
        symbol: "BTC-USDC",
        base: "BTC",
        quote,
        price: String(price),
        change24h: 1,
        volume24h: "1000000",
        fundingRate: 0,
        openInterest: "100000",
        maxLeverage: 5,
        sizeDecimals: 3,
        priceDecimals: 2,
        minSize: "0.001",
        minNotional: "10",
        updatedAt: now,
      },
    ],
    candles: async () =>
      Array.from({ length: 48 }, (_, i) => ({
        time: Math.floor(now / 1000) - (48 - i) * 3600,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 100,
      })),
    book: async () => {
      if (bookBlock) await bookBlock;
      return {
        bids: [{ price: String(price), size: "1000" }],
        asks: [{ price: String(price), size: "1000" }],
        updatedAt: now,
      };
    },
  };
  const request: typeof fetch = async (url, init) => {
    if (String(url).includes("/models")) {
      if (catalogBlock) await catalogBlock;
      return Response.json({
        data: [
          {
            id: "fixture",
            name: "Fixture",
            context_length: 16384,
            max_output_tokens: 4096,
            pricing: {
              prompt: 1,
              completion: 2,
              unit: "per_million_tokens",
              currency: "USD",
            },
          },
        ],
      });
    }
    calls++;
    if (block) await block;
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "Bearer fixture-key",
    );
    const body = JSON.parse(String(init?.body));
    assert.equal(body.stream, false);
    assert.equal(body.max_tokens, 1200);
    assert.equal(body.tools, undefined);
    if (fail) return new Response("never echo fixture-key", { status: 502 });
    return Response.json({
      choices: [{ message: { content: JSON.stringify(decision) } }],
      usage: tokenUsage,
    });
  };
  const arena = new LlmArena(":memory:", markets, {
    request,
    clock: () => now,
  });
  return {
    arena,
    markets,
    request,
    setQuote: (v: string) => {
      quote = v;
    },
    setUsage: (v: typeof tokenUsage) => {
      tokenUsage = v;
    },
    setBookBlock: (v: Promise<void>) => {
      bookBlock = v;
    },
    setCatalogBlock: (v: Promise<void>) => {
      catalogBlock = v;
    },
    setBlock: (value: Promise<void>) => {
      block = value;
    },
    get calls() {
      return calls;
    },
    setTime: (v: number) => {
      now = v;
    },
    advance: (ms: number) => {
      now += ms;
    },
    setPrice: (v: number) => {
      price = v;
    },
    setFailure: (v: boolean) => {
      fail = v;
    },
    setDecision: (v: typeof decision) => {
      decision = v;
    },
  };
}

test("creates paused paper-only bots and never returns or stores provider secrets", async () => {
  const f = fixture();
  try {
    const b = f.arena.create(config);
    assert.equal(b.status, "paused");
    assert.equal(f.calls, 0);
    assert.equal(b.paper.equity, 1000);
    assert.throws(() => f.arena.create({ ...config, mode: "live" }));
    await f.arena.start(b.id, "fixture-key");
    assert(!JSON.stringify(f.arena.list()).includes("fixture-key"));
    assert.equal(f.calls, 0);
  } finally {
    f.arena.close();
  }
});
test("scheduled decisions open one paper position, with fees and immutable risk settings", async () => {
  const f = fixture();
  try {
    const b = f.arena.create(config);
    await f.arena.start(b.id, "fixture-key");
    await f.arena.tick();
    const running = f.arena.get(b.id);
    assert.equal(f.calls, 1);
    assert.equal(running.paper.position?.side, "long");
    assert.equal(running.paper.position?.leverage, 2);
    assert(running.paper.feesPaid > 0);
    assert(running.paper.cash < 1000);
    assert(running.daily.aiSpent > 0);
    await f.arena.tick();
    assert.equal(f.calls, 1);
    assert.throws(() => f.arena.update(b.id, { ...config, leverage: 3 }));
  } finally {
    f.arena.close();
  }
});
test("protective checks close a paper position even when model decisions are paused", async () => {
  const f = fixture();
  try {
    const b = f.arena.create(config);
    await f.arena.start(b.id, "fixture-key");
    await f.arena.tick();
    f.arena.pause(b.id);
    f.setPrice(95);
    await f.arena.tick();
    const after = f.arena.get(b.id);
    assert.equal(after.paper.position, null);
    assert(after.paper.realizedPnl < 0);
    assert.equal(after.paper.closedTrades, 1);
    assert.equal(f.calls, 1);
  } finally {
    f.arena.close();
  }
});
test("reserves worst-case model cost and refuses requests beyond the user budget", async () => {
  const f = fixture();
  try {
    const b = f.arena.create({ ...config, maxAiSpendDaily: 0.001 });
    await f.arena.start(b.id, "fixture-key");
    await f.arena.tick();
    assert.equal(f.calls, 0);
    assert.equal(f.arena.get(b.id).status, "budget-paused");
  } finally {
    f.arena.close();
  }
});
test("provider failure is charged conservatively and does not retry or create a position", async () => {
  const f = fixture();
  try {
    f.setFailure(true);
    const b = f.arena.create(config);
    await f.arena.start(b.id, "fixture-key");
    await f.arena.tick();
    const after = f.arena.get(b.id);
    assert.equal(f.calls, 1);
    assert.equal(after.paper.position, null);
    assert(after.daily.aiSpent > 0);
    assert(!JSON.stringify(after).includes("fixture-key"));
    assert.match(after.history.at(-1)!.rationale, /502/);
    await f.arena.tick();
    assert.equal(f.calls, 1);
  } finally {
    f.arena.close();
  }
});
test("daily loss stops new decisions and paper bankrolls are isolated per model", async () => {
  const f = fixture();
  try {
    const a = f.arena.create({ ...config, maxDailyLoss: 5 });
    const b = f.arena.create({ ...config, name: "Second" });
    await f.arena.start(a.id, "fixture-key");
    await f.arena.tick();
    f.setPrice(90);
    await f.arena.tick();
    assert.equal(f.arena.get(a.id).status, "loss-paused");
    assert.equal(f.arena.get(b.id).paper.equity, 1000);
    assert.equal(f.calls, 1);
  } finally {
    f.arena.close();
  }
});
test("market constraints, side restrictions and confidence prevent a paper entry", async () => {
  const f = fixture();
  try {
    const b = f.arena.create({ ...config, allowedSide: "short" });
    await f.arena.start(b.id, "fixture-key");
    await f.arena.tick();
    assert.equal(f.arena.get(b.id).paper.position, null);
    assert.match(f.arena.get(b.id).history.at(-1)!.rationale, /side/i);
  } finally {
    f.arena.close();
  }
});

test("deterministic volume rules skip paid inference when no paper entry is allowed", async () => {
  const f = fixture();
  try {
    const b = f.arena.create({ ...config, minVolume24h: 1e12 });
    await f.arena.start(b.id, "fixture-key");
    await f.arena.tick();
    assert.equal(f.calls, 0);
    assert.equal(f.arena.get(b.id).history.at(-1)!.status, "rule-skipped");
  } finally {
    f.arena.close();
  }
});
test("winning trades include entry and exit fees instead of counting a net loss as a win", async () => {
  const f = fixture();
  try {
    const b = f.arena.create(config);
    await f.arena.start(b.id, "fixture-key");
    await f.arena.tick();
    f.setPrice(100.19);
    await f.arena.closePosition(b.id);
    const after = f.arena.get(b.id);
    assert(after.paper.realizedPnl < 0);
    assert.equal(after.paper.winningTrades, 0);
  } finally {
    f.arena.close();
  }
});
test("the first price move after UTC midnight counts toward the new daily loss limit", async () => {
  const f = fixture();
  try {
    const b = f.arena.create({ ...config, maxDailyLoss: 5 });
    await f.arena.start(b.id, "fixture-key");
    await f.arena.tick();
    f.advance(12 * 3600000 + 60000);
    f.setPrice(95);
    await f.arena.tick();
    assert.equal(f.arena.get(b.id).status, "loss-paused");
    assert.equal(f.calls, 1);
  } finally {
    f.arena.close();
  }
});
test("pausing during inference discards the decision but still accounts for AI usage", async () => {
  const f = fixture();
  let release!: () => void;
  f.setBlock(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  try {
    const b = f.arena.create(config);
    await f.arena.start(b.id, "fixture-key");
    const pending = f.arena.evaluate(b.id);
    await new Promise<void>((resolve) => setImmediate(resolve));
    f.arena.pause(b.id);
    release();
    await pending;
    const after = f.arena.get(b.id);
    assert.equal(after.paper.position, null);
    assert.equal(after.status, "paused");
    assert(after.daily.aiSpent > 0);
    assert.equal(after.history.at(-1)!.status, "discarded");
  } finally {
    release();
    f.arena.close();
  }
});
test("shutdown safely discards an in-flight evaluation without writing to a closed database", async () => {
  const f = fixture();
  let release!: () => void;
  f.setBlock(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  try {
    const b = f.arena.create(config);
    await f.arena.start(b.id, "fixture-key");
    const pending = f.arena.evaluate(b.id);
    await new Promise<void>((resolve) => setImmediate(resolve));
    f.arena.close();
    release();
    await assert.doesNotReject(pending);
  } finally {
    release();
    f.arena.close();
  }
});
test("concurrent paper close requests cannot realize the same position twice", async () => {
  const f = fixture();
  let release!: () => void;
  try {
    const b = f.arena.create(config);
    await f.arena.start(b.id, "fixture-key");
    await f.arena.tick();
    f.setPrice(105);
    f.setBookBlock(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const a = f.arena.closePosition(b.id),
      other = f.arena.closePosition(b.id);
    release();
    await Promise.all([a, other]);
    assert.equal(f.arena.get(b.id).paper.closedTrades, 1);
  } finally {
    release?.();
    f.arena.close();
  }
});
test("pause during final order-book check prevents a late paper entry", async () => {
  const f = fixture();
  let release!: () => void;
  try {
    const b = f.arena.create(config);
    await f.arena.start(b.id, "fixture-key");
    f.setBookBlock(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const pending = f.arena.evaluate(b.id);
    await new Promise<void>((resolve) => setImmediate(resolve));
    f.arena.pause(b.id);
    release();
    await pending;
    assert.equal(f.arena.get(b.id).paper.position, null);
  } finally {
    release?.();
    f.arena.close();
  }
});
test("pause while start is loading model pricing cannot be overwritten by a delayed start", async () => {
  const f = fixture();
  let release!: () => void;
  try {
    const b = f.arena.create(config);
    f.setCatalogBlock(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const pending = f.arena.start(b.id, "fixture-key");
    f.arena.pause(b.id);
    release();
    await assert.rejects(pending, /changed|paused/i);
    assert.equal(f.arena.get(b.id).status, "paused");
  } finally {
    release?.();
    f.arena.close();
  }
});
test("zero token usage is unverified and cannot refund a nonempty inference for free", async () => {
  const f = fixture();
  try {
    f.setUsage({ prompt_tokens: 0, completion_tokens: 0 });
    const b = f.arena.create(config);
    await f.arena.start(b.id, "fixture-key");
    await f.arena.tick();
    const after = f.arena.get(b.id);
    assert(after.daily.aiSpent > 0);
    assert.equal(after.history.at(-1)!.estimatedCost, true);
  } finally {
    f.arena.close();
  }
});
test("first-version paper accounting refuses non-USDC collateral before activating a bot", async () => {
  const f = fixture();
  try {
    f.setQuote("USDH");
    const b = f.arena.create(config);
    await assert.rejects(f.arena.start(b.id, "fixture-key"), /USDC/);
    assert.equal(f.calls, 0);
    assert.equal(f.arena.get(b.id).status, "paused");
  } finally {
    f.arena.close();
  }
});
test("keys expire and service restarts require rearming without erasing the paper ledger", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qt-arena-"));
  const file = join(dir, "arena.sqlite");
  const f = fixture();
  const markets: MarketService = {
    list: async () => [],
    candles: async () => [],
    book: async () => ({ bids: [], asks: [], updatedAt: Date.now() }),
  };
  let first: LlmArena | undefined;
  let next: LlmArena | undefined;
  try {
    first = new LlmArena(file, markets);
    const b = first.create(config);
    first.close();
    first = undefined;
    next = new LlmArena(file, markets);
    assert.equal(next.get(b.id).status, "paused");
    assert.equal(next.get(b.id).paper.equity, 1000);
    const active = f.arena.create(config);
    await f.arena.start(active.id, "fixture-key");
    f.advance(24 * 3600000 + 1);
    await f.arena.tick();
    assert.equal(f.arena.get(active.id).status, "needs-key");
    assert.equal(f.calls, 0);
  } finally {
    first?.close();
    next?.close();
    f.arena.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("arena endpoints require the operator and never expose keys or route live execution", async () => {
  const f = fixture(),
    store = new DeskStore(":memory:");
  const desk = new TradingDesk(
    store,
    f.markets,
    {
      configured: false,
      place: async () => {
        throw Error("Unexpected live execution");
      },
      cancel: async () => undefined,
    },
    {
      mode: "paper",
      accountName: "desk",
      maxOrderNotional: "1000",
      dailyNotionalLimit: "2000",
      maxPriceDeviationBps: 100,
      proposalTtlSeconds: 120,
      pairlensUrl: "http://localhost:4317",
    },
  );
  const app = createApp({
    arena: f.arena,
    desk,
    markets: f.markets,
    agent: { prepare: async () => ({ summary: "No order", proposal: null }) },
    operatorToken: "operator",
    agentToken: "agent",
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No address");
  const base = `http://127.0.0.1:${address.port}/api/llm-arena`,
    headers = {
      Authorization: "Bearer operator",
      "Content-Type": "application/json",
    };
  try {
    assert.equal((await fetch(base)).status, 401);
    assert.equal(
      (await fetch(base, { headers: { Authorization: "Bearer agent" } }))
        .status,
      403,
    );
    const created = await fetch(base, {
      method: "POST",
      headers,
      body: JSON.stringify(config),
    });
    assert.equal(created.status, 201);
    const bot = (await created.json()) as { id: string };
    const started = await fetch(`${base}/${bot.id}/start`, {
      method: "POST",
      headers,
      body: JSON.stringify({ apiKey: "fixture-key" }),
    });
    assert.equal(started.status, 200);
    const list = await fetch(base, { headers });
    const text = await list.text();
    assert(!text.includes("fixture-key"));
    assert.equal(JSON.parse(text).capabilities.live, false);
    assert.equal(
      (
        await fetch(base, {
          method: "POST",
          headers,
          body: JSON.stringify({ ...config, mode: "live" }),
        })
      ).status,
      400,
    );
    assert.equal(f.calls, 0);
    assert.equal(store.list().length, 0);
  } finally {
    app.locals.hostedAuthClose();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    f.arena.close();
    store.close();
  }
});
