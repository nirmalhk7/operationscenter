import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { createTradingCoreService, formatDiscordSummary, validateConfig, loadTradingConfig } from "../src/agent-turns.js";
import { asNullableNumber, BacktestResult, Bar, createDefaultState, ContractError, PositionSnapshot, TradingConfig } from "../src/contracts.js";
import { ensureLedger, TradingLedger } from "../src/ledger.js";
import { buildExecutionPlan, computeSignalPlan, computeTargetSignalPlan } from "../src/value-engine.js";
import { AlpacaClient } from "../src/adapters.js";
import { runDualMomentumBacktest } from "../src/backtest.js";
import { buildEtfResearch, currentDrawdownTier, lossBudgetQuantity, stopDistance } from "../src/research.js";

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function makeConfig(overrides: Partial<TradingConfig> = {}): TradingConfig {
  return {
    execution_mode: "paper",
    operating_mode: "paper",
    autonomous_execution_enabled: true,
    alpaca_trading_base_url: "https://paper-api.alpaca.markets",
    alpaca_data_base_url: "https://data.alpaca.markets",
    alpaca_data_feed: "iex",
    alpaca_api_key: "key",
    alpaca_secret_key: "secret",
    paper_strategy_capital_usd: 100,
    max_open_positions: 2,
    max_new_entries_per_day: 1,
    max_position_notional_pct: 0.2,
    etf_position_risk_pct: 0.018,
    max_total_invested_pct: 0.6,
    minimum_order_notional_usd: 15,
    max_quote_age_seconds: 60,
    max_spread_bps: 25,
    max_stock_spread_bps: 30,
    max_midpoint_deviation_pct: 0.015,
    max_strategy_drawdown_pct: 0.10,
    target_portfolio_volatility_pct: 0.10,
    execution_retry_interval_minutes: 15,
    execution_retry_cutoff_hour_et: 15.5,
    defensive_symbol: "BIL",
    order_client_prefix: "mvalue-paper-",
    ledger_path: join(tmpdir(), `mvalue-${Math.random().toString(36).slice(2)}.sqlite`),
    timezone: "America/New_York",
    watchlist_symbols: ["SPY", "QQQ", "IWM", "XLK", "XLF", "XLV", "XLE", "XLI", "BIL"],
    tradable_symbols: ["QQQ", "IWM", "XLK", "XLF", "XLV", "XLE", "XLI", "BIL"],
    ...overrides,
  };
}

function approvedBacktest(): BacktestResult {
  const metrics = { cumulative_return: 0.2, cagr: 0.1, annualized_volatility: 0.1, sharpe: 1, sortino: 1, max_drawdown: -0.05, turnover: 1, win_rate: 0.5, average_exposure: 0.8 };
  return {
    strategy: "dual_momentum", start_date: "2020-01-01", end_date: "2026-01-01", trading_days: 1000,
    metrics, baseline: metrics, benchmark: metrics, selected_strategy: "dual_momentum",
    walk_forward: { windows: 3, dual_momentum_wins: 3, passes: true },
    assumptions: { transaction_cost_bps: 10, slippage_bps: 10, rebalance_frequency: "daily" },
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
  submitOrderError?: Error;
  onSubmitOrder?: (payload: Record<string, unknown>) => void;
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
    async getCalendar() {
      const start = new Date(options.nowIso);
      return Array.from({ length: 10 }, (_, index) => {
        const date = new Date(start.getTime() + index * 86_400_000);
        return { date: date.toISOString().slice(0, 10), open: "09:30", close: "16:00" };
      }).filter((entry) => { const day = new Date(`${entry.date}T00:00:00Z`).getUTCDay(); return day > 0 && day < 6; });
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
      options.onSubmitOrder?.(payload);
      if (options.submitOrderError) {
        throw options.submitOrderError;
      }
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
  const ledger = ensureLedger(path, "paper");
  ledger.saveStrategyManifest({ strategy_version: "mountainvalue-v2.1.0-swing", created_at: "2026-07-06T00:00:00.000Z", sleeve: "etf", approval_status: "approved", expires_at: "2027-01-01T00:00:00.000Z", parameters: {}, data_as_of: "2026-07-06", approval_reason: "test" });
  ledger.saveTargets([{ strategy_version: "mountainvalue-v2.1.0-swing", as_of: "2026-07-06", symbol: "IWM", sleeve: "etf", target_weight: 0.2, reason: "test weekly swing target" }]);
  return {
    ledger,
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

test("signals lock next-business-day intents after the close", async () => {
  const nowIso = "2026-07-06T21:00:00.000Z";
  const config = makeConfig();
  const { ledger, cleanup } = tempLedger();
  try {
    ledger.writeState(createDefaultState("paper"));
    ledger.saveSnapshot("backtest", approvedBacktest(), nowIso);
    const broker = makeBrokerMock({ nowIso, dailyBars: universe() });
    const service = createTradingCoreService({ config, ledger, broker, now: () => new Date(nowIso) });

    const result = await service.signalsIfDue();

    assert.equal(result.generated, true);
    assert.equal(result.trade_date, "2026-07-07");
    assert.ok(ledger.hasDailyIntent("2026-07-07"));
  } finally {
    cleanup();
  }
});

test("signals use approved weekly targets even when a legacy backtest differs", async () => {
  const nowIso = "2026-07-06T21:00:00.000Z";
  const config = makeConfig();
  const { ledger, cleanup } = tempLedger();
  try {
    ledger.writeState(createDefaultState("paper"));
    ledger.saveSnapshot("backtest", { ...approvedBacktest(), selected_strategy: "baseline" }, nowIso);
    const service = createTradingCoreService({ config, ledger, broker: makeBrokerMock({ nowIso, dailyBars: universe() }), now: () => new Date(nowIso) });

    const result = await service.signalsIfDue();

    assert.equal(result.generated, true);
    const intent = ledger.readDailyIntent<ReturnType<typeof computeSignalPlan>>("2026-07-07");
    assert.ok(intent);
    assert.equal(intent?.buy_candidate?.symbol, "IWM");
  } finally {
    cleanup();
  }
});

test("computeTargetSignalPlan enters target drift and exits removed positions", () => {
  const plan = computeTargetSignalPlan({
    trade_date: "2026-07-06",
    generated_at: "2026-07-03T20:30:00.000Z",
    bars_by_symbol: universe(),
    holdings: [{ symbol: "QQQ", qty: 1, market_value: 100, avg_entry_price: 100, current_price: 100, side: "long" }],
    targets: [{ strategy_version: "mountainvalue-v2.1.0-swing", as_of: "2026-07-03", symbol: "IWM", sleeve: "etf", target_weight: 0.2, reason: "weekly target" }],
  });

  assert.equal(plan.buy_candidate?.symbol, "IWM");
  assert.deepEqual(plan.exit_symbols, ["QQQ"]);
  assert.equal(plan.decisions[0]?.checks.research_target, true);
});

test("computeTargetSignalPlan exits a held ETF after 20 trading sessions even when it remains a target", () => {
  const plan = computeTargetSignalPlan({
    trade_date: "2025-09-18",
    generated_at: "2025-09-17T20:30:00.000Z",
    bars_by_symbol: universe(),
    holdings: [{ symbol: "QQQ", qty: 1, market_value: 100, avg_entry_price: 100, current_price: 100, side: "long", entry_date: "2025-01-01" }],
    targets: [{ strategy_version: "mountainvalue-v3.0.0-20d-rotation", as_of: "2025-09-17", symbol: "QQQ", sleeve: "etf", target_weight: 0.3, reason: "rank 1" }],
  });
  assert.deepEqual(plan.exit_symbols, ["QQQ"]);
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

test("computeSignalPlan selects BIL as the defensive allocation in a risk-off regime", () => {
  const plan = computeSignalPlan({
    trade_date: "2026-07-06",
    generated_at: "2026-07-03T20:30:00.000Z",
    bars_by_symbol: { ...riskOffUniverse(), BIL: series("BIL", 100, 0.01) },
    holdings: [],
    watchlist_symbols: ["SPY", "QQQ", "IWM", "XLK", "XLF", "XLV", "XLE", "XLI", "BIL"],
    tradable_symbols: ["QQQ", "IWM", "XLK", "XLF", "XLV", "XLE", "XLI", "BIL"],
  });
  assert.equal(plan.market_regime, "RISK_OFF");
  assert.equal(plan.buy_candidate?.symbol, "BIL");
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

test("cycle submits stock limit prices with two-decimal precision", async () => {
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
    ledger.saveSnapshot("signal_plan", plan, nowIso);
    ledger.saveDailyIntent("2026-07-06", nowIso, plan);
    const submittedPayloads: Array<Record<string, unknown>> = [];
    const quotePrice = plan.buy_candidate?.indicators.previous_close ?? 100;
    const broker = makeBrokerMock({
      nowIso,
      onSubmitOrder: (payload) => { submittedPayloads.push(payload); },
      quotes: {
        [String(plan.buy_candidate?.symbol)]: { timestamp: nowIso, bid: quotePrice * 0.999, ask: quotePrice * 1.001 },
      },
    });
    const service = createTradingCoreService({ config, ledger, broker, now: () => new Date(nowIso) });

    await service.cycleIfDue();

    assert.equal(submittedPayloads.length, 1);
    const payload = submittedPayloads[0]!;
    assert.equal(Number(payload.limit_price).toFixed(2), String(payload.limit_price));
  } finally {
    cleanup();
  }
});

test("rejected buy is reported as skipped separately from the saved intent", async () => {
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
    ledger.saveSnapshot("signal_plan", plan, nowIso);
    ledger.saveDailyIntent("2026-07-06", nowIso, plan);
    const quotePrice = plan.buy_candidate?.indicators.previous_close ?? 100;
    const broker = makeBrokerMock({
      nowIso,
      submitOrderError: new ContractError("https://paper-api.alpaca.markets/v2/orders returned 422: 42210000: invalid limit_price"),
      quotes: {
        [String(plan.buy_candidate?.symbol)]: { timestamp: nowIso, bid: quotePrice * 0.999, ask: quotePrice * 1.001 },
      },
    });
    const service = createTradingCoreService({ config, ledger, broker, now: () => new Date(nowIso) });

    const cycle = await service.cycleIfDue();
    const report = await service.dailyReport();

    assert.equal(cycle.status, "SKIPPED");
    assert.equal(report.today_intent?.symbol, plan.buy_candidate?.symbol);
    assert.equal(report.execution?.status, "SKIPPED");
    assert.equal(report.execution?.actions[0]?.status, "SKIPPED");
    assert.match(String(report.execution?.actions[0]?.reason), /42210000/u);
    assert.deepEqual(report.open_orders, []);
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

test("reconciliation pauses new entries after the configured strategy drawdown", async () => {
  const nowIso = "2026-07-06T14:10:00.000Z";
  const config = makeConfig({ paper_strategy_capital_usd: 100, max_strategy_drawdown_pct: 0.10 });
  const { ledger, cleanup } = tempLedger();
  try {
    ledger.writeState({ ...createDefaultState("paper"), strategy_high_water_mark_usd: 100, virtual_cash_usd: 100 });
    const broker = makeBrokerMock({ nowIso, account: { cash: 89, equity: 89, portfolio_value: 89, buying_power: 89, status: "ACTIVE" } });
    const service = createTradingCoreService({ config, ledger, broker, now: () => new Date(nowIso) });
    const result = await service.reconcile();
    assert.equal(result.status, "BLOCKED");
    assert.match(String(result.reason), /strategy drawdown/u);
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

test("paused cycleIfDue reports BLOCKED without stacking pause_reason", async () => {
  const nowIso = "2026-07-06T14:10:00.000Z";
  const config = makeConfig();
  const { ledger, cleanup } = tempLedger();
  try {
    ledger.writeState({ ...createDefaultState("paper"), trading_enabled: false, pause_reason: "manual pause" });
    const broker = makeBrokerMock({ nowIso });
    const service = createTradingCoreService({ config, ledger, broker, now: () => new Date(nowIso) });

    const first = await service.cycleIfDue();
    const second = await service.cycleIfDue();

    assert.equal(first.status, "BLOCKED");
    assert.equal(second.status, "BLOCKED");
    assert.equal(first.reason, "manual pause");
    assert.equal(second.reason, "manual pause");
    assert.equal(ledger.readState()?.trading_enabled, false);
    assert.equal(ledger.readState()?.pause_reason, "manual pause");
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

test("Alpaca order errors include the broker response body", async () => {
  const { cleanup } = tempLedger();
  try {
    const config = makeConfig();
    const broker = new AlpacaClient(config, async () => new Response(JSON.stringify({
      code: 42210000,
      message: "invalid limit_price 123.457. sub-penny increment does not fulfill minimum pricing criteria",
    }), { status: 422, headers: { "content-type": "application/json" } }));

    await assert.rejects(
      () => broker.submitOrder({
        symbol: "XLI",
        side: "buy",
        type: "limit",
        time_in_force: "day",
        qty: 1,
        limit_price: 123.457,
        client_order_id: "test-order",
      }),
      /42210000: invalid limit_price/u,
    );
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

test("dual-momentum backtest reports baseline, benchmark, and a bounded drawdown selection", () => {
  const bars = { ...universe(), BIL: series("BIL", 100, 0.01) };
  const result = runDualMomentumBacktest({
    bars_by_symbol: bars,
    symbols: ["QQQ", "IWM", "XLK", "XLF", "XLV", "XLE", "XLI"],
    defensive_symbol: "BIL",
  });
  assert.ok(result.trading_days > 0);
  assert.equal(result.strategy, "dual_momentum");
  assert.ok(Number.isFinite(result.baseline.cagr));
  assert.ok(Number.isFinite(result.benchmark.cagr));
  assert.ok(["dual_momentum", "none"].includes(result.selected_strategy));
});

test("quote-guard skips schedule a bounded retry and Discord summary leads with no order", async () => {
  const nowIso = "2026-07-06T14:10:00.000Z";
  const config = makeConfig();
  const { ledger, cleanup } = tempLedger();
  try {
    ledger.writeState(createDefaultState("paper"));
    const plan = computeSignalPlan({ trade_date: "2026-07-06", generated_at: nowIso, bars_by_symbol: universe(), holdings: [] });
    ledger.saveDailyIntent("2026-07-06", nowIso, plan);
    const candidate = String(plan.buy_candidate?.symbol);
    const prior = plan.buy_candidate?.indicators.previous_close ?? 100;
    const broker = makeBrokerMock({ nowIso, quotes: { [candidate]: { timestamp: nowIso, bid: prior * 1.03, ask: prior * 1.031 } } });
    const service = createTradingCoreService({ config, ledger, broker, now: () => new Date(nowIso) });
    const cycle = await service.cycleIfDue();
    const report = await service.dailyReport();
    assert.equal(cycle.status, "SKIPPED");
    assert.ok(report.execution_retry?.retry_after);
    assert.match(formatDiscordSummary(report), /^\[PAPER\/paper\] NO ORDER/mu);
    assert.match(report.discord_summary, /retry/mu);
  } finally {
    cleanup();
  }
});

test("ETF research is deterministic and later bars cannot alter an earlier as-of result", () => {
  const bars = Object.fromEntries(["SPY", "VTI", "QQQ", "IWM", "VEA", "VWO", "VNQ", "GLD", "DBC", "IEF", "TLT", "BIL"].map((symbol, index) => [symbol, series(symbol, 100 + index, 0.12 + index / 100)]));
  const first = buildEtfResearch({ as_of: "2026-07-06", bars_by_symbol: bars });
  const changed = structuredClone(bars);
  changed.QQQ.push({ ...changed.QQQ.at(-1)!, t: "2027-01-01T00:00:00.000Z", c: 999, h: 1000, l: 998, o: 998.5 });
  const second = buildEtfResearch({ as_of: "2026-07-06", bars_by_symbol: Object.fromEntries(Object.entries(changed).map(([symbol, rows]) => [symbol, rows.filter((bar) => bar.t <= "2026-07-06T23:59:59Z")])) });
  assert.deepEqual(first, second);
  assert.ok(first.targets.find((target) => target.symbol === "BIL")!.target_weight >= 0.1);
  assert.ok(first.targets.filter((target) => target.sleeve === "etf").every((target) => target.target_weight <= 0.3));
  assert.equal(first.targets.filter((target) => target.sleeve === "etf").length, 3);
});

test("20-session rotation can submit three ETFs plus the BIL reserve in one cycle", () => {
  const targets = [
    { strategy_version: "mountainvalue-v3.0.0-20d-rotation", as_of: "2026-07-03", symbol: "IWM", sleeve: "etf" as const, target_weight: 0.3, reason: "rank 1" },
    { strategy_version: "mountainvalue-v3.0.0-20d-rotation", as_of: "2026-07-03", symbol: "QQQ", sleeve: "etf" as const, target_weight: 0.3, reason: "rank 2" },
    { strategy_version: "mountainvalue-v3.0.0-20d-rotation", as_of: "2026-07-03", symbol: "VTI", sleeve: "etf" as const, target_weight: 0.3, reason: "rank 3" },
    { strategy_version: "mountainvalue-v3.0.0-20d-rotation", as_of: "2026-07-03", symbol: "BIL", sleeve: "cash" as const, target_weight: 0.1, reason: "reserve" },
  ];
  const plan = computeTargetSignalPlan({ trade_date: "2026-07-06", generated_at: "2026-07-03T20:30:00.000Z", bars_by_symbol: { ...universe(), VTI: series("VTI", 100, 0.11), BIL: series("BIL", 100, 0.01) }, holdings: [], targets });
  const execution = buildExecutionPlan({ signal_plan: plan, holdings: [], strategy_equity: 100_000, cash_available: 100_000, max_open_positions: 4, max_new_entries_per_day: 4, max_position_notional_pct: 0.3, max_total_invested_pct: 1, minimum_order_notional_usd: 15, target_portfolio_volatility_pct: 0.25 });
  assert.equal(execution.buy_intents.length, 4);
  assert.deepEqual(execution.buy_intents.map((intent) => intent.symbol).sort(), ["BIL", "IWM", "QQQ", "VTI"]);
});

test("risk sizing and drawdown policy obey hard caps", () => {
  assert.equal(currentDrawdownTier(-0.079), "normal");
  assert.equal(currentDrawdownTier(-0.08), "reduce_25");
  assert.equal(currentDrawdownTier(-0.12), "reduce_50");
  assert.equal(currentDrawdownTier(-0.15), "halt");
  assert.equal(stopDistance(0.01, "etf", "VTI"), 0.06);
  assert.equal(stopDistance(0.06, "stock", "AAPL"), 0.15);
  assert.equal(stopDistance(0.01, "etf", "BIL"), null);
  assert.equal(lossBudgetQuantity({ nav: 100_000, targetWeight: 0.08, cash: 100_000, price: 100, stopDistance: 0.10, sleeve: "etf" }), 80);
  assert.equal(lossBudgetQuantity({ nav: 100_000, targetWeight: 0.30, cash: 100_000, price: 100, stopDistance: 0.06, sleeve: "etf", riskBudgetPct: 0.018 }), 299.999);
});

test("shadow mode records a proposed intent without a broker mutation", async () => {
  const nowIso = "2026-07-06T14:10:00.000Z";
  const config = makeConfig({ operating_mode: "shadow" });
  const { ledger, cleanup } = tempLedger();
  let submitted = 0;
  try {
    ledger.saveDailyIntent("2026-07-06", nowIso, computeSignalPlan({ trade_date: "2026-07-06", generated_at: nowIso, bars_by_symbol: universe(), holdings: [] }));
    const broker = makeBrokerMock({ nowIso, dailyBars: universe(), onSubmitOrder: () => { submitted += 1; } });
    const result = await createTradingCoreService({ config, ledger, broker, now: () => new Date(nowIso) }).cycleIfDue();
    assert.equal(result.status, "NO_TRADE");
    assert.equal(submitted, 0);
  } finally { cleanup(); }
});
