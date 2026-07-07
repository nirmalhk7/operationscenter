import { AlpacaClient } from "./adapters.js";
import {
  AccountSnapshot,
  AuditRecord,
  ContractError,
  ExecutionMode,
  OrderSnapshot,
  PositionSnapshot,
  ReportSummary,
  TradeIntent,
  TradingConfig,
  TradingState,
  WorkflowStatus,
  createDefaultState,
  isTradableSymbol,
} from "./contracts.js";
import { TradingLedger } from "./ledger.js";
import { buildExecutionPlan, computeSignalPlan, ExecutionPlan } from "./value-engine.js";
import type { SignalPlan } from "./value-engine.js";

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

  async preflight(): Promise<Record<string, unknown>> {
    const checks: Record<string, boolean | string | number> = {
      execution_mode_paper: this.deps.config.execution_mode === "paper",
      autonomous_execution_enabled: this.deps.config.autonomous_execution_enabled,
      alpaca_paper_endpoint: /paper-api\.alpaca\.markets/u.test(this.deps.config.alpaca_trading_base_url),
      alpaca_feed_iex: this.deps.config.alpaca_data_feed === "iex",
      alpaca_credentials_present: Boolean(this.deps.config.alpaca_api_key && this.deps.config.alpaca_secret_key),
    };
    const failed = Object.entries(checks).filter(([, value]) => value !== true).map(([key]) => key);
    const state = this.state();
    const account = await this.safeGetAccount();
    const clock = await this.safeGetClock();
    if (failed.length > 0) {
      this.pause(`Preflight failed: ${failed.join(", ")}`);
    } else {
      this.writeState({
        execution_mode: "paper",
        trading_enabled: state.trading_enabled && true,
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
    const unknownSymbols = positions.filter((position) => !isTradableSymbol(position.symbol));
    const checks: Record<string, boolean | string | number | null> = {
      account_present: Boolean(account),
      positions_present: positions.length,
      open_orders_present: openOrders.length,
      no_manual_positions: manualPositions.length === 0,
      no_unknown_orders: unknownOrders.length === 0,
      no_mismatched_positions: mismatchedPositions.length === 0,
      no_universe_drift: unknownSymbols.length === 0,
      broker_symbols: [...brokerSymbols].join(","),
    };
    const failed = [
      ...(manualPositions.length > 0 ? [`manual positions: ${manualPositions.map((position) => position.symbol).join(", ")}`] : []),
      ...(unknownOrders.length > 0 ? [`unknown orders: ${unknownOrders.map((order) => order.id).join(", ")}`] : []),
      ...(mismatchedPositions.length > 0 ? [`position mismatches: ${mismatchedPositions.map((position) => position.symbol).join(", ")}`] : []),
      ...(unknownSymbols.length > 0 ? [`non-universe positions: ${unknownSymbols.map((position) => position.symbol).join(", ")}`] : []),
    ];
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
        last_strategy_equity_usd: (account?.cash ?? state.virtual_cash_usd) + openValue,
      });
      this.deps.ledger.replacePositions(positions.map(normalizeBrokerPosition), this.now().toISOString());
      this.deps.ledger.saveSnapshot("account", account, this.now().toISOString());
      this.deps.ledger.saveSnapshot("positions", positions, this.now().toISOString());
      this.deps.ledger.saveSnapshot("orders", openOrders, this.now().toISOString());
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
      strategy_equity: this.strategyEquity(positions, account),
      checks,
    };
  }

  async watchdog(): Promise<Record<string, unknown>> {
    const reconcile = await this.reconcile();
    const positions = reconcile.positions;
    const openOrders = reconcile.open_orders;
    const missingStops = positions.filter((position) => position.qty > 0 && !position.protective_stop_price);
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
    if (!isWeekday(now)) {
      return this.skip("signals-if-due", "Not a trading day.");
    }
    const currentTradeDate = await this.currentTradeDate();
    const executionDate = isAfterNewYorkTime(now, 16, 20) ? nextBusinessDay(currentTradeDate, now) : currentTradeDate;
    const bars = await this.deps.broker.getDailyBars(["SPY", "QQQ", "IWM", "XLK", "XLF", "XLV", "XLE", "XLI"], 260);
    const positions = safePositions(this.deps.ledger.listOpenPositions());
    const signalPlan = computeSignalPlan({
      trade_date: executionDate,
      generated_at: now.toISOString(),
      bars_by_symbol: bars,
      holdings: positions,
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

  async cycleIfDue(): Promise<Record<string, unknown>> {
    const now = this.now();
    if (!isWeekday(now)) {
      return this.skip("cycle-if-due", "Not a trading day.");
    }
    if (!isAfterNewYorkTime(now, 10, 5)) {
      return this.skip("cycle-if-due", "Execution cycle starts after the open.");
    }
    const tradeDate = await this.currentTradeDate();
    if (!this.state().trading_enabled) {
      return this.block("cycle-if-due", `Paused: ${this.state().pause_reason ?? "unknown reason"}`);
    }
    if (this.state().last_entry_date === tradeDate) {
      return this.skip("cycle-if-due", "Daily entry cap already used.");
    }
    const reconcile = await this.reconcile();
    if (reconcile.paused) {
      return this.block("cycle-if-due", reconcile.reason ?? "reconciliation blocked trading");
    }
    const clock = await this.safeGetClock();
    if (!clock?.is_open) {
      return this.skip("cycle-if-due", "Market is not open.");
    }
    const signalPlan = this.deps.ledger.readDailyIntent<SignalPlan>(tradeDate) ?? this.deps.ledger.readSnapshot<SignalPlan>("signal_plan");
    if (!signalPlan || signalPlan.trade_date !== tradeDate) {
      return this.skip("cycle-if-due", "No saved trade intent for today.");
    }
    const positions = safePositions(this.deps.ledger.listOpenPositions());
    const executionPlan = buildExecutionPlan({
      signal_plan: signalPlan,
      holdings: positions,
      strategy_equity: reconcile.strategy_equity,
      cash_available: this.state().virtual_cash_usd,
      max_open_positions: this.deps.config.max_open_positions,
      max_new_entries_per_day: this.deps.config.max_new_entries_per_day,
      max_position_notional_pct: this.deps.config.max_position_notional_pct,
      max_total_invested_pct: this.deps.config.max_total_invested_pct,
      minimum_order_notional_usd: this.deps.config.minimum_order_notional_usd,
    });
    if (this.deps.config.max_new_entries_per_day < 1) {
      return this.skip("cycle-if-due", "Daily entry limit is zero.");
    }
    const actions: Array<Record<string, unknown>> = [];
    const skipped: Array<Record<string, unknown>> = [...executionPlan.skipped];
    for (const intent of executionPlan.sell_intents) {
      const result = await this.executeSellIntent(intent);
      actions.push(result);
    }
    if (executionPlan.buy_intent) {
      const buyResult = await this.executeBuyIntent(executionPlan.buy_intent);
      actions.push(buyResult);
      if (buyResult.status === "ORDER_SUBMITTED") {
        this.writeState({ last_entry_date: tradeDate });
      }
    }
    this.writeState({ last_cycle_for: tradeDate });
    this.audit("cycle", actions.length > 0 ? "info" : "info", actions.length > 0 ? "Cycle executed." : "Cycle completed with no orders.", { actions, skipped, trade_date: tradeDate, clock });
    return {
      status: actions.length > 0 ? "ORDER_SUBMITTED" : "NO_TRADE",
      trade_date: tradeDate,
      actions,
      skipped,
      paused: false,
    };
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
    const signalDecisions = Array.isArray(signalPlan?.decisions) ? signalPlan.decisions : [];
    const audits = this.deps.ledger.countAudits();
    let openValue = 0;
    for (const position of safePositions(positions)) {
      openValue += position.market_value ?? position.qty * (position.current_price ?? position.avg_entry_price ?? 0);
    }
    const strategyEquity = this.strategyEquity(positions, account);
    const state = this.state();
    const summary: ReportSummary = {
      mode: state.execution_mode,
      trading_enabled: state.trading_enabled,
      trade_date: tradeDate,
      strategy_equity: strategyEquity,
      cash: state.virtual_cash_usd,
      realized_pnl: state.realized_pnl_usd,
      invested: openValue,
      open_positions: positions,
      open_orders: openOrders,
      today_intent: signalPlan ? {
        trade_date: signalPlan.trade_date,
        created_at: signalPlan.generated_at,
        symbol: signalPlan.buy_candidate?.symbol ?? "SPY",
        action: signalPlan.buy_candidate ? "buy" : "none",
        reason: signalPlan.no_trade_reason ?? (signalPlan.buy_candidate ? signalPlan.buy_candidate.reason : "no trade"),
        signal: signalPlan.buy_candidate ?? undefined,
      } : null,
      signals: signalDecisions,
      skipped_trades: signalDecisions
        .filter((decision) => !decision.eligible)
        .map((decision) => ({ symbol: decision.symbol, reason: decision.reason })),
      audit_count: audits,
      pause_reason: state.pause_reason,
      watchdog: this.deps.ledger.readSnapshot("watchdog") ?? {},
    };
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
      const quote = await this.deps.broker.getLatestQuote(intent.symbol);
      this.validateEntryQuote(quote.timestamp, quote.bid, quote.ask, intent.signal?.indicators.previous_close ?? quote.ask);
      const limitPrice = round(quote.ask * 1.001);
      const clientOrderId = `${this.deps.config.order_client_prefix}${intent.trade_date}-${intent.symbol}-buy`;
      const order = await this.deps.broker.submitOrder({
        symbol: intent.symbol,
        side: "buy",
        type: "limit",
        time_in_force: "day",
        qty: intent.quantity,
        limit_price: limitPrice,
        client_order_id: clientOrderId,
        extended_hours: false,
      });
      this.deps.ledger.upsertOrder(order, this.now().toISOString());
      const filled = await this.tryFill(order.id);
      if (filled && filled.status === "filled") {
        const atrPercent = intent.signal?.indicators.atr_percent ?? 0.03;
        const stopPercent = clamp(atrPercent * 2, 0.03, 0.06);
        const stopPrice = round((filled.filled_avg_price ?? limitPrice) * (1 - stopPercent));
        const position: PositionSnapshot = {
          symbol: intent.symbol,
          qty: filled.filled_qty ?? intent.quantity ?? 0,
          market_value: (filled.filled_qty ?? intent.quantity ?? 0) * (filled.filled_avg_price ?? limitPrice),
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
        this.writeState({ virtual_cash_usd: Math.max(0, this.state().virtual_cash_usd - ((filled.filled_qty ?? intent.quantity ?? 0) * (filled.filled_avg_price ?? limitPrice))) });
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
      const limitPrice = round(quote.bid * 0.999);
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
        const proceeds = (filled.filled_qty ?? position.qty) * (filled.filled_avg_price ?? limitPrice);
        const realizedDelta = ((filled.filled_avg_price ?? limitPrice) - (position.avg_entry_price ?? limitPrice)) * (filled.filled_qty ?? position.qty);
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

  private block(step: string, reason: string): Record<string, unknown> {
    this.pause(reason);
    this.audit(step, "warn", reason, { reason });
    return { status: "BLOCKED", reason, step };
  }

  private strategyEquity(positions: PositionSnapshot[], account: AccountSnapshot | null): number {
    const cash = this.state().virtual_cash_usd ?? account?.cash ?? this.deps.config.paper_strategy_capital_usd;
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

  private validateEntryQuote(timestamp: string, bid: number, ask: number, priorClose: number): void {
    const ageSeconds = Math.abs((this.now().getTime() - new Date(timestamp).getTime()) / 1000);
    if (!Number.isFinite(ageSeconds) || ageSeconds > this.deps.config.max_quote_age_seconds) {
      throw new ContractError(`Entry quote is stale (${Math.round(ageSeconds)}s old)`);
    }
    if (!(bid > 0 && ask > 0)) {
      throw new ContractError("Entry quote must contain positive bid and ask");
    }
    const midpoint = (bid + ask) / 2;
    const spreadBps = ((ask - bid) / midpoint) * 10_000;
    if (spreadBps > this.deps.config.max_spread_bps) {
      throw new ContractError(`Entry quote spread too wide (${round(spreadBps)} bps)`);
    }
    const deviation = Math.abs(midpoint - priorClose) / priorClose;
    if (deviation > this.deps.config.max_midpoint_deviation_pct) {
      throw new ContractError(`Entry quote midpoint deviates too far from prior close (${round(deviation * 100)}%)`);
    }
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

export function loadTradingConfig(env = process.env): TradingConfig {
  const baseUrl = env.ALPACA_TRADING_BASE_URL?.trim() || "https://paper-api.alpaca.markets";
  const dataBaseUrl = env.ALPACA_DATA_BASE_URL?.trim() || "https://data.alpaca.markets";
  const executionMode = (env.EXECUTION_MODE?.trim() as ExecutionMode | undefined) || "paper";
  const config: TradingConfig = {
    execution_mode: executionMode,
    autonomous_execution_enabled: env.AUTONOMOUS_EXECUTION_ENABLED?.trim() !== "false",
    alpaca_trading_base_url: baseUrl,
    alpaca_data_base_url: dataBaseUrl,
    alpaca_data_feed: env.ALPACA_DATA_FEED?.trim() || "iex",
    alpaca_api_key: env.ALPACA_API_KEY?.trim() || "",
    alpaca_secret_key: env.ALPACA_SECRET_KEY?.trim() || "",
    paper_strategy_capital_usd: parseNumber(env.PAPER_STRATEGY_CAPITAL_USD, 100000),
    max_open_positions: parseNumber(env.MOUNTAINVALUE_MAX_OPEN_POSITIONS, 2),
    max_new_entries_per_day: parseNumber(env.MOUNTAINVALUE_MAX_NEW_ENTRIES_PER_DAY, 1),
    max_position_notional_pct: parseNumber(env.MOUNTAINVALUE_MAX_POSITION_NOTIONAL_PCT, 0.3),
    max_total_invested_pct: parseNumber(env.MOUNTAINVALUE_MAX_TOTAL_INVESTED_PCT, 0.6),
    minimum_order_notional_usd: parseNumber(env.MOUNTAINVALUE_MINIMUM_ORDER_NOTIONAL_USD, 15),
    max_quote_age_seconds: parseNumber(env.MOUNTAINVALUE_MAX_QUOTE_AGE_SECONDS, 60),
    max_spread_bps: parseNumber(env.MOUNTAINVALUE_MAX_SPREAD_BPS, 25),
    max_midpoint_deviation_pct: parseNumber(env.MOUNTAINVALUE_MAX_MIDPOINT_DEVIATION_PCT, 0.015),
    order_client_prefix: env.MOUNTAINVALUE_ORDER_CLIENT_PREFIX?.trim() || "mvalue-paper-",
    ledger_path: env.MOUNTAINVALUE_LEDGER_PATH?.trim() || `${homeDirectory()}/.openclaw/mountainvalue/trading.sqlite`,
    timezone: env.MOUNTAINVALUE_TIMEZONE?.trim() || "America/New_York",
  };
  validateConfig(config);
  return config;
}

export function validateConfig(config: TradingConfig): void {
  if (config.execution_mode !== "paper") {
    throw new ContractError("MountainValue v1 only supports EXECUTION_MODE=paper");
  }
  if (!config.autonomous_execution_enabled) {
    throw new ContractError("AUTONOMOUS_EXECUTION_ENABLED must be true");
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
    const parts = getNewYorkParts(current);
    if (parts.weekday >= 1 && parts.weekday <= 5) {
      return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }
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
