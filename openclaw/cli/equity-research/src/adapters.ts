import {
  AccountSnapshot,
  Bar,
  ClockSnapshot,
  ContractError,
  OrderSnapshot,
  PositionSnapshot,
  Quote,
  TradingConfig,
  TradingSide,
  asNullableNumber,
  normalizeSymbol,
} from "./contracts.js";

type FetchLike = typeof fetch;

function assertOk(response: Response, url: string): Promise<Response> {
  if (!response.ok) {
    throw new ContractError(`${url} returned ${response.status}`);
  }
  return Promise.resolve(response);
}

function authHeaders(config: TradingConfig): Record<string, string> {
  if (!config.alpaca_api_key || !config.alpaca_secret_key) {
    throw new ContractError("Alpaca credentials are required");
  }
  return {
    "APCA-API-KEY-ID": config.alpaca_api_key,
    "APCA-API-SECRET-KEY": config.alpaca_secret_key,
    accept: "application/json",
  };
}

function buildUrl(baseUrl: string, path: string, params?: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(path, ensureTrailingSlash(baseUrl));
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function ensureTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ContractError("expected object response");
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseClock(value: unknown): ClockSnapshot {
  const record = asRecord(value);
  return {
    timestamp: String(record.timestamp ?? record.t ?? new Date().toISOString()),
    is_open: Boolean(record.is_open ?? record.isOpen ?? false),
    next_open: record.next_open !== undefined ? String(record.next_open) : null,
    next_close: record.next_close !== undefined ? String(record.next_close) : null,
  };
}

function parseAccount(value: unknown): AccountSnapshot {
  const record = asRecord(value);
  return {
    status: typeof record.status === "string" ? record.status : undefined,
    buying_power: asNullableNumber(record.buying_power),
    cash: asNullableNumber(record.cash),
    equity: asNullableNumber(record.equity),
    portfolio_value: asNullableNumber(record.portfolio_value),
    day_trade_count: asNullableNumber(record.daytrade_count ?? record.day_trade_count),
    pattern_day_trader: typeof record.pattern_day_trader === "boolean" ? record.pattern_day_trader : undefined,
    currency: typeof record.currency === "string" ? record.currency : undefined,
    raw: record,
  };
}

function parsePosition(recordLike: unknown): PositionSnapshot {
  const record = asRecord(recordLike);
  return {
    symbol: normalizeSymbol(String(record.symbol ?? "")),
    qty: Number.parseFloat(String(record.qty ?? record.quantity ?? 0)),
    market_value: asNullableNumber(record.market_value),
    avg_entry_price: asNullableNumber(record.avg_entry_price),
    current_price: asNullableNumber(record.current_price),
    unrealized_pl: asNullableNumber(record.unrealized_pl),
    unrealized_plpc: asNullableNumber(record.unrealized_plpc),
    side: record.side === "short" ? "short" : "long",
    entry_date: typeof record.entry_date === "string" ? record.entry_date : null,
    entry_order_id: typeof record.entry_order_id === "string" ? record.entry_order_id : null,
    protective_stop_price: asNullableNumber(record.protective_stop_price),
    protective_stop_order_id: typeof record.protective_stop_order_id === "string" ? record.protective_stop_order_id : null,
    raw: record,
  };
}

function parseOrder(recordLike: unknown): OrderSnapshot {
  const record = asRecord(recordLike);
  return {
    id: String(record.id ?? ""),
    client_order_id: typeof record.client_order_id === "string" ? record.client_order_id : undefined,
    symbol: normalizeSymbol(String(record.symbol ?? "")),
    side: record.side === "sell" ? "sell" : "buy",
    type: (record.type === "market" || record.type === "limit" || record.type === "stop" || record.type === "stop_limit")
      ? record.type
      : "market",
    status: String(record.status ?? ""),
    qty: asNullableNumber(record.qty),
    filled_qty: asNullableNumber(record.filled_qty),
    limit_price: asNullableNumber(record.limit_price),
    stop_price: asNullableNumber(record.stop_price),
    filled_avg_price: asNullableNumber(record.filled_avg_price),
    created_at: typeof record.created_at === "string" ? record.created_at : undefined,
    submitted_at: typeof record.submitted_at === "string" ? record.submitted_at : undefined,
    filled_at: typeof record.filled_at === "string" ? record.filled_at : null,
    canceled_at: typeof record.canceled_at === "string" ? record.canceled_at : null,
    raw: record,
  };
}

function parseQuote(symbol: string, value: unknown): Quote {
  const root = asRecord(value);
  const record = asRecord(root.quote ?? root);
  return {
    symbol: normalizeSymbol(symbol),
    timestamp: String(record.t ?? record.timestamp ?? record.timestamp_utc ?? new Date().toISOString()),
    bid: asNullableNumber(record.bp ?? record.bid) ?? 0,
    ask: asNullableNumber(record.ap ?? record.ask) ?? 0,
    bid_size: asNullableNumber(record.bs ?? record.bid_size) ?? undefined,
    ask_size: asNullableNumber(record.as ?? record.ask_size) ?? undefined,
    raw: record,
  };
}

function parseBar(recordLike: unknown): Bar {
  const record = asRecord(recordLike);
  return {
    symbol: normalizeSymbol(String(record.symbol ?? "")),
    t: String(record.t ?? record.timestamp ?? ""),
    o: Number(record.o ?? record.open ?? 0),
    h: Number(record.h ?? record.high ?? 0),
    l: Number(record.l ?? record.low ?? 0),
    c: Number(record.c ?? record.close ?? 0),
    v: asNullableNumber(record.v ?? record.volume) ?? undefined,
  };
}

function normalizeBarsResponse(value: unknown): Record<string, Bar[]> {
  const record = asRecord(value);
  const bars = record.bars ?? record.data ?? record.items ?? record;
  if (Array.isArray(bars)) {
    const grouped: Record<string, Bar[]> = {};
    for (const entry of bars) {
      const bar = parseBar(entry);
      if (!grouped[bar.symbol]) {
        grouped[bar.symbol] = [];
      }
      grouped[bar.symbol].push(bar);
    }
    return grouped;
  }
  const grouped: Record<string, Bar[]> = {};
  for (const [symbol, entries] of Object.entries(asRecord(bars))) {
    grouped[normalizeSymbol(symbol)] = asArray(entries).map(parseBar);
  }
  return grouped;
}

export class AlpacaClient {
  constructor(
    private readonly config: TradingConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async getClock(): Promise<ClockSnapshot> {
    const url = buildUrl(this.config.alpaca_trading_base_url, "/v2/clock");
    const response = await assertOk(await this.fetchImpl(url, { headers: authHeaders(this.config) }), url);
    return parseClock(await response.json());
  }

  async getAccount(): Promise<AccountSnapshot> {
    const url = buildUrl(this.config.alpaca_trading_base_url, "/v2/account");
    const response = await assertOk(await this.fetchImpl(url, { headers: authHeaders(this.config) }), url);
    return parseAccount(await response.json());
  }

  async getPositions(): Promise<PositionSnapshot[]> {
    const url = buildUrl(this.config.alpaca_trading_base_url, "/v2/positions");
    const response = await assertOk(await this.fetchImpl(url, { headers: authHeaders(this.config) }), url);
    const body = await response.json();
    return asArray(body).map(parsePosition);
  }

  async getOpenOrders(): Promise<OrderSnapshot[]> {
    const url = buildUrl(this.config.alpaca_trading_base_url, "/v2/orders", { status: "open", nested: true, limit: 500 });
    const response = await assertOk(await this.fetchImpl(url, { headers: authHeaders(this.config) }), url);
    return asArray(await response.json()).map(parseOrder);
  }

  async getOrders(status = "open"): Promise<OrderSnapshot[]> {
    const url = buildUrl(this.config.alpaca_trading_base_url, "/v2/orders", { status, nested: true, limit: 500 });
    const response = await assertOk(await this.fetchImpl(url, { headers: authHeaders(this.config) }), url);
    return asArray(await response.json()).map(parseOrder);
  }

  async getAsset(symbol: string): Promise<Record<string, unknown>> {
    const normalized = normalizeSymbol(symbol);
    const url = buildUrl(this.config.alpaca_trading_base_url, `/v2/assets/${normalized}`);
    const response = await assertOk(await this.fetchImpl(url, { headers: authHeaders(this.config) }), url);
    return asRecord(await response.json());
  }

  async getDailyBars(symbols: readonly string[], limit = 260): Promise<Record<string, Bar[]>> {
    const normalized = symbols.map(normalizeSymbol).join(",");
    const url = buildUrl(this.config.alpaca_data_base_url, "/v2/stocks/bars", {
      symbols: normalized,
      timeframe: "1Day",
      adjustment: "raw",
      feed: this.config.alpaca_data_feed,
      limit,
    });
    const response = await assertOk(await this.fetchImpl(url, { headers: authHeaders(this.config) }), url);
    return normalizeBarsResponse(await response.json());
  }

  async getLatestQuote(symbol: string): Promise<Quote> {
    const normalized = normalizeSymbol(symbol);
    const url = buildUrl(this.config.alpaca_data_base_url, `/v2/stocks/${normalized}/quotes/latest`, {
      feed: this.config.alpaca_data_feed,
    });
    const response = await assertOk(await this.fetchImpl(url, { headers: authHeaders(this.config) }), url);
    return parseQuote(normalized, await response.json());
  }

  async submitOrder(payload: {
    symbol: string;
    side: TradingSide;
    type: "market" | "limit";
    time_in_force: "day" | "gtc";
    qty?: number;
    notional?: number;
    limit_price?: number | null;
    stop_price?: number | null;
    client_order_id: string;
    extended_hours?: boolean;
    order_class?: string;
    take_profit?: { limit_price: number };
    stop_loss?: { stop_price: number };
  }): Promise<OrderSnapshot> {
    const url = buildUrl(this.config.alpaca_trading_base_url, "/v2/orders");
    const response = await assertOk(await this.fetchImpl(url, {
      method: "POST",
      headers: {
        ...authHeaders(this.config),
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    }), url);
    return parseOrder(await response.json());
  }

  async cancelOrder(orderId: string): Promise<void> {
    const url = buildUrl(this.config.alpaca_trading_base_url, `/v2/orders/${orderId}`);
    await assertOk(await this.fetchImpl(url, {
      method: "DELETE",
      headers: authHeaders(this.config),
    }), url);
  }

  async getOrder(orderId: string): Promise<OrderSnapshot> {
    const url = buildUrl(this.config.alpaca_trading_base_url, `/v2/orders/${orderId}`);
    const response = await assertOk(await this.fetchImpl(url, { headers: authHeaders(this.config) }), url);
    return parseOrder(await response.json());
  }
}

export function createAlpacaClient(config: TradingConfig, fetchImpl: FetchLike = fetch): AlpacaClient {
  return new AlpacaClient(config, fetchImpl);
}
