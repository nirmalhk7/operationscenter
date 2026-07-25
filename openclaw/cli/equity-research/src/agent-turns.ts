import { AlpacaClient } from "./adapters.js";
import {
  AccountSnapshot,
  AuditRecord,
  BacktestResult,
  ContractError,
  CycleResult,
  ExecutionMode,
  OrderSnapshot,
  PositionSnapshot,
  ReportSummary,
  StrategyManifest,
  TradeIntent,
  TradingConfig,
  TradingState,
  WorkflowStatus,
  createDefaultState,
  isTradableSymbol,
} from "./contracts.js";
import { TradingLedger } from "./ledger.js";
import { buildExecutionPlan, computeSignalPlan, computeTargetSignalPlan, ExecutionPlan } from "./value-engine.js";
import type { SignalPlan } from "./value-engine.js";
import { runDualMomentumBacktest } from "./backtest.js";
import { ETF_UNIVERSE, STRATEGY_VERSION, buildEtfResearch, currentDrawdownTier, lossBudgetQuantity, stopDistance } from "./research.js";
import { runShortHorizonValidation } from "./validation.js";

export interface ReconciliationResult {
  status: WorkflowStatus;
  trade_date: string;
  paused: boolean;
  reason: string | null;
  account: AccountSnapshot | null;
  positions: PositionSnapshot[];
  open_orders: OrderSnapshot[];
  strategy_equity: number;
  checks: Record<string, boolean | string | number | null>;
}

export interface RuntimeDependencies {
  config: TradingConfig;
  ledger: TradingLedger;
  broker: AlpacaClient;
  now?: () => Date;
}

export class TradingCoreService {
  constructor(private readonly deps: RuntimeDependencies) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private state(): TradingState {
    const current = this.deps.ledger.readState();
    if (current) {
      return current;
    }
    const created = createDefaultState(this.deps.config.execution_mode);
    created.starting_capital_usd = this.deps.config.paper_strategy_capital_usd;
    created.virtual_cash_usd = this.deps.config.paper_strategy_capital_usd;
    created.last_strategy_equity_usd = this.deps.config.paper_strategy_capital_usd;
    this.deps.ledger.writeState(created);
    return created;
  }

  private writeState(patch: Partial<TradingState>): TradingState {
    return this.deps.ledger.patchState(patch);
  }

  private audit(step: string, kind: AuditRecord["kind"], message: string, payload: Record<string, unknown> = {}, symbol?: string | null): void {
    this.deps.ledger.recordAudit({
      timestamp: this.now().toISOString(),
      step,
      kind,
      symbol: symbol ?? null,
      message,
      payload,
    });
  }

  private async currentTradeDate(): Promise<string> {
    return tradeDateInNewYork(this.now());
  }

  private async calendarAround(now: Date): Promise<string[]> {
    const start = new Date(now.getTime() - 3 * 86_400_000).toISOString().slice(0, 10);
    const end = new Date(now.getTime() + 10 * 86_400_000).toISOString().slice(0, 10);
    try {
      return (await this.deps.broker.getCalendar(start, end)).map((entry) => entry.date);
    } catch (error) {
      this.pause(`Unable to read Alpaca calendar: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private manifestCanCreateEntries(manifest: StrategyManifest | null, now: Date): boolean {
    return Boolean(manifest && manifest.approval_status === "approved" && (!manifest.expires_at || new Date(manifest.expires_at).getTime() > now.getTime()));
  }

  async preflight(): Promise<Record<string, unknown>> {
    const checks: Record<string, boolean | string | number> = {
      execution_mode_paper: this.deps.config.execution_mode === "paper",
      operating_mode_valid: ["shadow", "paper"].includes(this.deps.config.operating_mode),
      autonomous_execution_enabled: this.deps.config.autonomous_execution_enabled,
      alpaca_paper_endpoint: /paper-api\.alpaca\.markets/u.test(this.deps.config.alpaca_trading_base_url),
      alpaca_feed_iex: this.deps.config.alpaca_data_feed === "iex",
      alpaca_credentials_present: Boolean(this.deps.config.alpaca_api_key && this.deps.config.alpaca_secret_key),
    };
    const failed = Object.entries(checks).filter(([key, value]) => key !== "autonomous_execution_enabled" && value !== true).map(([key]) => key);
    const state = this.state();
    const account = await this.safeGetAccount();
    const clock = await this.safeGetClock();
    if (failed.length > 0) {
      this.pause(`Preflight failed: ${failed.join(", ")}`);
    } else {
      this.writeState({
        execution_mode: "paper",
        trading_enabled: state.trading_enabled,
        starting_capital_usd: this.deps.config.paper_strategy_capital_usd,
        virtual_cash_usd: state.virtual_cash_usd || this.deps.config.paper_strategy_capital_usd,
        last_strategy_equity_usd: state.last_strategy_equity_usd || this.deps.config.paper_strategy_capital_usd,
      });
    }
    this.audit("preflight", failed.length > 0 ? "warn" : "info", failed.length > 0 ? "Preflight found blocking checks." : "Preflight passed.", { checks, failed, account, clock });
    return {
      status: failed.length > 0 ? "BLOCKED" : "NO_TRADE",
      checks,
      failed,
      state: this.state(),
      account,
      clock,
    };
  }

  async reconcile(): Promise<ReconciliationResult> {
    const tradeDate = await this.currentTradeDate();
    const clock = await this.safeGetClock();
    const account = await this.safeGetAccount();
    const positions = await this.safeGetPositions();
    const openOrders = await this.safeGetOpenOrders();
    const state = this.state();
    const brokerSymbols = new Set(positions.map((position) => position.symbol));
    const ledgerSymbols = new Set(this.deps.ledger.listPositionSymbols());
    const manualPositions = positions.filter((position) => !ledgerSymbols.has(position.symbol));
    const unknownOrders = openOrders.filter((order) => !order.client_order_id?.startsWith(this.deps.config.order_client_prefix));
    const mismatchedPositions = positions.filter((position) => {
      const tracked = this.deps.ledger.getPosition(position.symbol);
      return tracked !== null && Math.abs((tracked.qty ?? 0) - (position.qty ?? 0)) > 1e-6;
    });
    const unknownSymbols = positions.filter((position) => !this.deps.config.tradable_symbols.includes(position.symbol));
    const checks: Record<string, boolean | string | number | null> = {
      account_present: Boolean(account),
      clock_present: Boolean(clock),
      positions_present: positions.length,
      open_orders_present: openOrders.length,
      no_manual_positions: manualPositions.length === 0,
      no_unknown_orders: unknownOrders.length === 0,
      no_mismatched_positions: mismatchedPositions.length === 0,
      no_universe_drift: unknownSymbols.length === 0,
      broker_symbols: [...brokerSymbols].join(","),
    };
    const failed = [
      ...(!account ? ["broker account unavailable"] : []),
      ...(!clock ? ["broker clock unavailable"] : []),
      ...(manualPositions.length > 0 ? [`manual positions: ${manualPositions.map((position) => position.symbol).join(", ")}`] : []),
      ...(unknownOrders.length > 0 ? [`unknown orders: ${unknownOrders.map((order) => order.id).join(", ")}`] : []),
      ...(mismatchedPositions.length > 0 ? [`position mismatches: ${mismatchedPositions.map((position) => position.symbol).join(", ")}`] : []),
      ...(unknownSymbols.length > 0 ? [`non-universe positions: ${unknownSymbols.map((position) => position.symbol).join(", ")}`] : []),
    ];
    const strategyEquity = this.strategyEquity(positions, account);
    const storedHighWaterMark = state.strategy_high_water_mark_usd === 100000 && this.deps.config.paper_strategy_capital_usd !== 100000
      ? this.deps.config.paper_strategy_capital_usd
      : state.strategy_high_water_mark_usd;
    const highWaterMark = Math.max(storedHighWaterMark || strategyEquity, strategyEquity);
    const drawdown = highWaterMark > 0 ? (strategyEquity - highWaterMark) / highWaterMark : 0;
    const drawdownTier = currentDrawdownTier(drawdown);
    if (drawdownTier === "halt" || drawdown <= -this.deps.config.max_strategy_drawdown_pct) {
      failed.push(`strategy drawdown ${round(Math.abs(drawdown) * 100)}% exceeded ${round(this.deps.config.max_strategy_drawdown_pct * 100)}% limit`);
    }
    const paused = failed.length > 0;
    if (paused) {
      this.pause(`Reconciliation failed: ${failed.join("; ")}`);
    } else {
      let openValue = 0;
      for (const position of safePositions(positions)) {
        openValue += position.market_value ?? position.qty * (position.current_price ?? position.avg_entry_price ?? 0);
      }
      this.writeState({
        virtual_cash_usd: account?.cash ?? state.virtual_cash_usd,
        last_strategy_equity_usd: strategyEquity,
        strategy_high_water_mark_usd: highWaterMark,
      });
      const mergedPositions = positions.map((position) => {
        const prior = this.deps.ledger.getPosition(position.symbol);
        const childStop = openOrders.find((order) => order.symbol === position.symbol && order.side === "sell" && order.type === "stop" && order.status !== "filled");
        return { ...normalizeBrokerPosition(position), entry_date: prior?.entry_date ?? position.entry_date, entry_order_id: prior?.entry_order_id ?? position.entry_order_id, protective_stop_price: childStop?.stop_price ?? prior?.protective_stop_price ?? null, protective_stop_order_id: childStop?.id ?? prior?.protective_stop_order_id ?? null };
      });
      this.deps.ledger.replacePositions(mergedPositions, this.now().toISOString());
      this.deps.ledger.saveSnapshot("account", account, this.now().toISOString());
      this.deps.ledger.saveSnapshot("positions", positions, this.now().toISOString());
      this.deps.ledger.saveSnapshot("orders", openOrders, this.now().toISOString());
      this.deps.ledger.savePerformance({ as_of: this.now().toISOString(), strategy_version: this.deps.ledger.latestStrategyManifest()?.strategy_version ?? "unversioned", nav: strategyEquity, high_water_mark: highWaterMark, drawdown_pct: drawdown, drawdown_tier: drawdownTier, benchmark_spy: null, benchmark_60_40: null });
    }
    this.audit("reconcile", paused ? "warn" : "info", paused ? "Reconciliation paused trading." : "Reconciliation passed.", { checks, failed, account, clock, position_count: positions.length, order_count: openOrders.length });
    return {
      status: paused ? "BLOCKED" : "NO_TRADE",
      trade_date: tradeDate,
      paused,
      reason: failed.length > 0 ? failed.join("; ") : null,
      account,
      positions,
      open_orders: openOrders,
      strategy_equity: strategyEquity,
      checks: { ...checks, strategy_drawdown_pct: round(drawdown), drawdown_tier: drawdownTier },
    };
  }

  async watchdog(): Promise<Record<string, unknown>> {
    const reconcile = await this.reconcile();
    const positions = reconcile.positions;
    const openOrders = reconcile.open_orders;
    const missingStops = positions.filter((position) => position.qty > 0 && position.symbol !== this.deps.config.defensive_symbol && !position.protective_stop_price);
    const clock = await this.safeGetClock();
    const staleData = isStaleClock(clock, this.now(), this.deps.config.max_quote_age_seconds);
    const checks = {
      missing_stops: missingStops.length,
      stale_data: staleData,
      trading_enabled: this.state().trading_enabled,
      paused: !this.state().trading_enabled,
    };
    const failed = missingStops.length > 0 || staleData;
    if (failed) {
      this.pause(`Watchdog failed: ${missingStops.length > 0 ? `missing stops for ${missingStops.map((position) => position.symbol).join(", ")}` : "stale data"}`);
    }
    this.writeState({ last_watchdog_for: reconcile.trade_date });
    this.audit("watchdog", failed ? "warn" : "info", failed ? "Watchdog found a blocking issue." : "Watchdog passed.", { checks, open_orders: openOrders.length, missing_stops: missingStops.map((position) => position.symbol) });
    return {
      status: failed ? "BLOCKED" : "NO_TRADE",
      trade_date: reconcile.trade_date,
      failed,
      checks,
      missing_stops: missingStops.map((position) => position.symbol),
      open_orders: openOrders.length,
    };
  }

  async signalsIfDue(): Promise<Record<string, unknown>> {
    const now = this.now();
    const leaseHolder = `signals-${process.pid}-${now.getTime()}`;
    if (!this.deps.ledger.acquireLease("mountainvalue-signals", leaseHolder, now.toISOString())) return this.skip("signals-if-due", "Another signal run holds the lease.");
    const calendar = await this.calendarAround(now);
    if (!calendar.includes(tradeDateInNewYork(now))) {
      return this.skip("signals-if-due", "Not a trading day.");
    }
    if (!isAfterNewYorkTime(now, 16, 20)) {
      return this.skip("signals-if-due", "Signals are locked after 16:20 ET for the next trading day.");
    }
    const currentTradeDate = await this.currentTradeDate();
    const executionDate = nextCalendarDate(calendar, currentTradeDate);
    if (!executionDate) return this.skip("signals-if-due", "Unable to resolve next Alpaca calendar session.");
    if (this.deps.ledger.hasDailyIntent(executionDate)) {
      return this.skip("signals-if-due", `Signal already locked for ${executionDate}.`);
    }
    const manifest = this.deps.ledger.latestStrategyManifest();
    if (!this.manifestCanCreateEntries(manifest, now)) {
      return this.skip("signals-if-due", `No current approved strategy manifest${manifest ? ` (${manifest.approval_status})` : ""}.`);
    }
    const approvedManifest = manifest as StrategyManifest;
    if (businessDaysBetween(approvedManifest.data_as_of, currentTradeDate) > 5) {
      return this.skip("signals-if-due", `Research data is stale: ${approvedManifest.data_as_of}.`);
    }
    const targets = this.deps.ledger.latestTargets(approvedManifest.strategy_version);
    if (targets.length === 0) return this.skip("signals-if-due", "No current research targets are recorded.");
    const bars = await this.deps.broker.getDailyBars(["SPY", ...this.deps.config.watchlist_symbols], 260);
    const positions = safePositions(this.deps.ledger.listOpenPositions());
    const signalPlan = computeTargetSignalPlan({
      trade_date: executionDate,
      generated_at: now.toISOString(),
      bars_by_symbol: bars,
      holdings: positions,
      targets,
    });
    this.deps.ledger.saveSnapshot("signal_plan", signalPlan, now.toISOString());
    this.deps.ledger.saveDailyIntent(executionDate, now.toISOString(), signalPlan);
    this.writeState({ last_signals_for: executionDate });
    this.audit("signals", "info", signalPlan.no_trade_reason ? `Signals recorded: ${signalPlan.no_trade_reason}` : "Signals recorded.", { market_regime: signalPlan.market_regime, buy_candidate: signalPlan.buy_candidate?.symbol ?? null, exit_symbols: signalPlan.exit_symbols });
    return {
      status: signalPlan.buy_candidate ? "NO_TRADE" : "NO_TRADE",
      trade_date: executionDate,
      generated: true,
      signal_plan: signalPlan,
    };
  }

  async cycleIfDue(): Promise<CycleResult> {
    const now = this.now();
    const leaseHolder = `cycle-${process.pid}-${now.getTime()}`;
    if (!this.deps.ledger.acquireLease("mountainvalue-cycle", leaseHolder, now.toISOString())) return this.recordCycleResult(this.cycleSkip(await this.currentTradeDate(), "Another execution run holds the lease."));
    const tradeDate = await this.currentTradeDate();
    const calendar = await this.calendarAround(now);
    if (!calendar.includes(tradeDate)) {
      return this.recordCycleResult(this.cycleSkip(tradeDate, "Not a trading day."));
    }
    if (!isAfterNewYorkTime(now, 10, 5)) {
      return this.recordCycleResult(this.cycleSkip(tradeDate, "Execution cycle starts after the open."));
    }
    if (isAfterNewYorkTime(now, Math.floor(this.deps.config.execution_retry_cutoff_hour_et), Math.round((this.deps.config.execution_retry_cutoff_hour_et % 1) * 60))) {
      return this.recordCycleResult(this.cycleSkip(tradeDate, `Entry retry cutoff reached at ${this.deps.config.execution_retry_cutoff_hour_et} ET.`));
    }
    if (!this.state().trading_enabled) {
      return this.recordCycleResult(this.cycleAlreadyPaused(tradeDate));
    }
    if (this.state().last_entry_date === tradeDate) {
      return this.recordCycleResult(this.cycleSkip(tradeDate, "Daily entry cap already used."));
    }
    const retryFor = this.state().entry_retry_for;
    const retryAfter = this.state().entry_retry_after;
    if (retryFor?.startsWith(`${tradeDate}:`) && retryAfter && new Date(retryAfter).getTime() > now.getTime()) {
      return this.recordCycleResult(this.cycleSkip(tradeDate, `Next entry retry is scheduled for ${retryAfter}.`));
    }
    const reconcile = await this.reconcile();
    if (reconcile.paused) {
      return this.recordCycleResult(this.cycleBlock(tradeDate, reconcile.reason ?? "reconciliation blocked trading"));
    }
    const clock = await this.safeGetClock();
    if (!clock?.is_open) {
      return this.recordCycleResult(this.cycleSkip(tradeDate, "Market is not open."));
    }
    const signalPlan = this.deps.ledger.readDailyIntent<SignalPlan>(tradeDate);
    if (!signalPlan || signalPlan.trade_date !== tradeDate) {
      return this.recordCycleResult(this.cycleSkip(tradeDate, "No saved trade intent for today."));
    }
    const signalGeneratedAt = this.deps.ledger.dailyIntentGeneratedAt(tradeDate);
    const manifest = this.deps.ledger.latestStrategyManifest();
    if (!this.manifestCanCreateEntries(manifest, now)) {
      return this.recordCycleResult(this.cycleSkip(tradeDate, "Strategy manifest is not approved/current; entries fail closed."));
    }
    const approvedManifest = manifest as StrategyManifest;
    if (!signalGeneratedAt || new Date(signalGeneratedAt).getTime() < new Date(approvedManifest.created_at).getTime()) {
      return this.recordCycleResult(this.cycleSkip(tradeDate, "Saved intent predates current strategy manifest; wait for a newly locked signal."));
    }
    const positions = safePositions(this.deps.ledger.listOpenPositions());
    const drawdownTier = this.deps.ledger.latestPerformance()?.drawdown_tier ?? "normal";
    const riskMultiplier = drawdownTier === "reduce_25" ? 0.75 : drawdownTier === "reduce_50" ? 0.50 : drawdownTier === "halt" ? 0 : 1;
    const executionPlan = buildExecutionPlan({
      signal_plan: signalPlan,
      holdings: positions,
      strategy_equity: reconcile.strategy_equity,
      cash_available: this.state().virtual_cash_usd,
      max_open_positions: this.deps.config.max_open_positions,
      max_new_entries_per_day: this.deps.config.max_new_entries_per_day,
      max_position_notional_pct: this.deps.config.max_position_notional_pct * riskMultiplier,
      max_total_invested_pct: this.deps.config.max_total_invested_pct * riskMultiplier,
      minimum_order_notional_usd: this.deps.config.minimum_order_notional_usd,
      target_portfolio_volatility_pct: this.deps.config.target_portfolio_volatility_pct,
    });
    if (this.deps.config.max_new_entries_per_day < 1) {
      return this.recordCycleResult(this.cycleSkip(tradeDate, "Daily entry limit is zero."));
    }
    const actions: Array<Record<string, unknown>> = [];
    const skipped: Array<Record<string, unknown>> = [...executionPlan.skipped];
    if (this.deps.config.operating_mode === "shadow" || !this.deps.config.autonomous_execution_enabled) {
      actions.push(...executionPlan.sell_intents.map((intent) => ({ status: "SHADOW", intent, reason: this.deps.config.operating_mode === "shadow" ? "Shadow mode: broker mutation prohibited." : "Autonomous execution disabled." })));
      actions.push(...executionPlan.buy_intents.map((intent) => ({ status: "SHADOW", intent, reason: this.deps.config.operating_mode === "shadow" ? "Shadow mode: broker mutation prohibited." : "Autonomous execution disabled." })));
      return this.recordCycleResult({ status: "NO_TRADE", trade_date: tradeDate, actions, skipped, paused: false, reason: "Proposed targets recorded without broker mutation." });
    }
    for (const intent of executionPlan.sell_intents) {
      const result = await this.executeSellIntent(intent);
      actions.push(result);
    }
    for (const intent of executionPlan.buy_intents) {
      const buyResult = await this.executeBuyIntent(intent);
      actions.push(buyResult);
      if (buyResult.status === "ORDER_SUBMITTED") {
        this.writeState({ last_entry_date: tradeDate, entry_retry_for: null, entry_retry_after: null, entry_retry_attempts: 0 });
      } else if (buyResult.status === "SKIPPED" && this.isRetriableEntrySkip(String(buyResult.reason ?? ""))) {
        const retryAfter = new Date(now.getTime() + this.deps.config.execution_retry_interval_minutes * 60_000).toISOString();
        const attempts = (this.state().entry_retry_attempts ?? 0) + 1;
        this.writeState({ entry_retry_for: `${tradeDate}:${intent.symbol}`, entry_retry_after: retryAfter, entry_retry_attempts: attempts });
        buyResult.retry_after = retryAfter;
        buyResult.retry_scheduled = true;
      }
    }
    this.writeState({ last_cycle_for: tradeDate });
    const status = actions.some((action) => action.status === "ORDER_SUBMITTED" || action.status === "EXIT_SUBMITTED")
      ? "ORDER_SUBMITTED"
      : actions.length > 0
        ? "SKIPPED"
        : "NO_TRADE";
    this.audit("cycle", "info", actions.length > 0 ? "Cycle executed." : "Cycle completed with no orders.", { actions, skipped, trade_date: tradeDate, clock });
    return this.recordCycleResult({
      status,
      trade_date: tradeDate,
      actions,
      skipped,
      paused: false,
    });
  }

  async cancelStaleEntriesIfDue(): Promise<Record<string, unknown>> {
    const now = this.now();
    const tradeDate = await this.currentTradeDate();
    if (!isWeekday(now)) {
      return this.skip("cancel-stale-entries-if-due", "Not a trading day.");
    }
    if (!isAfterNewYorkTime(now, 15, 45)) {
      return this.skip("cancel-stale-entries-if-due", "Stale-entry cancellation starts at 15:45 ET.");
    }
    const openOrders = await this.safeGetOpenOrders();
    if (this.deps.config.operating_mode === "shadow" || !this.deps.config.autonomous_execution_enabled) {
      return this.skip("cancel-stale-entries-if-due", "Shadow/disabled mode: broker cancellation prohibited.");
    }
    const staleOrders = openOrders.filter((order) => order.client_order_id?.startsWith(this.deps.config.order_client_prefix) && order.side === "buy" && order.status !== "filled");
    const canceled: Array<Record<string, unknown>> = [];
    for (const order of staleOrders) {
      await this.deps.broker.cancelOrder(order.id);
      this.deps.ledger.upsertOrder({ ...order, status: "canceled", canceled_at: now.toISOString(), raw: order.raw }, now.toISOString());
      canceled.push({ order_id: order.id, symbol: order.symbol, status: "canceled" });
    }
    this.writeState({ last_cancel_for: tradeDate });
    this.audit("cancel-stale", canceled.length > 0 ? "info" : "info", canceled.length > 0 ? "Canceled stale entry orders." : "No stale entry orders to cancel.", { canceled });
    return {
      status: canceled.length > 0 ? "SKIPPED" : "NO_TRADE",
      trade_date: tradeDate,
      canceled,
      paused: false,
    };
  }

  async dailyReport(): Promise<ReportSummary> {
    const tradeDate = await this.currentTradeDate();
    const account = await this.safeGetAccount();
    const positions = safePositions(this.deps.ledger.listOpenPositions());
    const openOrders = this.deps.ledger.listOpenOrders();
    const signalPlan = this.deps.ledger.readSnapshot<SignalPlan>("signal_plan");
    const intentUniverseCurrent = !signalPlan?.buy_candidate || this.deps.config.tradable_symbols.includes(signalPlan.buy_candidate.symbol);
    const currentSignalPlan = intentUniverseCurrent ? signalPlan : null;
    const todaySignalPlan = currentSignalPlan?.trade_date === tradeDate ? currentSignalPlan : null;
    const nextSignalPlan = currentSignalPlan && currentSignalPlan.trade_date > tradeDate ? currentSignalPlan : null;
    const cycle = this.deps.ledger.readSnapshot<CycleResult>("cycle");
    const execution = cycle?.trade_date === tradeDate ? cycle : null;
    const signalDecisions = Array.isArray(todaySignalPlan?.decisions) ? todaySignalPlan.decisions : [];
    const audits = this.deps.ledger.countAudits();
    let openValue = 0;
    for (const position of safePositions(positions)) {
      openValue += position.market_value ?? position.qty * (position.current_price ?? position.avg_entry_price ?? 0);
    }
    const strategyEquity = this.strategyEquity(positions, account);
    const state = this.state();
    const retry = state.entry_retry_for?.startsWith(`${tradeDate}:`) ? {
      trade_date: tradeDate,
      symbol: state.entry_retry_for.split(":").at(-1) ?? "",
      attempts: state.entry_retry_attempts ?? 0,
      retry_after: state.entry_retry_after,
      cutoff_at: `${tradeDate}T15:30:00-04:00`,
      reason: actionReason(execution?.actions?.[0]),
    } : null;
    const summary: ReportSummary = {
      mode: state.execution_mode,
      operating_mode: this.deps.config.operating_mode,
      trading_enabled: state.trading_enabled,
      trade_date: tradeDate,
      strategy_equity: strategyEquity,
      cash: state.virtual_cash_usd,
      realized_pnl: state.realized_pnl_usd,
      invested: openValue,
      open_positions: positions,
      open_orders: openOrders,
      today_intent: todaySignalPlan ? {
        trade_date: todaySignalPlan.trade_date,
        created_at: todaySignalPlan.generated_at,
        symbol: todaySignalPlan.buy_candidate?.symbol ?? "SPY",
        action: todaySignalPlan.buy_candidate ? "buy" : "none",
        reason: todaySignalPlan.no_trade_reason ?? (todaySignalPlan.buy_candidate ? todaySignalPlan.buy_candidate.reason : "no trade"),
        signal: todaySignalPlan.buy_candidate ?? undefined,
      } : null,
      next_intent: nextSignalPlan ? { trade_date: nextSignalPlan.trade_date, created_at: nextSignalPlan.generated_at, symbol: nextSignalPlan.buy_candidate?.symbol ?? "BIL", action: nextSignalPlan.buy_candidate ? "buy" : "none", reason: nextSignalPlan.no_trade_reason ?? nextSignalPlan.buy_candidate?.reason ?? "no trade", signal: nextSignalPlan.buy_candidate ?? undefined } : null,
      execution,
      execution_retry: retry,
      discord_summary: "",
      signals: signalDecisions,
      skipped_trades: signalDecisions
        .filter((decision) => !decision.eligible)
        .map((decision) => ({ symbol: decision.symbol, reason: decision.reason })),
      audit_count: audits,
      pause_reason: state.pause_reason,
      watchdog: this.deps.ledger.readSnapshot("watchdog") ?? {},
      strategy: this.deps.ledger.latestStrategyManifest(),
      drawdown: this.deps.ledger.latestPerformance(),
      implementation: paperImplementationStats(this.deps.ledger.listFills(this.deps.ledger.latestStrategyManifest()?.strategy_version)),
      stop_coverage: positions.map((position) => ({ symbol: position.symbol, sleeve: ETF_UNIVERSE.includes(position.symbol as typeof ETF_UNIVERSE[number]) ? "etf" : "stock", stop_price: position.protective_stop_price ?? null, stop_order_id: position.protective_stop_order_id ?? null, stop_distance_pct: position.avg_entry_price && position.protective_stop_price ? 1 - position.protective_stop_price / position.avg_entry_price : null, loss_budget_pct: ETF_UNIVERSE.includes(position.symbol as typeof ETF_UNIVERSE[number]) ? 0.01 : 0.0075, covered: position.symbol === this.deps.config.defensive_symbol || Boolean(position.protective_stop_price) })),
    };
    summary.discord_summary = formatDiscordSummary(summary);
    this.deps.ledger.saveSnapshot("report", summary, this.now().toISOString());
    this.audit("report", "info", "Daily report assembled.", { trade_date: tradeDate, strategy_equity: strategyEquity, open_positions: positions.length, open_orders: openOrders.length });
    return summary;
  }

  async status(): Promise<Record<string, unknown>> {
    const report = await this.dailyReport();
    return {
      status: this.state().trading_enabled ? "ACTIVE" : "PAUSED",
      ...report,
    };
  }

  async backtest(asOf?: string): Promise<Record<string, unknown>> {
    const effectiveAsOf = asOf ?? tradeDateInNewYork(this.now());
    const bars = await this.deps.broker.getDailyBars(["SPY", ...ETF_UNIVERSE], 2_520, { adjustment: "all", end: `${effectiveAsOf}T23:59:59Z` });
    const result = runDualMomentumBacktest({
      bars_by_symbol: bars,
      symbols: ETF_UNIVERSE.filter((symbol) => symbol !== this.deps.config.defensive_symbol),
      defensive_symbol: this.deps.config.defensive_symbol,
      transaction_cost_bps: 10,
      slippage_bps: 10,
    });
    const validation = runShortHorizonValidation({ bars_by_symbol: bars, as_of: effectiveAsOf, data_checksum: checksumOf(bars) });
    this.deps.ledger.saveSnapshot("backtest", { legacy_comparison: result, validation }, this.now().toISOString());
    this.deps.ledger.saveValidationRun(validation);
    // A historical experiment must never revoke a separately approved live
    // paper mandate.  build-targets is the sole writer for the v3 manifest;
    // this command remains an auditable research result only.
    this.audit("backtest", "info", "Purged rolling 20-session validation completed (informational; it cannot alter the active paper manifest).", { legacy_comparison: result, validation });
    return { legacy_comparison: result, validation, operational_effect: "informational_only" };
  }

  async dataSync(asOf?: string): Promise<Record<string, unknown>> {
    const effectiveAsOf = asOf ?? tradeDateInNewYork(this.now());
    if (!isAfterNewYorkTime(this.now(), 16, 20)) {
      return { status: "NO_TRADE", as_of: effectiveAsOf, reason: "Daily-bar research waits for the regular-market close." };
    }
    const cached = this.deps.ledger.readSnapshot<{ bars: Record<string, import("./contracts.js").Bar[]>; run: { strategy_version?: string } }>(`raw-bars:${effectiveAsOf}`);
    const expectedSymbols = ["SPY", ...ETF_UNIVERSE];
    if (cached && cached.run.strategy_version === STRATEGY_VERSION && expectedSymbols.every((symbol) => Array.isArray(cached.bars[symbol]) && cached.bars[symbol].length >= 21)) {
      return { status: "NO_TRADE", run: cached.run, symbols: Object.keys(cached.bars), bars_received: Object.fromEntries(Object.entries(cached.bars).map(([symbol, rows]) => [symbol, rows.length])), cached: true };
    }
    const symbols = expectedSymbols;
    const bars = await this.deps.broker.getDailyBars(symbols, 45, { adjustment: "all", end: `${effectiveAsOf}T23:59:59Z` });
    const requestedAt = this.now().toISOString();
    const checksum = checksumOf(bars);
    const run = { id: `${STRATEGY_VERSION}:data:${effectiveAsOf}:${checksum.slice(0, 12)}`, strategy_version: STRATEGY_VERSION, sleeve: "portfolio" as const, as_of: effectiveAsOf, created_at: requestedAt, immutable: true as const, data_provenance: [{ provider: "alpaca", source_url: this.deps.config.alpaca_data_base_url, requested_at: requestedAt, effective_as_of: effectiveAsOf, checksum }] };
    this.deps.ledger.saveResearchRun(run);
    this.deps.ledger.saveSnapshot(`raw-bars:${effectiveAsOf}`, { bars, run }, requestedAt);
    this.audit("data-sync", "info", "Cached adjusted Alpaca bars with provenance.", { run_id: run.id, symbols });
    return { status: "NO_TRADE", run, symbols, bars_received: Object.fromEntries(Object.entries(bars).map(([symbol, rows]) => [symbol, rows.length])) };
  }

  async researchEtfs(asOf?: string): Promise<Record<string, unknown>> {
    const effectiveAsOf = asOf ?? tradeDateInNewYork(this.now());
    if (!isAfterNewYorkTime(this.now(), 16, 20)) {
      return { status: "NO_TRADE", as_of: effectiveAsOf, reason: "ETF research waits for the regular-market close." };
    }
    const cached = this.deps.ledger.readSnapshot<{ strategy_version?: string } & Record<string, unknown>>(`etf-research:${effectiveAsOf}`);
    if (cached?.strategy_version === STRATEGY_VERSION) return { status: "NO_TRADE", ...cached, cached: true };
    const raw = this.deps.ledger.readSnapshot<{ bars: Record<string, import("./contracts.js").Bar[]> }>(`raw-bars:${effectiveAsOf}`);
    const bars = raw?.bars ?? await this.deps.broker.getDailyBars(["SPY", ...ETF_UNIVERSE], 45, { adjustment: "all", end: `${effectiveAsOf}T23:59:59Z` });
    const research = buildEtfResearch({ as_of: effectiveAsOf, bars_by_symbol: bars });
    this.deps.ledger.saveCandidateScores(research.scores);
    this.deps.ledger.saveTargets(research.targets);
    this.deps.ledger.saveSnapshot(`etf-research:${effectiveAsOf}`, research, this.now().toISOString());
    this.audit("research-etfs", "info", "Deterministic ETF scores and constrained targets generated.", { as_of: effectiveAsOf, selected: research.targets });
    return { status: "NO_TRADE", ...research };
  }

  async researchStocks(asOf?: string): Promise<Record<string, unknown>> {
    const effectiveAsOf = asOf ?? tradeDateInNewYork(this.now());
    const result = { status: "NO_TRADE", as_of: effectiveAsOf, sleeve: "stock", survivorship_limited: true, candidates: [], reason: "No point-in-time SEC fundamentals universe is cached. Stock sleeve remains research-only and cannot create targets." };
    this.deps.ledger.saveSnapshot(`stock-research:${effectiveAsOf}`, result, this.now().toISOString());
    this.audit("research-stocks", "warn", result.reason, result);
    return result;
  }

  async reviewStocks(asOf?: string): Promise<Record<string, unknown>> {
    const effectiveAsOf = asOf ?? tradeDateInNewYork(this.now());
    return { status: "NO_TRADE", as_of: effectiveAsOf, required_reviewers: ["eq_quantsieve", "eq_thesis_depth_reviewer", "eq_riskskeptic"], approved: [], vetoed: [], reason: "No stock candidates may pass without all three structured source-backed reviews; this command reports only." };
  }

  async buildTargets(asOf?: string): Promise<Record<string, unknown>> {
    const effectiveAsOf = asOf ?? tradeDateInNewYork(this.now());
    const existingTargets = this.deps.ledger.latestTargets(STRATEGY_VERSION);
    if (!isAfterNewYorkTime(this.now(), 16, 20)) {
      return { status: "NO_TRADE", as_of: effectiveAsOf, targets: existingTargets, operating_mode: this.deps.config.operating_mode, reason: "20-session rotation targets refresh once after each market close." };
    }
    const existing = this.deps.ledger.readSnapshot<Record<string, unknown>>(`etf-research:${effectiveAsOf}`);
    const research = existing ?? await this.researchEtfs(effectiveAsOf);
    const targets = this.deps.ledger.listTargets(STRATEGY_VERSION, effectiveAsOf);
    const paperEnabled = this.deps.config.operating_mode === "paper" && this.deps.config.autonomous_execution_enabled;
    this.deps.ledger.saveStrategyManifest({ strategy_version: STRATEGY_VERSION, created_at: this.now().toISOString(), sleeve: "portfolio", approval_status: paperEnabled ? "approved" : "shadow", expires_at: paperEnabled ? new Date(this.now().getTime() + 8 * 86_400_000).toISOString() : null, parameters: { rebalance: "daily_after_close", holding_horizon: "1_to_20_sessions", max_holding_sessions: 20, max_risk_assets: 0.90, min_bil: 0.10, max_etf_weight: 0.30, max_new_entries_per_day: 4, target_volatility: 0.25 }, data_as_of: effectiveAsOf, approval_reason: paperEnabled ? "User-authorized aggressive paper-only 20-session ETF rotation; deterministic daily research and risk guards active." : "Shadow deployment: targets observable only until paper mode is explicitly enabled.", survivorship_limited: true });
    return { status: "NO_TRADE", as_of: effectiveAsOf, targets, research_available: Boolean(research), operating_mode: this.deps.config.operating_mode };
  }

  async strategyStatus(): Promise<Record<string, unknown>> {
    return {
      status: "NO_TRADE",
      operating_mode: this.deps.config.operating_mode,
      manifest: this.deps.ledger.latestStrategyManifest(),
      backtest: this.deps.ledger.readSnapshot("backtest"),
      validation: this.deps.ledger.latestValidationRun(),
      performance: this.deps.ledger.latestPerformance(),
      latest_targets: this.deps.ledger.latestTargets(STRATEGY_VERSION),
    };
  }

  async weeklyReport(): Promise<Record<string, unknown>> {
    const report = await this.dailyReport();
    return { status: "NO_TRADE", generated_at: this.now().toISOString(), report, strategy: this.deps.ledger.latestStrategyManifest(), performance: this.deps.ledger.latestPerformance(), attribution: { etf: "pending normalized NAV history", stock: "research-only / no forward evidence" } };
  }

  pause(reason: string): TradingState {
    const next = this.writeState({
      trading_enabled: false,
      pause_reason: reason,
      paused_at: this.now().toISOString(),
    });
    this.audit("pause", "warn", reason, { reason });
    return next;
  }

  async requestResume(actor: string): Promise<Record<string, unknown>> {
    const state = this.state();
    if (state.execution_mode !== "paper") {
      throw new ContractError("Resume is only allowed in paper mode");
    }
    if (!state.pause_reason) {
      return { status: "NO_TRADE", resumed: false, reason: "Not paused." };
    }
    const reconciliation = await this.reconcile();
    if (reconciliation.paused) {
      return { status: "BLOCKED", resumed: false, reason: reconciliation.reason ?? "reconciliation failed" };
    }
    const resumed = this.writeState({
      trading_enabled: true,
      pause_reason: null,
      resumed_at: this.now().toISOString(),
      resumed_by: actor,
    });
    this.audit("resume", "info", `Resume requested by ${actor}.`, { actor });
    return { status: "NO_TRADE", resumed: true, state: resumed };
  }

  auditLog(limit = 25): AuditRecord[] {
    return this.deps.ledger.listAudits(limit);
  }

  validateContract(contract: string, document: unknown): unknown {
    if (contract === "decision") {
      return document;
    }
    if (contract === "report") {
      return document;
    }
    if (contract === "audit") {
      return document;
    }
    throw new ContractError("validate-contract requires decision, report, or audit");
  }

  private async executeBuyIntent(intent: TradeIntent): Promise<Record<string, unknown>> {
    try {
      const strategyVersion = this.deps.ledger.latestStrategyManifest()?.strategy_version;
      if (!strategyVersion) throw new ContractError("No strategy version linked to entry");
      const idempotencyKey = `${strategyVersion}:${intent.trade_date}:${intent.symbol}:buy`;
      const priorAttempt = this.deps.ledger.getOrderAttempt(idempotencyKey);
      if (priorAttempt?.broker_order_id) return { status: "SKIPPED", intent, reason: "Idempotent order attempt already exists.", attempt: priorAttempt };
      const quote = await this.deps.broker.getLatestQuote(intent.symbol);
      const sleeve = ETF_UNIVERSE.includes(intent.symbol as typeof ETF_UNIVERSE[number]) ? "etf" : "stock";
      this.validateEntryQuote(quote.timestamp, quote.bid, quote.ask, intent.signal?.indicators.previous_close ?? quote.ask, sleeve);
      const limitPrice = roundPrice(quote.ask * 1.001);
      const clientOrderId = `${this.deps.config.order_client_prefix}${intent.trade_date}-${intent.symbol}-buy`;
      const distance = stopDistance(intent.signal?.indicators.atr_percent ?? 0.03, sleeve, intent.symbol);
      const targetWeight = Number(intent.signal?.checks.target_weight ?? this.deps.config.max_position_notional_pct);
      const quantity = distance === null ? intent.quantity : lossBudgetQuantity({ nav: this.state().last_strategy_equity_usd, targetWeight, cash: this.state().virtual_cash_usd, price: limitPrice, stopDistance: distance, sleeve, riskBudgetPct: sleeve === "etf" ? this.deps.config.etf_position_risk_pct : undefined });
      if (!quantity || quantity <= 0) throw new ContractError("Risk-budgeted quantity is zero");
      const stopPrice = distance === null ? null : roundPrice(limitPrice * (1 - distance));
      this.deps.ledger.saveOrderAttempt({ idempotency_key: idempotencyKey, strategy_version: strategyVersion, trade_date: intent.trade_date, symbol: intent.symbol, side: "buy", status: "submitting", broker_order_id: null, created_at: this.now().toISOString(), payload: { intent, limit_price: limitPrice, stop_price: stopPrice } });
      const order = await this.deps.broker.submitOrder({
        symbol: intent.symbol,
        side: "buy",
        type: "limit",
        time_in_force: "day",
        qty: quantity,
        limit_price: limitPrice,
        client_order_id: clientOrderId,
        extended_hours: false,
        ...(stopPrice === null ? {} : { order_class: "oto", stop_loss: { stop_price: stopPrice } }),
      });
      this.deps.ledger.saveOrderAttempt({ idempotency_key: idempotencyKey, strategy_version: strategyVersion, trade_date: intent.trade_date, symbol: intent.symbol, side: "buy", status: order.status, broker_order_id: order.id, created_at: this.now().toISOString(), payload: { intent, order, stop_price: stopPrice } });
      this.deps.ledger.upsertOrder(order, this.now().toISOString());
      const filled = await this.tryFill(order.id);
      if (filled && filled.status === "filled") {
        const position: PositionSnapshot = {
          symbol: intent.symbol,
          qty: filled.filled_qty ?? quantity,
          market_value: (filled.filled_qty ?? quantity) * (filled.filled_avg_price ?? limitPrice),
          avg_entry_price: filled.filled_avg_price ?? limitPrice,
          current_price: filled.filled_avg_price ?? limitPrice,
          unrealized_pl: 0,
          unrealized_plpc: 0,
          side: "long",
          entry_date: intent.trade_date,
          entry_order_id: filled.id,
          protective_stop_price: stopPrice,
          protective_stop_order_id: null,
          raw: filled.raw,
        };
        this.deps.ledger.upsertPosition(position, this.now().toISOString());
        this.deps.ledger.saveSnapshot("position_stop_pending", position, this.now().toISOString());
        const fillPrice = filled.filled_avg_price ?? limitPrice;
        const referencePrice = (quote.bid + quote.ask) / 2;
        this.deps.ledger.saveFill({ broker_order_id: filled.id, symbol: filled.symbol, side: "buy", quantity: filled.filled_qty ?? quantity, price: fillPrice, filled_at: filled.filled_at ?? this.now().toISOString(), strategy_version: strategyVersion, reference_price: referencePrice, implementation_shortfall_bps: implementationShortfallBps("buy", fillPrice, referencePrice) });
        this.writeState({ virtual_cash_usd: Math.max(0, this.state().virtual_cash_usd - ((filled.filled_qty ?? quantity) * (filled.filled_avg_price ?? limitPrice))) });
      }
      this.audit("buy", "info", `Submitted buy order for ${intent.symbol}.`, { order, filled: filled.status, quote, intent });
      return { status: "ORDER_SUBMITTED", intent, order, filled: filled.status };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.audit("buy", "warn", `Buy skipped for ${intent.symbol}.`, { reason, intent });
      return { status: "SKIPPED", intent, reason };
    }
  }

  private async executeSellIntent(intent: TradeIntent): Promise<Record<string, unknown>> {
    const position = this.deps.ledger.getPosition(intent.symbol);
    if (!position) {
      return { status: "SKIPPED", intent, reason: "No tracked position." };
    }
    try {
      const quote = await this.deps.broker.getLatestQuote(intent.symbol);
      this.validateSellQuote(quote.timestamp, quote.bid);
      const limitPrice = roundPrice(quote.bid * 0.999);
      const clientOrderId = `${this.deps.config.order_client_prefix}${intent.trade_date}-${intent.symbol}-sell`;
      const order = await this.deps.broker.submitOrder({
        symbol: intent.symbol,
        side: "sell",
        type: "limit",
        time_in_force: "day",
        qty: position.qty,
        limit_price: limitPrice,
        client_order_id: clientOrderId,
        extended_hours: false,
      });
      this.deps.ledger.upsertOrder(order, this.now().toISOString());
      const filled = await this.tryFill(order.id);
      if (filled && filled.status === "filled") {
        this.deps.ledger.deletePosition(intent.symbol);
        const fillPrice = filled.filled_avg_price ?? limitPrice;
        const proceeds = (filled.filled_qty ?? position.qty) * fillPrice;
        const realizedDelta = (fillPrice - (position.avg_entry_price ?? limitPrice)) * (filled.filled_qty ?? position.qty);
        const strategyVersion = this.deps.ledger.latestStrategyManifest()?.strategy_version ?? "unversioned";
        const referencePrice = (quote.bid + quote.ask) / 2;
        this.deps.ledger.saveFill({ broker_order_id: filled.id, symbol: filled.symbol, side: "sell", quantity: filled.filled_qty ?? position.qty, price: fillPrice, filled_at: filled.filled_at ?? this.now().toISOString(), strategy_version: strategyVersion, reference_price: referencePrice, implementation_shortfall_bps: implementationShortfallBps("sell", fillPrice, referencePrice) });
        this.writeState({
          virtual_cash_usd: this.state().virtual_cash_usd + proceeds,
          realized_pnl_usd: this.state().realized_pnl_usd + realizedDelta,
        });
      }
      this.audit("sell", "info", `Submitted sell order for ${intent.symbol}.`, { order, filled: filled.status, quote, intent });
      return { status: "EXIT_SUBMITTED", intent, order, filled: filled.status };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.audit("sell", "warn", `Sell skipped for ${intent.symbol}.`, { reason, intent });
      return { status: "SKIPPED", intent, reason };
    }
  }

  private async tryFill(orderId: string): Promise<OrderSnapshot> {
    try {
      const order = await this.deps.broker.getOrder(orderId);
      this.deps.ledger.upsertOrder(order, this.now().toISOString());
      return order;
    } catch {
      const fallback = this.deps.ledger.getOrder(orderId);
      if (!fallback) {
        throw new ContractError(`Unable to reconcile order ${orderId}`);
      }
      return fallback;
    }
  }

  private skip(step: string, reason: string): Record<string, unknown> {
    this.audit(step, "info", reason, { reason });
    return { status: "SKIPPED", reason, step };
  }

  private cycleSkip(tradeDate: string, reason: string): CycleResult {
    this.audit("cycle-if-due", "info", reason, { reason });
    return { status: "SKIPPED", trade_date: tradeDate, actions: [], skipped: [{ reason }], paused: false, reason };
  }

  private cycleAlreadyPaused(tradeDate: string): CycleResult {
    const reason = this.state().pause_reason ?? "unknown reason";
    this.audit("cycle-if-due", "warn", reason, { reason });
    return { status: "BLOCKED", trade_date: tradeDate, actions: [], skipped: [], paused: true, reason };
  }

  private cycleBlock(tradeDate: string, reason: string): CycleResult {
    if (this.state().trading_enabled) {
      this.pause(reason);
    }
    this.audit("cycle-if-due", "warn", reason, { reason });
    return { status: "BLOCKED", trade_date: tradeDate, actions: [], skipped: [], paused: true, reason };
  }

  private recordCycleResult(result: CycleResult): CycleResult {
    this.deps.ledger.saveSnapshot("cycle", result, this.now().toISOString());
    return result;
  }

  private strategyEquity(positions: PositionSnapshot[], account: AccountSnapshot | null): number {
    const cash = account?.cash ?? this.state().virtual_cash_usd ?? this.deps.config.paper_strategy_capital_usd;
    let marketValue = 0;
    for (const position of safePositions(positions)) {
      marketValue += position.market_value ?? position.qty * (position.current_price ?? position.avg_entry_price ?? 0);
    }
    return round((cash ?? 0) + marketValue);
  }

  private async safeGetAccount(): Promise<AccountSnapshot | null> {
    try {
      const account = await this.deps.broker.getAccount();
      this.deps.ledger.saveSnapshot("account", account, this.now().toISOString());
      return account;
    } catch (error) {
      this.pause(`Unable to read Alpaca account: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private async safeGetPositions(): Promise<PositionSnapshot[]> {
    try {
      const positions = await this.deps.broker.getPositions();
      this.deps.ledger.saveSnapshot("positions", positions, this.now().toISOString());
      return positions.map(normalizeBrokerPosition);
    } catch (error) {
      this.pause(`Unable to read Alpaca positions: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private async safeGetOpenOrders(): Promise<OrderSnapshot[]> {
    try {
      const orders = await this.deps.broker.getOpenOrders();
      this.deps.ledger.saveSnapshot("orders", orders, this.now().toISOString());
      return orders;
    } catch (error) {
      this.pause(`Unable to read Alpaca orders: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private async safeGetClock(): Promise<{ timestamp: string; is_open: boolean } | null> {
    try {
      const clock = await this.deps.broker.getClock();
      this.deps.ledger.saveSnapshot("clock", clock, this.now().toISOString());
      return clock;
    } catch (error) {
      this.pause(`Unable to read Alpaca clock: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private validateEntryQuote(timestamp: string, bid: number, ask: number, priorClose: number, sleeve: "etf" | "stock"): void {
    const ageSeconds = Math.abs((this.now().getTime() - new Date(timestamp).getTime()) / 1000);
    if (!Number.isFinite(ageSeconds) || ageSeconds > this.deps.config.max_quote_age_seconds) {
      throw new ContractError(`Entry quote is stale (${Math.round(ageSeconds)}s old)`);
    }
    if (!(bid > 0 && ask > 0)) {
      throw new ContractError("Entry quote must contain positive bid and ask");
    }
    const midpoint = (bid + ask) / 2;
    const spreadBps = ((ask - bid) / midpoint) * 10_000;
    const cap = sleeve === "etf" ? this.deps.config.max_spread_bps : this.deps.config.max_stock_spread_bps;
    if (spreadBps > cap) {
      throw new ContractError(`Entry quote spread too wide (${round(spreadBps)} bps)`);
    }
    const deviation = Math.abs(midpoint - priorClose) / priorClose;
    if (deviation > this.deps.config.max_midpoint_deviation_pct) {
      throw new ContractError(`Entry quote midpoint deviates too far from prior close (${round(deviation * 100)}%)`);
    }
  }

  private isRetriableEntrySkip(reason: string): boolean {
    return /Entry quote (is stale|spread too wide|midpoint deviates too far)/u.test(reason);
  }

  private validateSellQuote(timestamp: string, bid: number): void {
    const ageSeconds = Math.abs((this.now().getTime() - new Date(timestamp).getTime()) / 1000);
    if (!Number.isFinite(ageSeconds) || ageSeconds > this.deps.config.max_quote_age_seconds) {
      throw new ContractError(`Sell quote is stale (${Math.round(ageSeconds)}s old)`);
    }
    if (!(bid > 0)) {
      throw new ContractError("Sell quote must contain a positive bid");
    }
  }
}

export function createTradingCoreService(deps: RuntimeDependencies): TradingCoreService {
  return new TradingCoreService(deps);
}

function actionReason(action: Record<string, unknown> | undefined): string | null {
  return typeof action?.reason === "string" ? action.reason : null;
}

export function formatDiscordSummary(report: ReportSummary): string {
  const action = report.execution?.actions[0];
  const actionStatus = typeof action?.status === "string" ? action.status : null;
  const outcome = report.execution?.paused || !report.trading_enabled
    ? "BLOCKED"
    : actionStatus === "ORDER_SUBMITTED"
      ? "ORDER SUBMITTED"
      : actionStatus === "EXIT_SUBMITTED"
        ? "EXIT SUBMITTED"
        : "NO ORDER";
  const intent = report.today_intent;
  const intentLine = intent?.action === "buy"
    ? `Intent: BUY ${intent.symbol}${intent.signal?.rank ? ` (rank ${intent.signal.rank}, score ${intent.signal.score})` : ""}.`
    : "Intent: no new entry.";
  const reason = actionReason(action) ?? report.execution?.reason ?? report.pause_reason ?? intent?.reason ?? "No action was due.";
  const retryLine = report.execution_retry?.retry_after
    ? `Next: retry ${report.execution_retry.symbol} after ${report.execution_retry.retry_after} if quote guards pass.`
    : "Next: wait for the next scheduled strategy step.";
  return [
    `[PAPER/${report.operating_mode ?? "paper"}] ${outcome}`,
    `Execution: ${actionStatus ?? report.execution?.status ?? "NO_TRADE"} — ${reason}`,
    intentLine,
    `Account: cash $${round(report.cash).toFixed(2)} | invested $${round(report.invested).toFixed(2)} | positions ${report.open_positions.length} | orders ${report.open_orders.length}.`,
    `Risk: ${report.pause_reason ? `paused (${report.pause_reason})` : `${report.drawdown?.drawdown_tier ?? "normal"}; stop coverage ${report.stop_coverage?.filter((risk) => risk.covered).length ?? 0}/${report.stop_coverage?.length ?? 0}`}.`,
    retryLine,
  ].join("\n");
}

export function loadTradingConfig(env = process.env): TradingConfig {
  const baseUrl = env.ALPACA_TRADING_BASE_URL?.trim() || "https://paper-api.alpaca.markets";
  const dataBaseUrl = env.ALPACA_DATA_BASE_URL?.trim() || "https://data.alpaca.markets";
  const executionMode = (env.EXECUTION_MODE?.trim() as ExecutionMode | undefined) || "paper";
  const operatingMode = (env.MOUNTAINVALUE_OPERATING_MODE?.trim() as TradingConfig["operating_mode"] | undefined) || "shadow";
  const watchlist = env.MOUNTAINVALUE_WATCHLIST?.trim()
    ? env.MOUNTAINVALUE_WATCHLIST.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : ["VTI", "QQQ", "IWM", "VEA", "VWO", "VNQ", "GLD", "DBC", "IEF", "TLT", "XLK", "XLF", "XLV", "XLE", "XLI", "BIL"];
  const tradable = env.MOUNTAINVALUE_TRADABLE_SYMBOLS?.trim()
    ? env.MOUNTAINVALUE_TRADABLE_SYMBOLS.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : ["VTI", "QQQ", "IWM", "VEA", "VWO", "VNQ", "GLD", "DBC", "IEF", "TLT", "XLK", "XLF", "XLV", "XLE", "XLI", "BIL"];
  const config: TradingConfig = {
    execution_mode: executionMode,
    operating_mode: operatingMode,
    autonomous_execution_enabled: env.AUTONOMOUS_EXECUTION_ENABLED?.trim() !== "false",
    alpaca_trading_base_url: baseUrl,
    alpaca_data_base_url: dataBaseUrl,
    alpaca_data_feed: env.ALPACA_DATA_FEED?.trim() || "iex",
    alpaca_api_key: env.ALPACA_API_KEY?.trim() || "",
    alpaca_secret_key: env.ALPACA_SECRET_KEY?.trim() || "",
    paper_strategy_capital_usd: parseNumber(env.PAPER_STRATEGY_CAPITAL_USD, 100000),
    max_open_positions: parseNumber(env.MOUNTAINVALUE_MAX_OPEN_POSITIONS, 8),
    max_new_entries_per_day: parseNumber(env.MOUNTAINVALUE_MAX_NEW_ENTRIES_PER_DAY, 1),
    max_position_notional_pct: parseNumber(env.MOUNTAINVALUE_MAX_POSITION_NOTIONAL_PCT, 0.30),
    etf_position_risk_pct: parseNumber(env.MOUNTAINVALUE_ETF_POSITION_RISK_PCT, 0.018),
    max_total_invested_pct: parseNumber(env.MOUNTAINVALUE_MAX_TOTAL_INVESTED_PCT, 1.00),
    minimum_order_notional_usd: parseNumber(env.MOUNTAINVALUE_MINIMUM_ORDER_NOTIONAL_USD, 15),
    max_quote_age_seconds: parseNumber(env.MOUNTAINVALUE_MAX_QUOTE_AGE_SECONDS, 15),
    max_spread_bps: parseNumber(env.MOUNTAINVALUE_MAX_SPREAD_BPS, 15),
    max_stock_spread_bps: parseNumber(env.MOUNTAINVALUE_MAX_STOCK_SPREAD_BPS, 30),
    max_midpoint_deviation_pct: parseNumber(env.MOUNTAINVALUE_MAX_MIDPOINT_DEVIATION_PCT, 0.015),
    max_strategy_drawdown_pct: parseNumber(env.MOUNTAINVALUE_MAX_STRATEGY_DRAWDOWN_PCT, 0.15),
    target_portfolio_volatility_pct: parseNumber(env.MOUNTAINVALUE_TARGET_PORTFOLIO_VOLATILITY_PCT, 0.25),
    execution_retry_interval_minutes: parseNumber(env.MOUNTAINVALUE_EXECUTION_RETRY_INTERVAL_MINUTES, 15),
    execution_retry_cutoff_hour_et: parseNumber(env.MOUNTAINVALUE_EXECUTION_RETRY_CUTOFF_HOUR_ET, 15.5),
    defensive_symbol: env.MOUNTAINVALUE_DEFENSIVE_SYMBOL?.trim().toUpperCase() || "BIL",
    order_client_prefix: env.MOUNTAINVALUE_ORDER_CLIENT_PREFIX?.trim() || "mvalue-paper-",
    ledger_path: env.MOUNTAINVALUE_LEDGER_PATH?.trim() || `${homeDirectory()}/.openclaw/mountainvalue/trading.sqlite`,
    timezone: env.MOUNTAINVALUE_TIMEZONE?.trim() || "America/New_York",
    watchlist_symbols: watchlist,
    tradable_symbols: tradable,
  };
  validateConfig(config);
  return config;
}

export function validateConfig(config: TradingConfig): void {
  if (config.execution_mode !== "paper") {
    throw new ContractError("MountainValue v1 only supports EXECUTION_MODE=paper");
  }
  if (config.operating_mode !== "shadow" && config.operating_mode !== "paper") {
    throw new ContractError("MOUNTAINVALUE_OPERATING_MODE must be shadow or paper");
  }
  if (!/paper-api\.alpaca\.markets/u.test(config.alpaca_trading_base_url)) {
    throw new ContractError("Alpaca trading base URL must be the paper endpoint");
  }
  if (config.alpaca_data_feed !== "iex") {
    throw new ContractError("Alpaca data feed must be iex");
  }
  if (!config.alpaca_api_key || !config.alpaca_secret_key) {
    throw new ContractError("Alpaca credentials are required");
  }
  const bounded = [
    ["MOUNTAINVALUE_MAX_TOTAL_INVESTED_PCT", config.max_total_invested_pct, 0, 1],
    ["MOUNTAINVALUE_MAX_POSITION_NOTIONAL_PCT", config.max_position_notional_pct, 0, 0.3],
    ["MOUNTAINVALUE_ETF_POSITION_RISK_PCT", config.etf_position_risk_pct, 0.005, 0.02],
    ["MOUNTAINVALUE_MAX_STRATEGY_DRAWDOWN_PCT", config.max_strategy_drawdown_pct, 0.01, 0.15],
    ["MOUNTAINVALUE_MAX_QUOTE_AGE_SECONDS", config.max_quote_age_seconds, 1, 60],
  ] as const;
  for (const [name, value, minimum, maximum] of bounded) if (value < minimum || value > maximum) throw new ContractError(`${name} must be between ${minimum} and ${maximum}`);
  if (config.execution_retry_cutoff_hour_et < 10.083 || config.execution_retry_cutoff_hour_et > 16) throw new ContractError("MOUNTAINVALUE_EXECUTION_RETRY_CUTOFF_HOUR_ET must be during regular US market hours");
}

function normalizeBrokerPosition(position: PositionSnapshot): PositionSnapshot {
  return {
    ...position,
    symbol: position.symbol.toUpperCase(),
  };
}

function safePositions(positions: PositionSnapshot[] | null | undefined): PositionSnapshot[] {
  return Array.isArray(positions) ? positions : [];
}

function isStaleClock(clock: { timestamp: string; is_open: boolean } | null, now: Date, maxAgeSeconds: number): boolean {
  if (!clock) {
    return true;
  }
  const timestamp = new Date(clock.timestamp);
  const ageSeconds = Math.abs((now.getTime() - timestamp.getTime()) / 1000);
  return !Number.isFinite(ageSeconds) || ageSeconds > maxAgeSeconds;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new ContractError(`Invalid numeric value: ${value}`);
  }
  return parsed;
}

function homeDirectory(): string {
  return process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || ".";
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function roundPrice(value: number): number {
  return Number(value.toFixed(2));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isWeekday(date: Date): boolean {
  const day = getNewYorkParts(date).weekday;
  return day >= 1 && day <= 5;
}

function isAfterNewYorkTime(date: Date, hour: number, minute: number): boolean {
  const parts = getNewYorkParts(date);
  if (parts.hour > hour) {
    return true;
  }
  if (parts.hour < hour) {
    return false;
  }
  return parts.minute >= minute;
}

function tradeDateInNewYork(date: Date): string {
  const parts = getNewYorkParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function nextBusinessDay(tradeDate: string, now: Date): string {
  const current = new Date(`${tradeDate}T00:00:00Z`);
  current.setUTCDate(current.getUTCDate() + 1);
  while (true) {
    const weekday = current.getUTCDay();
    if (weekday >= 1 && weekday <= 5) {
      return current.toISOString().slice(0, 10);
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }
}

function nextCalendarDate(calendar: string[], after: string): string | null {
  return [...calendar].sort().find((date) => date > after) ?? null;
}

function businessDaysBetween(start: string, end: string): number {
  let days = 0;
  const current = new Date(`${start}T00:00:00Z`);
  const limit = new Date(`${end}T00:00:00Z`);
  while (current < limit) {
    current.setUTCDate(current.getUTCDate() + 1);
    if (current.getUTCDay() > 0 && current.getUTCDay() < 6) days += 1;
  }
  return days;
}

function checksumOf(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function implementationShortfallBps(side: "buy" | "sell", fillPrice: number, referencePrice: number): number {
  if (!Number.isFinite(fillPrice) || !Number.isFinite(referencePrice) || referencePrice <= 0) return 0;
  const shortfall = side === "buy" ? fillPrice / referencePrice - 1 : referencePrice / fillPrice - 1;
  return Math.round(shortfall * 10_000 * 100) / 100;
}

function paperImplementationStats(fills: Array<{ implementation_shortfall_bps?: number }>): { fill_count: number; average_shortfall_bps: number | null; p95_shortfall_bps: number | null } {
  const shortfalls = fills.map((fill) => fill.implementation_shortfall_bps).filter((value): value is number => Number.isFinite(value)).sort((left, right) => left - right);
  if (shortfalls.length === 0) return { fill_count: 0, average_shortfall_bps: null, p95_shortfall_bps: null };
  return { fill_count: shortfalls.length, average_shortfall_bps: Math.round((shortfalls.reduce((sum, value) => sum + value, 0) / shortfalls.length) * 100) / 100, p95_shortfall_bps: shortfalls[Math.min(shortfalls.length - 1, Math.ceil(shortfalls.length * 0.95) - 1)] };
}

function getNewYorkParts(date: Date): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const records: Record<string, string> = {};
  for (const part of Array.isArray(parts) ? parts : []) {
    records[part.type] = part.value;
  }
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(records.year),
    month: Number(records.month),
    day: Number(records.day),
    hour: Number(records.hour),
    minute: Number(records.minute),
    weekday: weekdayMap[records.weekday] ?? 0,
  };
}
