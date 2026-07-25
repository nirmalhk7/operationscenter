import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  AuditRecord,
  AgentReview,
  CandidateScore,
  ContractError,
  Fill,
  OrderSnapshot,
  OrderAttempt,
  PerformanceSnapshot,
  PositionSnapshot,
  StrategyManifest,
  TargetAllocation,
  TradeIntent,
  TradingState,
  createDefaultState,
} from "./contracts.js";

function stringify(value: unknown): string {
  return JSON.stringify(value);
}

function parse<T>(value: string | undefined, fallback: T | null): T | null {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export class TradingLedger {
  constructor(private readonly db: DatabaseSync) {}

  static open(path: string, mode: TradingState["execution_mode"]): TradingLedger {
    mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    try {
      db.exec(`
        PRAGMA busy_timeout = 30000;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS snapshots (
          kind TEXT PRIMARY KEY,
          updated_at TEXT NOT NULL,
          payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS daily_intents (
          trade_date TEXT PRIMARY KEY,
          generated_at TEXT NOT NULL,
          payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS positions (
          symbol TEXT PRIMARY KEY,
          updated_at TEXT NOT NULL,
          payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS orders (
          id TEXT PRIMARY KEY,
          updated_at TEXT NOT NULL,
          payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS audit_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL,
          step TEXT NOT NULL,
          kind TEXT NOT NULL,
          symbol TEXT,
          message TEXT NOT NULL,
          payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS strategy_manifests (strategy_version TEXT PRIMARY KEY, created_at TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS research_runs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS candidate_scores (strategy_version TEXT NOT NULL, as_of TEXT NOT NULL, symbol TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(strategy_version, as_of, symbol));
        CREATE TABLE IF NOT EXISTS agent_reviews (strategy_version TEXT NOT NULL, as_of TEXT NOT NULL, symbol TEXT NOT NULL, reviewer TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(strategy_version, as_of, symbol, reviewer));
        CREATE TABLE IF NOT EXISTS target_allocations (strategy_version TEXT NOT NULL, as_of TEXT NOT NULL, symbol TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(strategy_version, as_of, symbol));
        CREATE TABLE IF NOT EXISTS order_attempts (idempotency_key TEXT PRIMARY KEY, created_at TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS fills (broker_order_id TEXT PRIMARY KEY, filled_at TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS performance_snapshots (as_of TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS run_leases (name TEXT PRIMARY KEY, holder TEXT NOT NULL, expires_at TEXT NOT NULL, acquired_at TEXT NOT NULL);
      `);
      const ledger = new TradingLedger(db);
      ledger.db.prepare("INSERT INTO schema_meta (key, value) VALUES ('schema_version', '2') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
      if (!ledger.readState()) {
        ledger.writeState(createDefaultState(mode));
      }
      return ledger;
    } catch (error) {
      db.close();
      throw error;
    }
  }

  readState(): TradingState | null {
    const row = this.db.prepare("SELECT payload FROM state WHERE id = 1").get() as { payload?: string } | undefined;
    if (!row?.payload) {
      return null;
    }
    return parse<TradingState>(row.payload, createDefaultState("paper"));
  }

  writeState(state: TradingState): void {
    this.db.prepare(`
      INSERT INTO state (id, payload)
      VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload
    `).run(stringify(state));
  }

  patchState(patch: Partial<TradingState>): TradingState {
    const current = this.readState() ?? createDefaultState("paper");
    const next = { ...current, ...patch };
    this.writeState(next);
    return next;
  }

  saveSnapshot(kind: string, payload: unknown, timestamp: string): void {
    this.db.prepare(`
      INSERT INTO snapshots (kind, updated_at, payload)
      VALUES (?, ?, ?)
      ON CONFLICT(kind) DO UPDATE SET updated_at = excluded.updated_at, payload = excluded.payload
    `).run(kind, timestamp, stringify(payload));
  }

  readSnapshot<T>(kind: string): T | null {
    const row = this.db.prepare("SELECT payload FROM snapshots WHERE kind = ?").get(kind) as { payload?: string } | undefined;
    if (!row?.payload) {
      return null;
    }
    return parse<T>(row.payload, null as T | null);
  }

  recordAudit(entry: AuditRecord): void {
    this.db.prepare(`
      INSERT INTO audit_events (timestamp, step, kind, symbol, message, payload)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      entry.timestamp,
      entry.step,
      entry.kind,
      entry.symbol ?? null,
      entry.message,
      stringify(entry.payload ?? {}),
    );
  }

  listAudits(limit = 50): AuditRecord[] {
    const rows = this.db.prepare(`
      SELECT timestamp, step, kind, symbol, message, payload
      FROM audit_events
      ORDER BY id DESC
      LIMIT ?
    `).all(limit) as Array<Record<string, string | null>>;
    return rows.map((row) => ({
      timestamp: String(row.timestamp ?? ""),
      step: String(row.step ?? ""),
      kind: String(row.kind ?? "info") as AuditRecord["kind"],
      symbol: row.symbol ?? undefined,
      message: String(row.message ?? ""),
      payload: parse<Record<string, unknown>>(String(row.payload ?? "{}"), {}) ?? {},
    })).reverse();
  }

  saveDailyIntent(tradeDate: string, generatedAt: string, payload: unknown): void {
    this.db.prepare(`
      INSERT INTO daily_intents (trade_date, generated_at, payload)
      VALUES (?, ?, ?)
      ON CONFLICT(trade_date) DO UPDATE SET generated_at = excluded.generated_at, payload = excluded.payload
    `).run(tradeDate, generatedAt, stringify(payload));
  }

  readDailyIntent<T>(tradeDate: string): T | null {
    const row = this.db.prepare("SELECT payload FROM daily_intents WHERE trade_date = ?").get(tradeDate) as { payload?: string } | undefined;
    if (!row?.payload) {
      return null;
    }
    return parse<T>(row.payload, null as T | null);
  }

  dailyIntentGeneratedAt(tradeDate: string): string | null {
    const row = this.db.prepare("SELECT generated_at FROM daily_intents WHERE trade_date = ?").get(tradeDate) as { generated_at?: string } | undefined;
    return row?.generated_at ?? null;
  }

  latestDailyIntent<T>(): T | null {
    const row = this.db.prepare("SELECT payload FROM daily_intents ORDER BY trade_date DESC LIMIT 1").get() as { payload?: string } | undefined;
    return row?.payload ? parse<T>(row.payload, null as T | null) : null;
  }

  saveStrategyManifest(manifest: StrategyManifest): void {
    this.db.prepare("INSERT INTO strategy_manifests (strategy_version, created_at, payload) VALUES (?, ?, ?) ON CONFLICT(strategy_version) DO UPDATE SET payload = excluded.payload").run(manifest.strategy_version, manifest.created_at, stringify(manifest));
  }

  getStrategyManifest(strategyVersion: string): StrategyManifest | null {
    const row = this.db.prepare("SELECT payload FROM strategy_manifests WHERE strategy_version = ?").get(strategyVersion) as { payload?: string } | undefined;
    return row?.payload ? parse<StrategyManifest>(row.payload, null) : null;
  }

  latestStrategyManifest(): StrategyManifest | null {
    const row = this.db.prepare("SELECT payload FROM strategy_manifests ORDER BY created_at DESC LIMIT 1").get() as { payload?: string } | undefined;
    return row?.payload ? parse<StrategyManifest>(row.payload, null) : null;
  }

  saveResearchRun(run: { id: string; created_at: string }): void {
    this.db.prepare("INSERT INTO research_runs (id, created_at, payload) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload").run(run.id, run.created_at, stringify(run));
  }

  saveCandidateScores(scores: CandidateScore[]): void {
    const statement = this.db.prepare("INSERT INTO candidate_scores (strategy_version, as_of, symbol, payload) VALUES (?, ?, ?, ?) ON CONFLICT(strategy_version, as_of, symbol) DO UPDATE SET payload = excluded.payload");
    this.db.exec("BEGIN IMMEDIATE");
    try { for (const score of scores) statement.run(score.strategy_version, score.as_of, score.symbol, stringify(score)); this.db.exec("COMMIT"); } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  listCandidateScores(strategyVersion: string, asOf: string): CandidateScore[] {
    return (this.db.prepare("SELECT payload FROM candidate_scores WHERE strategy_version = ? AND as_of = ? ORDER BY symbol").all(strategyVersion, asOf) as Array<{ payload: string }>)
      .map((row) => parse<CandidateScore>(row.payload, null)).filter((value): value is CandidateScore => value !== null);
  }

  saveAgentReview(review: AgentReview): void {
    this.db.prepare("INSERT INTO agent_reviews (strategy_version, as_of, symbol, reviewer, payload) VALUES (?, ?, ?, ?, ?) ON CONFLICT(strategy_version, as_of, symbol, reviewer) DO UPDATE SET payload = excluded.payload").run(review.strategy_version, review.as_of, review.symbol, review.reviewer, stringify(review));
  }

  listAgentReviews(strategyVersion: string, asOf: string, symbol?: string): AgentReview[] {
    const rows = symbol
      ? this.db.prepare("SELECT payload FROM agent_reviews WHERE strategy_version = ? AND as_of = ? AND symbol = ?").all(strategyVersion, asOf, symbol)
      : this.db.prepare("SELECT payload FROM agent_reviews WHERE strategy_version = ? AND as_of = ?").all(strategyVersion, asOf);
    return (rows as Array<{ payload: string }>).map((row) => parse<AgentReview>(row.payload, null)).filter((value): value is AgentReview => value !== null);
  }

  saveTargets(targets: TargetAllocation[]): void {
    const statement = this.db.prepare("INSERT INTO target_allocations (strategy_version, as_of, symbol, payload) VALUES (?, ?, ?, ?) ON CONFLICT(strategy_version, as_of, symbol) DO UPDATE SET payload = excluded.payload");
    this.db.exec("BEGIN IMMEDIATE");
    try { for (const target of targets) statement.run(target.strategy_version, target.as_of, target.symbol, stringify(target)); this.db.exec("COMMIT"); } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  listTargets(strategyVersion: string, asOf: string): TargetAllocation[] {
    return (this.db.prepare("SELECT payload FROM target_allocations WHERE strategy_version = ? AND as_of = ? ORDER BY symbol").all(strategyVersion, asOf) as Array<{ payload: string }>)
      .map((row) => parse<TargetAllocation>(row.payload, null)).filter((value): value is TargetAllocation => value !== null);
  }

  latestTargets(strategyVersion: string): TargetAllocation[] {
    const row = this.db.prepare("SELECT as_of FROM target_allocations WHERE strategy_version = ? ORDER BY as_of DESC LIMIT 1").get(strategyVersion) as { as_of?: string } | undefined;
    return row?.as_of ? this.listTargets(strategyVersion, row.as_of) : [];
  }

  saveOrderAttempt(attempt: OrderAttempt): void {
    this.db.prepare("INSERT INTO order_attempts (idempotency_key, created_at, payload) VALUES (?, ?, ?) ON CONFLICT(idempotency_key) DO UPDATE SET payload = excluded.payload").run(attempt.idempotency_key, attempt.created_at, stringify(attempt));
  }

  getOrderAttempt(key: string): OrderAttempt | null {
    const row = this.db.prepare("SELECT payload FROM order_attempts WHERE idempotency_key = ?").get(key) as { payload?: string } | undefined;
    return row?.payload ? parse<OrderAttempt>(row.payload, null) : null;
  }

  saveFill(fill: Fill): void {
    this.db.prepare("INSERT INTO fills (broker_order_id, filled_at, payload) VALUES (?, ?, ?) ON CONFLICT(broker_order_id) DO UPDATE SET payload = excluded.payload").run(fill.broker_order_id, fill.filled_at, stringify(fill));
  }

  savePerformance(snapshot: PerformanceSnapshot): void {
    this.db.prepare("INSERT INTO performance_snapshots (as_of, payload) VALUES (?, ?) ON CONFLICT(as_of) DO UPDATE SET payload = excluded.payload").run(snapshot.as_of, stringify(snapshot));
  }

  latestPerformance(): PerformanceSnapshot | null {
    const row = this.db.prepare("SELECT payload FROM performance_snapshots ORDER BY as_of DESC LIMIT 1").get() as { payload?: string } | undefined;
    return row?.payload ? parse<PerformanceSnapshot>(row.payload, null) : null;
  }

  acquireLease(name: string, holder: string, now: string, ttlMs = 14 * 60_000): boolean {
    const expiresAt = new Date(new Date(now).getTime() + ttlMs).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM run_leases WHERE expires_at <= ?").run(now);
      const existing = this.db.prepare("SELECT holder FROM run_leases WHERE name = ?").get(name) as { holder?: string } | undefined;
      if (existing && existing.holder !== holder) { this.db.exec("COMMIT"); return false; }
      this.db.prepare("INSERT INTO run_leases (name, holder, expires_at, acquired_at) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at, acquired_at = excluded.acquired_at").run(name, holder, expiresAt, now);
      this.db.exec("COMMIT"); return true;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  releaseLease(name: string, holder: string): void {
    this.db.prepare("DELETE FROM run_leases WHERE name = ? AND holder = ?").run(name, holder);
  }

  replacePositions(positions: PositionSnapshot[], updatedAt: string): void {
    const deleteStmt = this.db.prepare("DELETE FROM positions");
    const insertStmt = this.db.prepare(`
      INSERT INTO positions (symbol, updated_at, payload)
      VALUES (?, ?, ?)
    `);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      deleteStmt.run();
      for (const position of positions) {
        insertStmt.run(position.symbol, updatedAt, stringify(position));
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  upsertPosition(position: PositionSnapshot, updatedAt: string): void {
    this.db.prepare(`
      INSERT INTO positions (symbol, updated_at, payload)
      VALUES (?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET updated_at = excluded.updated_at, payload = excluded.payload
    `).run(position.symbol, updatedAt, stringify(position));
  }

  deletePosition(symbol: string): void {
    this.db.prepare("DELETE FROM positions WHERE symbol = ?").run(symbol);
  }

  listPositions(): PositionSnapshot[] {
    const rows = this.db.prepare("SELECT payload FROM positions ORDER BY symbol").all() as Array<{ payload?: string }>;
    return rows
      .map((row) => parse<PositionSnapshot>(row.payload ?? "", null as unknown as PositionSnapshot))
      .filter((position): position is PositionSnapshot => position !== null);
  }

  listPositionSymbols(): string[] {
    return this.listPositions().map((position) => position.symbol);
  }

  upsertOrder(order: OrderSnapshot, updatedAt: string): void {
    this.db.prepare(`
      INSERT INTO orders (id, updated_at, payload)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, payload = excluded.payload
    `).run(order.id, updatedAt, stringify(order));
  }

  listOrders(): OrderSnapshot[] {
    const rows = this.db.prepare("SELECT payload FROM orders ORDER BY updated_at DESC").all() as Array<{ payload?: string }>;
    return rows
      .map((row) => parse<OrderSnapshot>(row.payload ?? "", null as unknown as OrderSnapshot))
      .filter((order): order is OrderSnapshot => order !== null);
  }

  listOpenOrders(): OrderSnapshot[] {
    return this.listOrders().filter((order) => ["new", "accepted", "partially_filled", "pending_new", "pending_cancel", "pending_replace"].includes(order.status));
  }

  listOpenPositions(): PositionSnapshot[] {
    return this.listPositions().filter((position) => position.qty !== 0);
  }

  getPosition(symbol: string): PositionSnapshot | null {
    return this.listPositions().find((position) => position.symbol === symbol) ?? null;
  }

  getOrder(id: string): OrderSnapshot | null {
    return this.listOrders().find((order) => order.id === id) ?? null;
  }

  countAudits(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get() as { count?: number } | undefined;
    return Number(row?.count ?? 0);
  }

  hasDailyIntent(tradeDate: string): boolean {
    return this.readDailyIntent(tradeDate) !== null;
  }

  close(): void {
    this.db.close();
  }
}

export function ensureLedger(path: string, mode: TradingState["execution_mode"]): TradingLedger {
  if (!path) {
    throw new ContractError("ledger path required");
  }
  return TradingLedger.open(path, mode);
}
