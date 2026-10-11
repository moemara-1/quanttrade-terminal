import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WorkflowRuns } from "../src/server/workflows.ts";
import { TradingDesk } from "../src/server/trading.ts";
import { DeskStore } from "../src/server/store.ts";
import type { OrderDraft, Market } from "../src/shared/types.ts";

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/iceberg-position-plan.json", import.meta.url),
    "utf8",
  ),
);
for (const venue of ["lighter", "hyperliquid"] as const)
  test(`${venue}: one approved Iceberg with paired multi-TP protects exact allocations and gates every later display slice on real fills`, async () => {
    const now = Date.now(),
      store = new DeskStore(":memory:");
    let filled = false,
      calls = 0,
      brackets = 0;
    const owned = new Map<string, OrderDraft>();
    const market: Market = {
      venue,
      symbol: "PRL-USDC",
      base: "PRL",
      price: "1.4",
      change24h: 0,
      volume24h: "1",
      fundingRate: null,
      openInterest: null,
      sizeDecimals: 2,
      priceDecimals: 4,
      minSize: "0.01",
      minNotional: "1",
      maxLeverage: 3,
      updatedAt: now,
    };
    const desk = new TradingDesk(
      store,
      { list: async () => [market] },
      {
        configured: true,
        place: async (order) => {
          calls++;
          const id = "entry-" + calls;
          owned.set(id, order);
          return id;
        },
        cancel: async () => {},
        placeBracket: async () => {
          brackets++;
          return "oco-" + brackets;
        },
        placeEntryBracket: async (orders) => {
          brackets++;
          calls++;
          const id = "entry-" + calls;
          owned.set(id, orders[0]);
          return { orderId: "bracket-" + brackets, entryOrderId: id };
        },
        orderEvidence: async (_order, id) =>
          filled
            ? {
                status: "filled",
                fillSize: owned.get(id)!.size,
                fillPrice: "1.4",
              }
            : { status: "pending" },
      },
      {
        mode: "live",
        accountName: "desk",
        maxOrderNotional: "1000",
        dailyNotionalLimit: "5000",
        maxPriceDeviationBps: 100,
        proposalTtlSeconds: 180,
        pairlensUrl: "http://localhost",
      },
      () => now,
    );
    const runs = new WorkflowRuns(":memory:", desk, () => now);
    const input: OrderDraft = {
      venue,
      symbol: "PRL-USDC",
      side: "buy",
      type: "limit",
      size: "12",
      price: "1.4",
      leverage: 3,
      marginMode: "cross",
      rationale: "One approved iceberg",
    };
    const approval = {
      clientOrderId: "one-approved-iceberg",
      proposedAt: now,
      plan: {
        name: "Iceberg position plan",
        accountName: "desk",
        mode: "live",
        maxTotalNotional: "100",
        graph: fixture.compiled.workflow.graph,
        input,
      },
    };
    try {
      await runs.start(approval);
      assert.equal(calls, 0);
      await runs.tick();
      assert.equal(calls, 2);
      await runs.tick();
      assert.equal(calls, 2);
      assert.equal(runs.get(approval.clientOrderId).status, "active");
      filled = true;
      await runs.tick();
      assert.equal(calls, 4, JSON.stringify(runs.get(approval.clientOrderId)));
      await runs.tick();
      assert.equal(runs.get(approval.clientOrderId).status, "completed");
      assert.equal(brackets, 4);
      assert.deepEqual(
        [...owned.values()].map((order) => order.size),
        ["2.4", "3.6", "2.4", "3.6"],
      );
      await runs.start(approval);
      await runs.tick();
      assert.equal(calls, 4);
      assert.equal(brackets, 4);
    } finally {
      runs.close();
      store.close();
    }
  });

test("new compound plan pins the approved connection across registration and later execution", async () => {
  const store = new DeskStore(":memory:"),
    now = Date.now();
  let calls = 0;
  store.setConnectionFingerprint("desk", "lighter", "a".repeat(64));
  const market: Market = {
    venue: "lighter",
    symbol: "PRL-USDC",
    base: "PRL",
    price: "1.4",
    change24h: 0,
    volume24h: "1",
    fundingRate: null,
    openInterest: null,
    sizeDecimals: 2,
    priceDecimals: 4,
    minSize: "0.01",
    minNotional: "1",
    maxLeverage: 3,
    updatedAt: now,
  };
  const desk = new TradingDesk(
    store,
    { list: async () => [market] },
    {
      configured: true,
      place: async () => {
        calls++;
        return "never";
      },
      cancel: async () => {},
    },
    {
      mode: "live",
      accountName: "desk",
      maxOrderNotional: "1000",
      dailyNotionalLimit: "5000",
      maxPriceDeviationBps: 100,
      proposalTtlSeconds: 180,
      pairlensUrl: "http://localhost",
    },
    () => now,
  );
  const runs = new WorkflowRuns(":memory:", desk, () => now);
  const plan = {
    name: "Pinned plan",
    accountName: "desk",
    mode: "live",
    maxTotalNotional: "100",
    connectionRevision: "a".repeat(64),
    graph: fixture.compiled.workflow.graph,
    input: {
      venue: "lighter",
      symbol: "PRL-USDC",
      side: "buy",
      type: "limit",
      size: "12",
      price: "1.4",
      leverage: 3,
      marginMode: "cross",
      rationale: "Reviewed plan",
    },
  };
  try {
    await runs.start({ clientOrderId: "pinned-plan", proposedAt: now, plan });
    store.setConnectionFingerprint("desk", "lighter", "b".repeat(64));
    await runs.tick();
    assert.equal(calls, 0);
    assert.equal(runs.get("pinned-plan").status, "paused");
    await assert.rejects(
      runs.start({ clientOrderId: "new-stale-plan", proposedAt: now, plan }),
      /connection changed/,
    );
    assert.equal(calls, 0);
  } finally {
    runs.close();
    store.close();
  }
});
