import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  AuditRecord,
  ContractError,
  OrderSnapshot,
  PositionSnapshot,
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
    db.exec(`
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
    `);
    const ledger = new TradingLedger(db);
    if (!ledger.readState()) {
      ledger.writeState(createDefaultState(mode));
    }
    return ledger;
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
