import test from "node:test";
import assert from "node:assert/strict";
import { arenaConfigSchema, LlmArena } from "../src/server/llm-arena.ts";
import type { MarketService } from "../src/server/markets.ts";
const config = {
  name: "Live fixture",
  model: "fixture",
  venue: "lighter",
  symbol: "BTC-USDC",
  intervalMinutes: 15,
  initialEquity: 1,
  marginPerTrade: 10,
  leverage: 2,
  maxDailyLoss: 20,
  maxAiSpendDaily: 1,
  maxRunsDaily: 20,
  stopLossPct: 2,
  takeProfitPct: 4,
  minVolume24h: 0,
  maxAbsFundingBps: 10,
  allowedSide: "both",
  minConfidence: 0.6,
  feeBps: 5,
  slippageBps: 5,
  rules: "Fixture only",
  mode: "live",
  accountName: "desk",
  marginMode: "isolated",
  maxDailyNotional: 100,
};
test("arena live config is explicit and paper remains the default", () => {
  assert.equal(arenaConfigSchema.parse(config).mode, "live");
  const { mode, accountName, ...paper } = config;
  void mode;
  void accountName;
  assert.equal(
    arenaConfigSchema.parse({ ...paper, initialEquity: 100 }).mode,
    "paper",
  );
  assert.throws(() =>
    arenaConfigSchema.parse({ ...config, accountName: undefined }),
  );
});
test("live start requires explicit human arming and cannot invoke a trade during setup", async () => {
  const markets = { list: async () => [] } as unknown as MarketService;
  const arena = new LlmArena(":memory:", markets);
  try {
    const bot = arena.create(config);
    await assert.rejects(
      arena.start(bot.id, "fixture-key"),
      /arm|Live execution/i,
    );
    assert.equal(arena.get(bot.id).status, "paused");
  } finally {
    arena.close();
  }
});

test('concurrent starts cannot arm two agents for the same account', async () => {
  const f=executionFixture();
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const arena=new LlmArena(':memory:',{list:async()=>[f.market]} as unknown as MarketService,{
    live:f.runtime,
    request:async()=>{await gate;return Response.json({data:[{id:'fixture',context_length:32768,pricing:{prompt:1,completion:2,unit:'per_million_tokens',currency:'USD'}}]});},
  });
  try {
    const first=arena.create(config),second=arena.create({...config,name:'Second agent'});
    const starting=arena.start(first.id,'fixture-key',binding);
    await assert.rejects(arena.start(second.id,'fixture-key',binding),/already in progress/);
    release();
    await starting;
    assert.equal(arena.get(first.id).status,'running');
    assert.equal(arena.get(second.id).status,'paused');
    assert.deepEqual(f.counts(),{httpCalls:0,nativeCalls:0});
  } finally {release();arena.close();f.store.close();}
});

test('live first mark after UTC midnight retains the previous equity loss baseline', async () => {
  const f=executionFixture();let now=Date.UTC(2026,9,20,23,59),equity=500;
  const snapshot=()=>({equity,availableMargin:400,position:null,observedAt:now,protectionStatus:'flat' as const});
  const arena=new LlmArena(':memory:',{list:async()=>[{...f.market,updatedAt:now}]} as unknown as MarketService,{
    clock:()=>now,
    request:async()=>Response.json({data:[{id:'fixture',context_length:32768,pricing:{prompt:1,completion:2,unit:'per_million_tokens',currency:'USD'}}]}),
    live:{accounts:()=>[],arm:async()=>snapshot(),inspect:async()=>snapshot(),open:async()=>{throw Error('No order expected');},close:async()=>{throw Error('No close expected');}},
  });
  try{const bot=arena.create(config);await arena.start(bot.id,'fixture-key',binding);now+=120000;equity=470;await arena.tick();const result=arena.get(bot.id);assert.equal(result.status,'loss-paused');assert.equal(result.live?.daily.startEquity,500);assert.equal(result.daily.calls,0);}finally{arena.close();f.store.close();}
});
import {
  ArenaLiveExecution,
  type ArenaLiveArm,
} from "../src/server/llm-arena-live.ts";
import { HummingbotExecution } from "../src/server/execution.ts";
import { DeskStore } from "../src/server/store.ts";
import { TradingDesk } from "../src/server/trading.ts";
const binding: ArenaLiveArm = {
  accountName: "desk",
  connectionRevision: "a".repeat(64),
  acknowledgeAutonomousLive: true,
};
function executionFixture(venue: "lighter" | "hyperliquid" = "lighter") {
  const now = Date.now(),
    store = new DeskStore(":memory:");
  store.setConnectionFingerprint("desk", venue, binding.connectionRevision);
  const market = {
    venue,
    marketType: "perpetual" as const,
    symbol: "BTC-USDC",
    base: "BTC",
    quote: "USDC",
    price: "100",
    change24h: 0,
    volume24h: "100000",
    fundingRate: 0,
    openInterest: "1",
    maxLeverage: 5,
    sizeDecimals: 3,
    priceDecimals: 2,
    minSize: ".001",
    minNotional: "1",
    updatedAt: now,
  };
  let httpCalls = 0,
    nativeCalls = 0,
    fail = false,
    active = true;
  let cancelHandler: ((id: string) => Promise<void>) | undefined;
  let payload: Record<string, unknown> = {};
  let positions: Array<{
    symbol: string;
    side: "long" | "short";
    size: string;
    entry_price: string;
  }> = [];
  let orders: Array<{
    symbol: string;
    order_id: string;
    client_order_id: string | null;
    reduce_only: boolean;
    side: "buy" | "sell";
    size?: string;
    trigger_price: string | null;
  }> = [];
  const execution = new HummingbotExecution(
    {
      url: "http://localhost:8000",
      username: "fixture",
      password: "fixture",
      accountName: "desk",
    },
    async (url, init) => {
      httpCalls++;
      assert.equal(
        new URL(String(url)).pathname,
        "/quanttrade/trading/entry-bracket-orders",
      );
      payload = JSON.parse(String(init?.body));
      return Response.json({
        status: "accepted",
        grouping: "normalTpsl",
        order_ids: ["1", "2", "3"],
        client_order_ids: [
          "0x" + "1".repeat(32),
          "0x" + "2".repeat(32),
          "0x" + "3".repeat(32),
        ],
        entry_order_id: "1",
      });
    },
  );
  const desk = new TradingDesk(
    store,
    { list: async () => [market] },
    execution,
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
  const operations = {
    perform: async (action: string, input: Record<string, unknown>) => {
      if (action === "arena-account-state")
        return {
          account_name: "desk",
          connector_name: venue + "_perpetual",
          trading_pair: venue === "hyperliquid" ? "BTC-USD" : "BTC-USDC",
          complete: true,
          equity: "500",
          available_margin: "400",
          positions,
          orders: orders.map(row=>({...row,size:row.size??'0.198',full_position:false})),
        };
      if (action === "leverage") return { status: "accepted" };
      if (action === "cancel-order") {
        await cancelHandler?.(String(input.exchange_order_id));
        return { status: "accepted" };
      }
      assert.equal(action, "native-orders");
      nativeCalls++;
      payload = input;
      if (fail) throw Error("Fixture uncertain");
      return {
        status: "accepted",
        grouping: "otoco",
        connector_name: "lighter_perpetual",
        trading_pair: "BTC-USDC",
        client_order_ids: ["1", "2", "3"],
        tx_hash: "fixture-only",
      };
    },
  };
  const runtime = new ArenaLiveExecution(
      desk,
      execution,
      operations,
      () => now,
    ),
    cfg = arenaConfigSchema.parse({ ...config, venue });
  return {
    store,
    desk,
    execution,
    runtime,
    restart: () =>
      new ArenaLiveExecution(desk, execution, operations, () => now),
    market,
    cfg,
    active: () => active,
    stop: () => {
      active = false;
    },
    counts: () => ({ httpCalls, nativeCalls }),
    payload: () => payload,
    setFail: () => {
      fail = true;
    },
    setCancelHandler: (handler: (id: string) => Promise<void>) => {
      cancelHandler = handler;
    },
    removeOrder: (id: string) => {
      orders = orders.filter((o) => o.order_id !== id);
    },
    setAccount: (p: typeof positions, o: typeof orders) => {
      positions = p;
      orders = o;
    },
  };
}
test("live adapter prepares deterministic protected native entry and obeys both bot and desk caps", async () => {
  for (const venue of ["lighter", "hyperliquid"] as const) {
    const f = executionFixture(venue);
    try {
      const snapshot = await f.runtime.arm(f.cfg, binding, f.active);
      assert.equal(snapshot.equity, 500);
      assert.deepEqual(f.counts(), { httpCalls: 0, nativeCalls: 0 });
      const result = await f.runtime.open(
        f.cfg,
        binding,
        f.market,
        "long",
        "fixture-protected-entry",
        1000,
        f.active,
      );
      assert.equal(result.receipt.status, "pending");
      assert.equal(result.receipt.entry?.size, "0.198");
      assert.equal(result.receipt.protectionOrderIds.length, 2);
      assert.equal(f.counts().nativeCalls + f.counts().httpCalls, 1);
      if (venue === "lighter") {
        assert.equal(f.payload().grouping, "otoco");
        const legs = f.payload().legs as Array<Record<string, unknown>>;
        assert.equal(legs[0]?.amount, "0.198");
        assert.equal(legs[1]?.amount, "0");
        assert.equal(legs[2]?.amount, "0");
      }
      await assert.rejects(
        f.runtime.open(
          f.cfg,
          binding,
          f.market,
          "long",
          "another-protected-entry",
          1,
          f.active,
        ),
        /daily notional/,
      );
      await assert.rejects(
        f.runtime.open(
          f.cfg,
          binding,
          f.market,
          "long",
          "fixture-protected-entry",
          1000,
          f.active,
        ),
        /already claimed/,
      );
      assert.equal(f.counts().nativeCalls + f.counts().httpCalls, 1);
    } finally {
      f.store.close();
    }
  }
});
test("uncertain native dispatch is never replayed; changed binding and kill switch stop new orders", async () => {
  const f = executionFixture();
  try {
    await f.runtime.arm(f.cfg, binding, f.active);
    f.setFail();
    await assert.rejects(
      f.runtime.open(
        f.cfg,
        binding,
        f.market,
        "short",
        "uncertain-native-entry",
        1000,
        f.active,
      ),
      /uncertain/,
    );
    await assert.rejects(
      f.runtime.open(
        f.cfg,
        binding,
        f.market,
        "short",
        "uncertain-native-entry",
        1000,
        f.active,
      ),
      /claimed/,
    );
    assert.equal(f.counts().nativeCalls, 1);
    f.desk.setHalted(true);
    await assert.rejects(
      f.runtime.arm(f.cfg, binding, f.active),
      /authorization/,
    );
    assert.equal(f.counts().nativeCalls, 1);
  } finally {
    f.store.close();
  }
});
test("live adapter rejects existing positions/orders before arming and unknown protection remains pending", async () => {
  const f = executionFixture();
  try {
    f.setAccount(
      [{ symbol: "BTC-USDC", side: "long", size: "1", entry_price: "100" }],
      [],
    );
    await assert.rejects(
      f.runtime.arm(f.cfg, binding, f.active),
      /empty dedicated/,
    );
    f.setAccount([], []);
    await f.runtime.arm(f.cfg, binding, f.active);
    const r = await f.runtime.open(
      f.cfg,
      binding,
      f.market,
      "long",
      "protected-position-fixture",
      1000,
      f.active,
    );
    f.execution.orderEvidence = async () => ({
      status: "filled",
      fillSize: "0.198",
      fillPrice: "100",
    });
    f.setAccount(
      [{ symbol: "BTC-USDC", side: "long", size: "0.198", entry_price: "100" }],
      [],
    );
    let snapshot = await f.runtime.inspect(f.cfg, binding, r.receipt, f.active);
    assert.equal(snapshot.protectionStatus, "pending");
    f.setAccount(
      [{ symbol: "BTC-USDC", side: "long", size: "0.198", entry_price: "100" }],
      [
        {
          symbol: "BTC-USDC",
          order_id: "12",
          client_order_id: "2",
          reduce_only: true,
          side: "sell",
          trigger_price: "104",
        },
        {
          symbol: "BTC-USDC",
          order_id: "13",
          client_order_id: "3",
          reduce_only: true,
          side: "sell",
          trigger_price: "98",
        },
      ],
    );
    snapshot = await f.runtime.inspect(f.cfg, binding, r.receipt, f.active);
    assert.equal(snapshot.protectionStatus, "protected");
  } finally {
    f.store.close();
  }
});

test("owned live close keeps protection until actual flat proof and cancels only receipt-owned native IDs", async () => {
  const f = executionFixture();
  try {
    await f.runtime.arm(f.cfg, binding, f.active);
    const opened = await f.runtime.open(
      f.cfg,
      binding,
      f.market,
      "long",
      "owned-live-open-fixture",
      1000,
      f.active,
    );
    f.execution.orderEvidence = async (order) =>
      order.reduceOnly
        ? { status: "pending" }
        : { status: "filled", fillSize: "0.198", fillPrice: "100" };
    const nativeExits = [
      {
        symbol: "BTC-USDC",
        order_id: "12",
        client_order_id: "2",
        reduce_only: true,
        side: "sell" as const,
        trigger_price: "104",
      },
      {
        symbol: "BTC-USDC",
        order_id: "13",
        client_order_id: "3",
        reduce_only: true,
        side: "sell" as const,
        trigger_price: "98",
      },
    ];
    f.setAccount(
      [{ symbol: "BTC-USDC", side: "long", size: "0.198", entry_price: "100" }],
      nativeExits,
    );
    const events: string[] = [];
    f.execution.place = async (order) => {
      events.push("close");
      assert.equal(order.reduceOnly, true);
      assert.equal(order.size, "0.198");
      assert.equal(order.side, "sell");
      return "owned-close";
    };
    f.setCancelHandler(async (id) => {
      events.push("cancel:" + id);
    });
    const closed = await f.runtime.close(
      f.cfg,
      binding,
      f.market,
      opened.receipt,
      "owned-live-close-fixture",
      1000,
      f.active,
    );
    assert.equal(closed.receipt.status, "pending");
    assert.deepEqual(events, ["close"]);
    await f.runtime.inspect(f.cfg, binding, closed.receipt, f.active);
    assert.deepEqual(events, ["close"]);
    f.execution.orderEvidence = async (order) => ({
      status: "filled",
      fillSize: order.size,
      fillPrice: "100",
    });
    f.setAccount([], nativeExits);
    f.setCancelHandler(async (id) => {
      events.push("cancel:" + id);
      f.removeOrder(id);
    });
    const flat = await f.runtime.inspect(
      f.cfg,
      binding,
      closed.receipt,
      f.active,
    );
    assert.equal(flat.protectionStatus, "flat");
    assert.deepEqual(events, ["close", "cancel:12", "cancel:13"]);
  } finally {
    f.store.close();
  }
});

test("uncertain owned close never cancels protection or replays the close request", async () => {
  const f = executionFixture();
  try {
    await f.runtime.arm(f.cfg, binding, f.active);
    const opened = await f.runtime.open(
      f.cfg,
      binding,
      f.market,
      "long",
      "close-uncertain-open",
      1000,
      f.active,
    );
    f.execution.orderEvidence = async () => ({
      status: "filled",
      fillSize: "0.198",
      fillPrice: "100",
    });
    f.setAccount(
      [{ symbol: "BTC-USDC", side: "long", size: "0.198", entry_price: "100" }],
      [
        {
          symbol: "BTC-USDC",
          order_id: "12",
          client_order_id: "2",
          reduce_only: true,
          side: "sell",
          trigger_price: "104",
        },
        {
          symbol: "BTC-USDC",
          order_id: "13",
          client_order_id: "3",
          reduce_only: true,
          side: "sell",
          trigger_price: "98",
        },
      ],
    );
    let closes = 0,
      cancels = 0;
    f.execution.place = async () => {
      closes++;
      throw Error("Uncertain mock transport");
    };
    f.setCancelHandler(async () => {
      cancels++;
    });
    await assert.rejects(
      f.runtime.close(
        f.cfg,
        binding,
        f.market,
        opened.receipt,
        "uncertain-owned-close",
        1000,
        f.active,
      ),
      /uncertain/,
    );
    await assert.rejects(
      f.runtime.close(
        f.cfg,
        binding,
        f.market,
        opened.receipt,
        "uncertain-owned-close",
        1000,
        f.active,
      ),
      /claimed/,
    );
    assert.equal(closes, 1);
    assert.equal(cancels, 0);
  } finally {
    f.store.close();
  }
});
test("a stale binding and foreign exchange order never arm a live bot", async () => {
  const f = executionFixture();
  try {
    await assert.rejects(
      f.runtime.arm(
        f.cfg,
        { ...binding, connectionRevision: "b".repeat(64) },
        f.active,
      ),
      /authorization/,
    );
    f.setAccount(
      [],
      [
        {
          symbol: "BTC-USDC",
          order_id: "99",
          client_order_id: null,
          reduce_only: false,
          side: "buy",
          trigger_price: null,
        },
      ],
    );
    await assert.rejects(
      f.runtime.arm(f.cfg, binding, f.active),
      /empty dedicated/,
    );
    assert.deepEqual(f.counts(), { httpCalls: 0, nativeCalls: 0 });
  } finally {
    f.store.close();
  }
});

test("live Hyperliquid arming never silently reuses core collateral for a builder market", async () => {
  const f = executionFixture("hyperliquid");
  try {
    await assert.rejects(
      f.runtime.open(
        f.cfg,
        binding,
        f.market,
        "long",
        "not-armed-live-entry",
        1000,
        f.active,
      ),
      /not armed/,
    );
    await f.runtime.arm(f.cfg, binding, f.active);
    const builder = { ...f.cfg, symbol: "para:PAPER-USDC" };
    await assert.rejects(
      f.runtime.open(
        builder,
        binding,
        {
          ...f.market,
          symbol: builder.symbol,
          base: "para:PAPER",
          dex: "para",
        },
        "long",
        "wrong-scope-live-entry",
        1000,
        f.active,
      ),
      /collateral scope/,
    );
    assert.deepEqual(f.counts(), { httpCalls: 0, nativeCalls: 0 });
  } finally {
    f.store.close();
  }
});

test("restart recovery requires fresh owned protection and does not submit another entry", async () => {
  const f = executionFixture();
  try {
    await f.runtime.arm(f.cfg, binding, f.active);
    const opened = await f.runtime.open(
      f.cfg,
      binding,
      f.market,
      "long",
      "resume-entry",
      1000,
      f.active,
    );
    f.execution.orderEvidence = async () => ({
      status: "filled",
      fillSize: "0.198",
      fillPrice: "100",
    });
    f.setAccount(
      [{ symbol: "BTC-USDC", side: "long", size: "0.198", entry_price: "100" }],
      [
        {
          symbol: "BTC-USDC",
          order_id: "12",
          client_order_id: "2",
          reduce_only: true,
          side: "sell",
          trigger_price: "104",
        },
        {
          symbol: "BTC-USDC",
          order_id: "13",
          client_order_id: "3",
          reduce_only: true,
          side: "sell",
          trigger_price: "98",
        },
      ],
    );
    const restarted = f.restart();
    const receipt = { ...opened.receipt, status: "protected" as const };
    const resumed = await restarted.arm(f.cfg, binding, f.active, receipt);
    assert.equal(resumed.protectionStatus, "protected");
    assert.equal(resumed.position?.size, "0.198");
    assert.equal(f.counts().nativeCalls, 1);
    f.setAccount([{symbol:'BTC-USDC',side:'long',size:'0.198',entry_price:'100'}], [
      {symbol:'BTC-USDC',order_id:'12',client_order_id:'2',reduce_only:true,side:'sell',trigger_price:'104',size:'0.001'},
      {symbol:'BTC-USDC',order_id:'13',client_order_id:'3',reduce_only:true,side:'sell',trigger_price:'98',size:'0.001'},
    ]);
    await assert.rejects(f.restart().arm(f.cfg,binding,f.active,receipt),/protection/);
    await assert.rejects(
      f
        .restart()
        .arm(f.cfg, binding, f.active, { ...receipt, status: "uncertain" }),
      /reconcile|uncertain/i,
    );
    f.setAccount(
      [{ symbol: "BTC-USDC", side: "long", size: "0.198", entry_price: "100" }],
      [],
    );
    await assert.rejects(
      f.restart().arm(f.cfg, binding, f.active, receipt),
      /protection|reconcile/i,
    );
    f.setAccount([], [{symbol:'BTC-USDC',order_id:'13',client_order_id:'3',reduce_only:true,side:'sell',trigger_price:'98'}]);
    f.setCancelHandler(async id=>f.removeOrder(id));
    const flat=await f.restart().arm(f.cfg,binding,f.active,receipt);
    assert.equal(flat.protectionStatus,'flat');
    assert.equal(flat.position,null);
  } finally {
    f.store.close();
  }
});
