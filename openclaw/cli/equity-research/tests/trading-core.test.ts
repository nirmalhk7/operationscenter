import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { createTradingCoreService, validateConfig, loadTradingConfig } from "../src/agent-turns.js";
import { asNullableNumber, Bar, createDefaultState, ContractError, PositionSnapshot, TradingConfig } from "../src/contracts.js";
import { ensureLedger, TradingLedger } from "../src/ledger.js";
import { buildExecutionPlan, computeSignalPlan } from "../src/value-engine.js";
import { AlpacaClient } from "../src/adapters.js";

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function makeConfig(overrides: Partial<TradingConfig> = {}): TradingConfig {
  return {
    execution_mode: "paper",
    autonomous_execution_enabled: true,
    alpaca_trading_base_url: "https://paper-api.alpaca.markets",
    alpaca_data_base_url: "https://data.alpaca.markets",
    alpaca_data_feed: "iex",
    alpaca_api_key: "key",
    alpaca_secret_key: "secret",
    paper_strategy_capital_usd: 100,
    max_open_positions: 2,
    max_new_entries_per_day: 1,
    max_position_notional_pct: 0.3,
    max_total_invested_pct: 0.6,
    minimum_order_notional_usd: 15,
    max_quote_age_seconds: 60,
    max_spread_bps: 25,
    max_midpoint_deviation_pct: 0.015,
    order_client_prefix: "mvalue-paper-",
    ledger_path: join(tmpdir(), `mvalue-${Math.random().toString(36).slice(2)}.sqlite`),
    timezone: "America/New_York",
    watchlist_symbols: ["SPY", "QQQ", "IWM", "XLK", "XLF", "XLV", "XLE", "XLI"],
    tradable_symbols: ["QQQ", "IWM", "XLK", "XLF", "XLV", "XLE", "XLI"],
    ...overrides,
  };
}

function series(symbol: string, start: number, slope: number): Bar[] {
  const bars: Bar[] = [];
  const startTime = new Date("2025-01-01T00:00:00Z").getTime();
  for (let index = 0; index < 260; index += 1) {
    const close = round(start + slope * index);
    bars.push({
      symbol,
      t: new Date(startTime + index * 86_400_000).toISOString(),
      o: round(close - 0.1),
      h: round(close + 0.6),
      l: round(close - 0.6),
      c: close,
      v: 1_000_000 + index,
    });
  }
  return bars;
}

function universe(overrides: Record<string, number> = {}): Record<string, Bar[]> {
  const slopes = {
    SPY: 0.1,
    QQQ: 0.55,
    IWM: 0.6,
    XLK: 0.52,
    XLF: 0.6,
    XLV: 0.35,
    XLE: 0.25,
    XLI: 0.2,
    ...overrides,
  };
  return Object.fromEntries(
    Object.entries(slopes).map(([symbol, slope]) => [symbol, series(symbol, 100, slope)]),
  );
}

function riskOffUniverse(): Record<string, Bar[]> {
  return {
    SPY: series("SPY", 100, -0.1),
    QQQ: series("QQQ", 100, 0.12),
    IWM: series("IWM", 100, 0.11),
    XLK: series("XLK", 100, 0.1),
    XLF: series("XLF", 100, 0.09),
    XLV: series("XLV", 100, 0.08),
    XLE: series("XLE", 100, 0.07),
    XLI: series("XLI", 100, 0.06),
  };
}

function businessDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10);
}

function makeBrokerMock(options: {
  nowIso: string;
  clock?: Record<string, unknown>;
  account?: Record<string, unknown>;
  positions?: PositionSnapshot[];
  openOrders?: Array<Record<string, unknown>>;
  quotes?: Record<string, { timestamp: string; bid: number; ask: number }>;
  dailyBars?: Record<string, Bar[]>;
}) {
  const orders = new Map<string, Record<string, unknown>>();
  let counter = 0;
  const state = {
    clock: options.clock ?? { timestamp: options.nowIso, is_open: true },
    account: options.account ?? { cash: 100, equity: 100, portfolio_value: 100, buying_power: 10_000, status: "ACTIVE" },
    positions: options.positions ?? [],
    openOrders: options.openOrders ?? [],
    quotes: options.quotes ?? {},
    dailyBars: options.dailyBars ?? {},
  };
  return {
    async getClock() {
      return state.clock;
    },
    async getAccount() {
      return state.account;
    },
    async getPositions() {
      return state.positions;
    },
    async getOpenOrders() {
      return state.openOrders;
    },
    async getDailyBars() {
      return state.dailyBars;
    },
    async getLatestQuote(symbol: string) {
      return state.quotes[symbol] ?? { symbol, timestamp: options.nowIso, bid: 100, ask: 100.1 };
    },
    async submitOrder(payload: Record<string, unknown>) {
      counter += 1;
      const id = `${String(payload.symbol)}-${counter}`;
      const order = {
        id,
        client_order_id: payload.client_order_id,
        symbol: String(payload.symbol),
        side: payload.side,
        type: payload.type,
        status: "filled",
        qty: payload.qty,
        filled_qty: payload.qty,
        limit_price: payload.limit_price ?? null,
        stop_price: payload.stop_price ?? null,
        filled_avg_price: payload.limit_price ?? null,
        created_at: options.nowIso,
        submitted_at: options.nowIso,
        filled_at: options.nowIso,
        raw: { payload },
      };
      orders.set(id, order);
      return order;
    },
    async cancelOrder(orderId: string) {
      orders.delete(orderId);
    },
    async getOrder(orderId: string) {
      const order = orders.get(orderId);
      if (!order) {
        throw new Error(`missing order ${orderId}`);
      }
      return order;
    },
  } as unknown as AlpacaClient;
}

function tempLedger(): { ledger: TradingLedger; path: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "mvalue-ledger-"));
  const path = join(root, "trading.sqlite");
  return {
    ledger: ensureLedger(path, "paper"),
    path,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("validateConfig rejects non-paper mode and non-IEX feed", () => {
  const config = makeConfig();
  assert.doesNotThrow(() => validateConfig(config));

  assert.throws(() => validateConfig({ ...config, execution_mode: "live" }), ContractError);
  assert.throws(() => validateConfig({ ...config, alpaca_data_feed: "sip" }), ContractError);
});

test("signals generate same-day intents during hourly market evaluation", async () => {
  const nowIso = "2026-07-06T15:00:00.000Z";
  const config = makeConfig();
  const { ledger, cleanup } = tempLedger();
  try {
    ledger.writeState(createDefaultState("paper"));
    const broker = makeBrokerMock({ nowIso, dailyBars: universe() });
    const service = createTradingCoreService({ config, ledger, broker, now: () => new Date(nowIso) });

    const result = await service.signalsIfDue();

    assert.equal(result.generated, true);
    assert.equal(result.trade_date, "2026-07-06");
    assert.ok(ledger.hasDailyIntent("2026-07-06"));
  } finally {
    cleanup();
  }
});

test("computeSignalPlan is deterministic, excludes SPY, and honors ranking ties", () => {
  const bars = universe();
  const holdings: PositionSnapshot[] = [];
  const first = computeSignalPlan({
    trade_date: "2026-07-06",
    generated_at: "2026-07-03T20:30:00.000Z",
    bars_by_symbol: bars,
    holdings,
  });
  const second = computeSignalPlan({
    trade_date: "2026-07-06",
    generated_at: "2026-07-03T20:30:00.000Z",
    bars_by_symbol: bars,
    holdings,
  });

  assert.deepEqual(first, second);
  assert.equal(first.decisions.some((decision) => decision.symbol === "SPY"), false);
  assert.equal(first.buy_candidate?.symbol, "IWM");
});

test("computeSignalPlan blocks XLK when QQQ is already held and exits weak holdings", () => {
  const bars = universe({ QQQ: 0.2, XLK: 0.19, XLE: 0.03, XLI: 0.02 });
  const plan = computeSignalPlan({
    trade_date: "2026-07-06",
    generated_at: "2026-07-03T20:30:00.000Z",
    bars_by_symbol: bars,
    holdings: [
      {
        symbol: "QQQ",
        qty: 1,
        market_value: 100,
        avg_entry_price: 100,
        current_price: 100,
        side: "long",
        entry_date: "2026-06-01",
      },
      {
        symbol: "XLE",
        qty: 1,
        market_value: 100,
        avg_entry_price: 100,
        current_price: 100,
        side: "long",
        entry_date: "2026-06-01",
      },
    ],
  });

  const xlk = plan.decisions.find((decision) => decision.symbol === "XLK");
  assert.ok(xlk);
  assert.equal(xlk?.checks.qqq_xlk_bucket_ok, false);
  assert.ok(plan.exit_symbols.includes("XLE"));
});

test("buildExecutionPlan enforces max positions, position sizing, and daily entry limits", () => {
  const signalPlan = computeSignalPlan({
    trade_date: "2026-07-06",
    generated_at: "2026-07-03T20:30:00.000Z",
    bars_by_symbol: universe(),
    holdings: [],
  });

  const limited = buildExecutionPlan({
    signal_plan: signalPlan,
    holdings: [
      { symbol: "QQQ", qty: 1, market_value: 50, avg_entry_price: 50, current_price: 50, side: "long" },
      { symbol: "XLV", qty: 1, market_value: 50, avg_entry_price: 50, current_price: 50, side: "long" },
    ],
    strategy_equity: 100,
    cash_available: 100,
    max_open_positions: 2,
    max_new_entries_per_day: 1,
    max_position_notional_pct: 0.3,
    max_total_invested_pct: 0.6,
    minimum_order_notional_usd: 15,
  });
  assert.equal(limited.buy_intent, null);

  const sized = buildExecutionPlan({
    signal_plan: signalPlan,
    holdings: [
      { symbol: "QQQ", qty: 1, market_value: 45, avg_entry_price: 45, current_price: 45, side: "long" },
    ],
    strategy_equity: 100,
    cash_available: 100,
    max_open_positions: 2,
    max_new_entries_per_day: 1,
    max_position_notional_pct: 0.3,
    max_total_invested_pct: 0.6,
    minimum_order_notional_usd: 15,
  });
  assert.ok(sized.buy_intent);
  const price = sized.buy_intent?.signal?.indicators.previous_close ?? 0;
  const expectedQuantity = Math.floor((15 / price) * 1000) / 1000;
  assert.equal(sized.buy_intent?.quantity, expectedQuantity);

  const entryLimited = buildExecutionPlan({
    signal_plan: signalPlan,
    holdings: [],
    strategy_equity: 100,
    cash_available: 100,
    max_open_positions: 2,
    max_new_entries_per_day: 0,
    max_position_notional_pct: 0.3,
    max_total_invested_pct: 0.6,
    minimum_order_notional_usd: 15,
  });
  assert.equal(entryLimited.buy_intent, null);
});

test("buildExecutionPlan tolerates missing holdings arrays from workflow inputs", () => {
  const signalPlan = computeSignalPlan({
    trade_date: "2026-07-06",
    generated_at: "2026-07-03T20:30:00.000Z",
    bars_by_symbol: universe(),
    holdings: [],
  });

  const execution = buildExecutionPlan({
    signal_plan: signalPlan,
    holdings: undefined as unknown as PositionSnapshot[],
    strategy_equity: 100,
    cash_available: 100,
    max_open_positions: 2,
    max_new_entries_per_day: 1,
    max_position_notional_pct: 0.3,
    max_total_invested_pct: 0.6,
    minimum_order_notional_usd: 15,
  });

  assert.equal(execution.sell_intents.length, 0);
  assert.ok(execution.buy_intent);
});

test("dailyReport tolerates malformed signal-plan snapshots and keeps array fields", async () => {
  const nowIso = "2026-07-06T14:10:00.000Z";
  const config = makeConfig();
  const { ledger, cleanup } = tempLedger();
  try {
    ledger.writeState(createDefaultState("paper"));
    ledger.saveSnapshot("signal_plan", {
      trade_date: "2026-07-06",
      generated_at: nowIso,
      buy_candidate: null,
      exit_symbols: [],
      no_trade_reason: "No trade",
    }, nowIso);
    const broker = makeBrokerMock({ nowIso });
    const service = createTradingCoreService({ config, ledger, broker, now: () => new Date(nowIso) });

    const report = await service.dailyReport();

    assert.deepEqual(report.signals, []);
    assert.deepEqual(report.skipped_trades, []);
    assert.deepEqual(report.open_orders, []);
  } finally {
    cleanup();
  }
});

test("cycle submits a filled buy order and records a position", async () => {
  const nowIso = "2026-07-06T14:10:00.000Z";
  const config = makeConfig();
  const { ledger, cleanup } = tempLedger();
  try {
    ledger.writeState(createDefaultState("paper"));
    const plan = computeSignalPlan({
      trade_date: "2026-07-06",
      generated_at: "2026-07-03T20:30:00.000Z",
      bars_by_symbol: universe(),
      holdings: [],
    });
    const quotePrice = plan.buy_candidate?.indicators.previous_close ?? 100;
    ledger.saveSnapshot("signal_plan", plan, nowIso);
    ledger.saveDailyIntent("2026-07-06", nowIso, plan);
    const broker = makeBrokerMock({
      nowIso,
      quotes: {
        [String(plan.buy_candidate?.symbol)]: {
          timestamp: nowIso,
          bid: round(quotePrice * 0.999),
          ask: round(quotePrice * 1.001),
        },
      },
    });
    const service = createTradingCoreService({ config, ledger, broker, now: () => new Date(nowIso) });

    const result = await service.cycleIfDue();
    const actions = result.actions as Array<Record<string, unknown>>;

    assert.equal(result.status, "ORDER_SUBMITTED");
    assert.equal(actions[0].status, "ORDER_SUBMITTED");
    assert.ok(ledger.getPosition(String(plan.buy_candidate?.symbol)));
  } finally {
    cleanup();
  }
});

test("cycle submits exits before buys and removes the sold position", async () => {
  const nowIso = "2026-07-06T14:10:00.000Z";
  const config = makeConfig();
  const { ledger, cleanup } = tempLedger();
  try {
    ledger.writeState(createDefaultState("paper"));
    ledger.upsertPosition({
      symbol: "QQQ",
      qty: 1,
      market_value: 100,
      avg_entry_price: 100,
      current_price: 100,
      unrealized_pl: 0,
      unrealized_plpc: 0,
      side: "long",
      entry_date: "2026-05-01",
      protective_stop_price: 90,
      protective_stop_order_id: null,
    }, nowIso);
    const signalPlan = {
      trade_date: "2026-07-06",
      generated_at: "2026-07-03T20:30:00.000Z",
      market_regime: "RISK_ON",
      spy: null,
      decisions: [],
      buy_candidate: null,
      exit_symbols: ["QQQ"],
      no_trade_reason: null,
    };
    ledger.saveSnapshot("signal_plan", signalPlan, nowIso);
    ledger.saveDailyIntent("2026-07-06", nowIso, signalPlan);
    const broker = makeBrokerMock({
      nowIso,
      positions: [
        {
          symbol: "QQQ",
          qty: 1,
          market_value: 100,
          avg_entry_price: 100,
          current_price: 100,
          unrealized_pl: 0,
          unrealized_plpc: 0,
          side: "long",
          entry_date: "2026-05-01",
          protective_stop_price: 90,
        },
      ],
      quotes: {
        QQQ: { timestamp: nowIso, bid: 121, ask: 121.1 },
      },
    });
    const service = createTradingCoreService({ config, ledger, broker, now: () => new Date(nowIso) });

    const result = await service.cycleIfDue();
    const actions = result.actions as Array<Record<string, unknown>>;

    const action = actions[0];
    assert.equal(action.status, "EXIT_SUBMITTED");
    assert.equal(ledger.getPosition("QQQ"), null);
  } finally {
    cleanup();
  }
});

test("watchdog pauses on missing stops and stale data", async () => {
  const nowIso = "2026-07-06T14:10:00.000Z";
  const config = makeConfig();
  const { ledger, cleanup } = tempLedger();
  try {
    ledger.writeState(createDefaultState("paper"));
    ledger.upsertPosition({
      symbol: "IWM",
      qty: 1,
      market_value: 100,
      avg_entry_price: 100,
      current_price: 100,
      unrealized_pl: 0,
      unrealized_plpc: 0,
      side: "long",
      entry_date: "2026-05-01",
      protective_stop_price: null,
      protective_stop_order_id: null,
    }, nowIso);
    const broker = makeBrokerMock({
      nowIso,
      positions: [
        {
          symbol: "IWM",
          qty: 1,
          market_value: 100,
          avg_entry_price: 100,
          current_price: 100,
          unrealized_pl: 0,
          unrealized_plpc: 0,
          side: "long",
          entry_date: "2026-05-01",
          protective_stop_price: null,
        },
      ],
      clock: {
        timestamp: "2026-07-06T11:00:00.000Z",
        is_open: true,
      },
    });
    const service = createTradingCoreService({ config, ledger, broker, now: () => new Date(nowIso) });

    const result = await service.watchdog();

    assert.equal(result.status, "BLOCKED");
    assert.equal(ledger.readState()?.trading_enabled, false);
    assert.equal(ledger.readState()?.pause_reason?.includes("Watchdog"), true);
  } finally {
    cleanup();
  }
});

test("requestResume refuses when reconciliation fails", async () => {
  const nowIso = "2026-07-06T14:10:00.000Z";
  const config = makeConfig();
  const { ledger, cleanup } = tempLedger();
  try {
    ledger.writeState({ ...createDefaultState("paper"), trading_enabled: false, pause_reason: "manual pause" });
    const broker = makeBrokerMock({
      nowIso,
      positions: [
        {
          symbol: "IWM",
          qty: 1,
          market_value: 100,
          avg_entry_price: 100,
          current_price: 100,
          unrealized_pl: 0,
          unrealized_plpc: 0,
          side: "long",
          entry_date: "2026-05-01",
          protective_stop_price: 90,
        },
      ],
    });
    const service = createTradingCoreService({ config, ledger, broker, now: () => new Date(nowIso) });

    const result = await service.requestResume("operator");

    assert.equal(result.status, "BLOCKED");
    assert.equal(ledger.readState()?.trading_enabled, false);
  } finally {
    cleanup();
  }
});

test("Alpaca daily bars parseBar defaults to symbol if missing", async () => {
  const { ledger, cleanup } = tempLedger();
  try {
    const config = makeConfig();
    const broker = new AlpacaClient(config, async (url) => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          bars: {
            "QQQ": [
              { t: "2026-07-06T00:00:00Z", o: 100, h: 101, l: 99, c: 100, v: 1000 }
            ]
          }
        })
      } as unknown as Response;
    });

    const bars = await broker.getDailyBars(["QQQ"], 1);
    assert.ok(bars["QQQ"]);
    assert.equal(bars["QQQ"][0].symbol, "QQQ");
  } finally {
    cleanup();
  }
});

test("loadTradingConfig reads custom watchlists and tradable symbols from env", () => {
  const customEnv = {
    ...process.env,
    MOUNTAINVALUE_WATCHLIST: "SPY, AAPL, MSFT",
    MOUNTAINVALUE_TRADABLE_SYMBOLS: "AAPL, MSFT",
    ALPACA_API_KEY: "test-key",
    ALPACA_SECRET_KEY: "test-secret"
  };
  const config = loadTradingConfig(customEnv);
  assert.deepEqual(config.watchlist_symbols, ["SPY", "AAPL", "MSFT"]);
  assert.deepEqual(config.tradable_symbols, ["AAPL", "MSFT"]);
});

test("asNullableNumber parses numeric strings returned by broker APIs", () => {
  assert.equal(asNullableNumber(100000), 100000);
  assert.equal(asNullableNumber("100000"), 100000);
  assert.equal(asNullableNumber("297.69"), 297.69);
  assert.equal(asNullableNumber("invalid"), undefined);
  assert.equal(asNullableNumber(undefined), undefined);
});

