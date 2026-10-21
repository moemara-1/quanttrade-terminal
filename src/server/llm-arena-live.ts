import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import type { Market, OrderDraft, Venue } from "../shared/types.ts";
import type { ArenaConfig } from "./llm-arena.ts";
import type { TradingDesk } from "./trading.ts";
import type { HummingbotExecution } from "./execution.ts";
import { hummingbotTradingPair } from "./execution.ts";
import type { OperationClient } from "./operations.ts";
export const arenaLiveArmSchema = z
  .object({
    accountName: z.string().min(1).max(100),
    connectionRevision: z.string().regex(/^[a-f0-9]{64}$/),
    acknowledgeAutonomousLive: z.literal(true),
  })
  .strict();
export type ArenaLiveArm = z.infer<typeof arenaLiveArmSchema>;
export class ArenaLiveUncertainError extends Error {
  readonly submissionUncertain = true;
}
export interface ArenaLiveReceipt {
  requestId: string;
  entryOrderId: string;
  protectionOrderIds: string[];
  status: "pending" | "protected" | "flat" | "uncertain";
  entry: OrderDraft | null;
  exits: [OrderDraft, OrderDraft] | null;
  closeRequestId?: string;
  closeOrderId?: string;
  closeOrder?: OrderDraft;
}
export interface ArenaLiveSnapshot {
  equity: number;
  availableMargin: number;
  position: { side: "long" | "short"; size: string; entryPrice: string } | null;
  observedAt: number;
  protectionStatus: "flat" | "pending" | "protected";
}
export interface ArenaLiveState {
  collateralScope?: string;
  armed: boolean;
  accountName: string;
  connectionRevision: string;
  equity: number | null;
  availableMargin: number | null;
  position: ArenaLiveSnapshot["position"];
  receipt: ArenaLiveReceipt | null;
  daily: { date: string; startEquity: number | null; notional: number };
  observedAt: number | null;
}
export interface ArenaLiveRuntime {
  accounts(): Array<{
    venue: Venue;
    accountName: string;
    connectionRevision: string;
    mode: "live";
  }>;
  arm(
    config: ArenaConfig,
    binding: ArenaLiveArm,
    authorized: () => boolean,
    receipt?: ArenaLiveReceipt,
  ): Promise<ArenaLiveSnapshot>;
  inspect(
    config: ArenaConfig,
    binding: ArenaLiveArm,
    receipt: ArenaLiveReceipt | null,
    authorized: () => boolean,
  ): Promise<ArenaLiveSnapshot>;
  open(
    config: ArenaConfig,
    binding: ArenaLiveArm,
    market: Market,
    side: "long" | "short",
    requestId: string,
    remainingDailyNotional: number,
    authorized: () => boolean,
  ): Promise<{ receipt: ArenaLiveReceipt; notional: number }>;
  close(
    config: ArenaConfig,
    binding: ArenaLiveArm,
    market: Market,
    receipt: ArenaLiveReceipt,
    requestId: string,
    remainingDailyNotional: number,
    authorized: () => boolean,
  ): Promise<{ receipt: ArenaLiveReceipt; notional: number }>;
}
const number = z
  .string()
  .max(80)
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
const accountSchema = z
  .object({
    account_name: z.string(),
    connector_name: z.string(),
    trading_pair: z.string(),
    complete: z.literal(true),
    equity: number,
    available_margin: number,
    positions: z.array(
      z.object({
        symbol: z.string(),
        side: z.enum(["long", "short"]),
        size: number,
        entry_price: number,
      }),
    ),
    orders: z.array(
      z.object({
        symbol: z.string(),
        order_id: z.string(),
        client_order_id: z.string().nullable(),
        reduce_only: z.boolean(),
        side: z.enum(["buy", "sell"]),
        size: number.nullable().default(null),
        full_position: z.boolean().default(false),
        trigger_price: number.nullable(),
      }),
    ),
  })
  .strict();
/** Explicit per-bot authorization; no general assistant approval flow is changed. */
export class ArenaLiveExecution implements ArenaLiveRuntime {
  private readonly armedScopes = new Map<string, string>();
  private scope(config: ArenaConfig) {
    return config.venue === "hyperliquid"
      ? config.symbol.includes(":")
        ? config.symbol.split(":", 1)[0]!
        : ""
      : "USDC";
  }
  private bindingKey(config: ArenaConfig, binding: ArenaLiveArm) {
    return `${config.venue}:${binding.accountName}:${binding.connectionRevision}`;
  }
  private requireArmedScope(config: ArenaConfig, binding: ArenaLiveArm) {
    if (
      this.armedScopes.get(this.bindingKey(config, binding)) !==
      this.scope(config)
    )
      throw Error(
        "Live bot collateral scope changed or is not armed; re-arm a separate agent for this DEX",
      );
  }
  constructor(
    private readonly desk: TradingDesk,
    private readonly execution: HummingbotExecution,
    private readonly operations: OperationClient,
    private readonly clock: () => number = Date.now,
  ) {}
  accounts() {
    const s = this.desk.status();
    return (["lighter", "hyperliquid"] as const).flatMap((venue) => {
      const revision = this.desk.store.connectionFingerprint(
        s.accountName,
        venue,
      );
      return s.executionConfigured &&
        this.desk.modeFor(venue) === "live" &&
        revision
        ? [
            {
              venue,
              accountName: s.accountName,
              connectionRevision: revision,
              mode: "live" as const,
            },
          ]
        : [];
    });
  }
  private authorize(
    config: ArenaConfig,
    binding: ArenaLiveArm,
    active: () => boolean,
  ) {
    const s = this.desk.status();
    if (
      !active() ||
      s.halted ||
      !s.executionConfigured ||
      this.desk.modeFor(config.venue) !== "live" ||
      config.accountName !== binding.accountName ||
      s.accountName !== binding.accountName ||
      this.desk.store.connectionFingerprint(
        binding.accountName,
        config.venue,
      ) !== binding.connectionRevision
    )
      throw Error("Live bot authorization changed; no new order is permitted");
  }
  private async read(
    config: ArenaConfig,
    binding: ArenaLiveArm,
    active: () => boolean,
  ) {
    this.authorize(config, binding, active);
    const pair =
      config.venue === "hyperliquid"
        ? hummingbotTradingPair(config.symbol)
        : config.symbol;
    const parsed = accountSchema.safeParse(
      await this.operations.perform("arena-account-state", {
        account_name: binding.accountName,
        connector_name: config.venue + "_perpetual",
        trading_pair: pair,
      }),
    );
    this.authorize(config, binding, active);
    if (
      !parsed.success ||
      parsed.data.account_name !== binding.accountName ||
      parsed.data.connector_name !== config.venue + "_perpetual" ||
      parsed.data.trading_pair !== pair
    )
      throw Error("Live bot account snapshot is unverified");
    return parsed.data;
  }
  async arm(
    config: ArenaConfig,
    binding: ArenaLiveArm,
    active: () => boolean,
    receipt?: ArenaLiveReceipt,
  ) {
    if (receipt) {
      if (receipt.status !== "protected" || receipt.closeRequestId)
        throw Error(
          "Live bot must reconcile pending or uncertain submissions before resuming",
        );
      const snapshot = await this.inspect(config, binding, receipt, active);
      if (snapshot.protectionStatus === 'pending' || (snapshot.position && snapshot.protectionStatus !== "protected"))
        throw Error(
          "Live bot native protection must be verified before resuming",
        );
      this.authorize(config, binding, active);
      this.armedScopes.set(
        this.bindingKey(config, binding),
        this.scope(config),
      );
      return snapshot;
    }
    const account = await this.read(config, binding, active);
    if (account.positions.length || account.orders.length)
      throw Error(
        "Live bot requires an empty dedicated connected account scope before arming",
      );
    this.armedScopes.set(this.bindingKey(config, binding), this.scope(config));
    return {
      equity: Number(account.equity),
      availableMargin: Number(account.available_margin),
      position: null,
      observedAt: this.clock(),
      protectionStatus: "flat" as const,
    };
  }
  private matches(
    config: ArenaConfig,
    id: string,
    row: z.infer<typeof accountSchema>["orders"][number],
  ) {
    return (
      id === `native:${config.venue}:${row.order_id}` ||
      id === `native-client:${config.venue}:${row.client_order_id}` ||
      (config.venue === "hyperliquid" &&
        id === `native:hyperliquid:${row.client_order_id}`)
    );
  }
  async inspect(
    config: ArenaConfig,
    binding: ArenaLiveArm,
    receipt: ArenaLiveReceipt | null,
    active: () => boolean,
  ): Promise<ArenaLiveSnapshot> {
    let account = await this.read(config, binding, active);
    if (receipt?.entry && receipt.entry.symbol !== config.symbol)
      throw Error(
        "Live bot receipt market does not match its collateral scope",
      );
    const entry = receipt?.entry,
      exits = receipt?.exits;
    if (
      receipt &&
      (!entry ||
        !exits ||
        receipt.status === "uncertain" ||
        (receipt.closeRequestId && !receipt.closeOrderId))
    )
      throw Error(
        "Live bot submission outcome is uncertain; inspect the exchange before any new action",
      );
    const p = account.positions[0];
    if (
      account.positions.length > 1 ||
      account.positions.some((p) => p.symbol !== config.symbol)
    )
      throw Error("Live bot detected an unowned position; execution paused");
    if (
      p &&
      (!receipt ||
        !entry ||
        p.side !== (entry.side === "buy" ? "long" : "short") ||
        new Decimal(p.size).gt(entry.size))
    )
      throw Error("Live bot position ownership is unverified");
    if (
      account.orders.some(
        (row) =>
          !receipt ||
          (!receipt.protectionOrderIds.some((id) =>
            this.matches(config, id, row),
          ) &&
            !this.matches(config, receipt.entryOrderId, row)),
      )
    )
      throw Error(
        "Live bot detected an unowned exchange order; execution paused",
      );
    let protectionStatus: ArenaLiveSnapshot["protectionStatus"] = "flat";
    if (receipt) {
      if (!entry || !exits) throw Error("Live bot receipt is unverified");
      const fill = await this.execution.orderEvidence(
        entry,
        receipt.entryOrderId,
      );
      this.authorize(config, binding, active);
      if (fill.status === "failed")
        throw Error("Live bot entry fill could not be verified");
      if (fill.status !== "filled") protectionStatus = "pending";
      else if (receipt.closeOrderId) {
        if (!receipt.closeOrder)
          throw Error("Live bot close receipt is unverified");
        const closeFill = await this.execution.orderEvidence(
          receipt.closeOrder,
          receipt.closeOrderId,
        );
        this.authorize(config, binding, active);
        if (closeFill.status === "failed" && p)
          throw Error(
            "Live bot close was rejected; inspect the protected position before any new action",
          );
        if (p || closeFill.status === "pending") protectionStatus = "pending";
        else {
          account = await this.cleanup(config, binding, receipt, active);
          protectionStatus = "flat";
        }
      } else if (p) {
        if (
          !fill.fillSize ||
          !new Decimal(fill.fillSize).eq(entry.size) ||
          !new Decimal(p.size).eq(fill.fillSize)
        )
          throw Error(
            "Live bot filled position size changed; execution paused",
          );
        const verifiedExits = receipt.protectionOrderIds.map((id, index) =>
          account.orders.find(
            (row) =>
              this.matches(config, id, row) &&
              row.symbol === config.symbol &&
              row.reduce_only &&
              row.side !== entry.side &&
              (row.full_position || row.size !== null && new Decimal(row.size).gte(p.size)) &&
              row.trigger_price !== null &&
              new Decimal(row.trigger_price).eq(
                exits[index]!.trigger!.triggerPrice,
              ),
          ),
        );
        protectionStatus = verifiedExits.every(Boolean)
          ? "protected"
          : "pending";
      } else {
        account = await this.cleanup(config, binding, receipt, active);
        protectionStatus = "flat";
      }
    }
    const latest = account.positions[0];
    return {
      equity: Number(account.equity),
      availableMargin: Number(account.available_margin),
      position: latest
        ? {
            side: latest.side,
            size: latest.size,
            entryPrice: latest.entry_price,
          }
        : null,
      observedAt: this.clock(),
      protectionStatus,
    };
  }
  private async cleanup(
    config: ArenaConfig,
    binding: ArenaLiveArm,
    receipt: ArenaLiveReceipt,
    active: () => boolean,
  ) {
    let account = await this.read(config, binding, active);
    if (account.positions.length)
      throw Error(
        "Live bot position is not verified flat; protection will not be cancelled",
      );
    // Flat proof and exact receipt-owned reduce-only IDs authorize cleanup,
    // independently of the in-memory permission to open new positions.
    for (const row of account.orders) {
      if (
        !row.reduce_only ||
        row.symbol !== config.symbol ||
        !receipt.protectionOrderIds.some((id) => this.matches(config, id, row))
      )
        throw Error("Live bot cannot cancel an unowned exchange order");
      const id = createHash("sha256")
        .update("arena-cleanup:" + receipt.requestId + ":" + row.order_id)
        .digest("hex");
      const payload = {
        request_id: id,
        account_name: binding.accountName,
        connector_name: config.venue + "_perpetual",
        trading_pair:
          config.venue === "hyperliquid"
            ? hummingbotTradingPair(config.symbol)
            : config.symbol,
        exchange_order_id: row.order_id,
      };
      const previous = this.desk.store.claimOperation(
        id,
        createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
      );
      if (previous) {
        if (previous.state === "completed") continue;
        throw Error(
          "Live bot protective cancellation is uncertain; no retry permitted",
        );
      }
      try {
        this.authorize(config, binding, active);
        z.object({ status: z.literal("accepted") }).parse(
          await this.operations.perform("cancel-order", payload),
        );
        this.desk.store.finishOperation(id, "completed", {
          exchangeOrderId: row.order_id,
        });
      } catch {
        this.desk.store.finishOperation(id, "unknown", {
          error: "Owned protective cancellation uncertain",
        });
        throw Error(
          "Live bot protective cancellation is uncertain; no retry permitted",
        );
      }
    }
    account = await this.read(config, binding, active);
    if (account.positions.length || account.orders.length)
      throw Error(
        "Live bot flat account and protective cancellation are not yet verified",
      );
    return account;
  }
  async close(
    config: ArenaConfig,
    binding: ArenaLiveArm,
    market: Market,
    receipt: ArenaLiveReceipt,
    requestId: string,
    remainingDailyNotional: number,
    active: () => boolean,
  ) {
    this.authorize(config, binding, active);
    if (
      !receipt.entry ||
      !receipt.exits ||
      receipt.status === "uncertain" ||
      receipt.closeRequestId ||
      receipt.closeOrderId
    )
      throw Error("Live bot close ownership is unverified or already claimed");
    if (
      this.armedScopes.get(this.bindingKey(config, binding)) !==
      this.scope(config)
    )
      await this.arm(config, binding, active, receipt);
    const snapshot = await this.inspect(config, binding, receipt, active);
    if (!snapshot.position)
      return { receipt: { ...receipt, status: "flat" as const }, notional: 0 };
    if (snapshot.protectionStatus !== "protected")
      throw Error(
        "Live bot entry and native protection must be verified before a model close",
      );
    const order: OrderDraft = {
      venue: config.venue,
      marketType: "perpetual",
      symbol: config.symbol,
      type: "market",
      side: snapshot.position.side === "long" ? "sell" : "buy",
      size: snapshot.position.size,
      reduceOnly: true,
      rationale:
        "Close only the position owned by this explicitly armed arena bot",
    };
    const preview = await this.desk.preview(order);
    this.authorize(config, binding, active);
    if (new Decimal(preview.notional).gt(remainingDailyNotional))
      throw Error(
        "Live bot daily notional cap blocks this close; native protection remains active",
      );
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ binding, order, receipt: receipt.requestId }))
      .digest("hex");
    if (this.desk.store.claimOperation(requestId, fingerprint))
      throw Error(
        "Live bot close request was already claimed; no replay permitted",
      );
    this.desk.store.reserveOperation(
      requestId,
      "live",
      new Date(this.clock()).toISOString().slice(0, 10),
      preview.notional,
      this.desk.status().dailyNotionalLimit,
    );
    const multiplier = new Decimal(1).plus(
      new Decimal(this.desk.status().maxPriceDeviationBps)
        .div(10000)
        .mul(order.side === "buy" ? 1 : -1),
    );
    let bound = new Decimal(market.price)
      .mul(multiplier)
      .toDecimalPlaces(
        market.priceDecimals,
        order.side === "buy" ? Decimal.ROUND_DOWN : Decimal.ROUND_UP,
      );
    if (config.venue === "hyperliquid" && !bound.isInteger())
      bound = bound.toSignificantDigits(
        5,
        order.side === "buy" ? Decimal.ROUND_DOWN : Decimal.ROUND_UP,
      );
    try {
      this.authorize(config, binding, active);
      const closeOrderId = await this.execution.place(
        order,
        bound.toFixed(),
        requestId,
      );
      const next = {
        ...receipt,
        status: "pending" as const,
        closeRequestId: requestId,
        closeOrderId,
        closeOrder: order,
      };
      this.desk.store.finishOperation(requestId, "completed", next);
      return { receipt: next, notional: Number(preview.notional) };
    } catch {
      this.desk.store.finishOperation(requestId, "unknown", {
        error: "Owned close uncertain; no replay",
      });
      throw new ArenaLiveUncertainError(
        "Live bot close outcome is uncertain; native protection remains. No automatic retry is permitted",
      );
    }
  }
  async open(
    config: ArenaConfig,
    binding: ArenaLiveArm,
    market: Market,
    side: "long" | "short",
    requestId: string,
    remainingDailyNotional: number,
    active: () => boolean,
  ) {
    this.authorize(config, binding, active);
    this.requireArmedScope(config, binding);
    const account = await this.read(config, binding, active);
    if (account.positions.length || account.orders.length)
      throw Error("Live bot account scope is not flat");
    if (config.marginPerTrade > Number(account.available_margin))
      throw Error("Live bot available margin is insufficient");
    const round = (
      value: Decimal,
      rounding: Decimal.Rounding = Decimal.ROUND_DOWN,
    ) => {
      let n = value.toDecimalPlaces(market.priceDecimals, rounding);
      if (config.venue === "hyperliquid" && !n.isInteger())
        n = n.toSignificantDigits(5, rounding);
      return n.toFixed();
    };
    const mark = new Decimal(market.price),
      sign = side === "long" ? 1 : -1,
      bps = new Decimal(this.desk.status().maxPriceDeviationBps).div(10000),
      entryBound = mark.mul(new Decimal(1).plus(bps.mul(sign))),
      size = new Decimal(config.marginPerTrade)
        .mul(config.leverage)
        .div(Decimal.max(mark, entryBound))
        .toDecimalPlaces(market.sizeDecimals, Decimal.ROUND_DOWN)
        .toFixed();
    const base = {
      venue: config.venue,
      marketType: "perpetual" as const,
      symbol: config.symbol,
      type: "market" as const,
      size,
      rationale: "Autonomous arena order within explicitly armed fixed rules",
    };
    const entry: OrderDraft = {
      ...base,
      side: side === "long" ? "buy" : "sell",
      leverage: config.leverage,
      marginMode: config.marginMode,
    };
    const tp: OrderDraft = {
      ...base,
      side: side === "long" ? "sell" : "buy",
      reduceOnly: true,
      trigger: {
        triggerType: "tp",
        triggerPrice: round(
          mark.mul(
            new Decimal(1).plus(
              new Decimal(config.takeProfitPct).mul(sign).div(100),
            ),
          ),
        ),
      },
    };
    const sl: OrderDraft = {
      ...tp,
      trigger: {
        triggerType: "sl",
        triggerPrice: round(
          mark.mul(
            new Decimal(1).minus(
              new Decimal(config.stopLossPct).mul(sign).div(100),
            ),
          ),
        ),
      },
    };
    const orders: [OrderDraft, OrderDraft, OrderDraft] = [entry, tp, sl],
      previews = await Promise.all(
        orders.map((order) => this.desk.preview(order)),
      );
    this.authorize(config, binding, active);
    const total = previews.reduce(
      (sum, p) => sum.plus(p.notional),
      new Decimal(0),
    );
    if (total.gt(remainingDailyNotional))
      throw Error("Live bot daily notional cap blocks this protected entry");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ binding, orders }))
      .digest("hex");
    if (this.desk.store.claimOperation(requestId, fingerprint))
      throw Error(
        "Live bot order request was already claimed; no replay permitted",
      );
    this.desk.store.reserveOperation(
      requestId,
      "live",
      new Date(this.clock()).toISOString().slice(0, 10),
      total.toFixed(),
      this.desk.status().dailyNotionalLimit,
    );
    const bound = (order: OrderDraft) =>
      round(
        new Decimal(order.trigger?.triggerPrice ?? market.price).mul(
          new Decimal(1).plus(bps.mul(order.side === "buy" ? 1 : -1)),
        ),
        order.side === "buy" ? Decimal.ROUND_DOWN : Decimal.ROUND_UP,
      );
    try {
      this.authorize(config, binding, active);
      let entryOrderId: string, protectionOrderIds: string[];
      if (config.venue === "hyperliquid") {
        await this.operations.perform("leverage", {
          request_id: requestId + "-lev",
          account_name: binding.accountName,
          connector_name: "hyperliquid_perpetual",
          trading_pair: hummingbotTradingPair(config.symbol),
          leverage: config.leverage,
          margin_mode: config.marginMode,
        });
        this.authorize(config, binding, active);
        const native = await this.execution.placeEntryBracket(
          [{ ...entry, leverage: undefined, marginMode: undefined }, tp, sl],
          [bound(entry), bound(tp), bound(sl)],
          requestId,
        );
        const ids = native.orderId
          .slice("native-entry-oco:hyperliquid:".length)
          .split(",");
        if (
          ids.length !== 3 ||
          !native.orderId.startsWith("native-entry-oco:hyperliquid:")
        )
          throw Error("Unverified native bracket acknowledgment");
        entryOrderId = native.entryOrderId;
        protectionOrderIds = ids
          .slice(1)
          .map((id) => "native:hyperliquid:" + id);
      } else {
        const raw = await this.operations.perform("native-orders", {
          request_id: requestId,
          account_name: binding.accountName,
          connector_name: "lighter_perpetual",
          trading_pair: config.symbol,
          grouping: "otoco",
          leverage: config.leverage,
          margin_mode: config.marginMode,
          legs: orders.map((order, index) => ({
            side: order.side,
            type:
              index === 0 ? "market" : index === 1 ? "tp-market" : "sl-market",
            amount: index === 0 ? size : "0",
            price: bound(order),
            reduce_only: index !== 0,
            time_in_force: "ioc",
            ...(order.trigger
              ? { trigger_price: order.trigger.triggerPrice }
              : {}),
          })),
        });
        const ack = z
          .object({
            status: z.literal("accepted"),
            grouping: z.literal("otoco"),
            connector_name: z.literal("lighter_perpetual"),
            trading_pair: z.literal(config.symbol),
            client_order_ids: z.array(z.string().regex(/^[1-9]\d*$/)).length(3),
            tx_hash: z.string().min(1),
          })
          .parse(raw);
        if (new Set(ack.client_order_ids).size !== 3)
          throw Error("Unverified native order identities");
        entryOrderId = "native-client:lighter:" + ack.client_order_ids[0];
        protectionOrderIds = ack.client_order_ids
          .slice(1)
          .map((id) => "native-client:lighter:" + id);
      }
      const receipt: ArenaLiveReceipt = {
        requestId,
        entryOrderId,
        protectionOrderIds,
        status: "pending",
        entry,
        exits: [tp, sl],
      };
      this.desk.store.finishOperation(requestId, "completed", receipt);
      return { receipt, notional: total.toNumber() };
    } catch {
      this.desk.store.finishOperation(requestId, "unknown", {
        error: "Arena submission uncertain; no automatic retry",
      });
      throw new ArenaLiveUncertainError(
        "Live bot submission outcome is uncertain; inspect the exchange before any new action",
      );
    }
  }
}
