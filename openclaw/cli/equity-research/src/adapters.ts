import {
  CANDIDATE_ARRAY_FIELDS,
  Candidate,
  ContractError,
  MetricValue,
  blankCandidate,
  normalizeCandidate,
  recordValue,
} from "./contracts.js";

export const SEC_TICKER_INDEX_URL = "https://www.sec.gov/files/company_tickers.json";
export const SEC_COMPANY_FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json";
export const SEC_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json";
export const SEC_ARCHIVE_DOCUMENT_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/{document}";
const FINVIZ_DEFAULT_SEED_URL = "https://finviz.com/screener.ashx?v=111&f=fa_debteq_u1,fa_pb_u3,fa_pfcf_u20,fa_pe_u20,fa_roe_pos,geo_usa,sh_avgvol_o200,sh_price_o5";
const FINVIZ_TECHNICAL_SEED_URL = "https://finviz.com/screener.ashx?v=111&f=geo_usa,sh_avgvol_o300,sh_price_o5,ta_sma20_pa,ta_sma50_pa,ta_sma200_pa";
const DEFAULT_SEC_FILING_FORMS = new Set([
  "10-K",
  "10-Q",
  "8-K",
  "S-1",
  "S-4",
  "10-12B",
  "FORM 10",
  "DEF 14A",
  "PRE 14A",
  "SC TO-I",
  "SC 13D",
  "SC 13D/A",
]);

const SEC_FACTS = {
  revenue: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"],
  net_income: ["NetIncomeLoss"],
  operating_income: ["OperatingIncomeLoss"],
  operating_cash_flow: [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
  ],
  capital_expenditures: [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquireProductiveAssets",
  ],
  stock_repurchases: [
    "PaymentsForRepurchaseOfCommonStock",
    "PaymentsForRepurchaseOfCommonStocks",
  ],
  dividends_paid: [
    "PaymentsOfDividends",
    "PaymentsOfDividendsCommonStock",
  ],
  assets: ["Assets"],
  current_assets: ["AssetsCurrent"],
  liabilities: ["Liabilities"],
  current_liabilities: ["LiabilitiesCurrent"],
  stockholders_equity: ["StockholdersEquity"],
  cash_and_equivalents: [
    "CashAndCashEquivalentsAtCarryingValue",
    "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
  ],
  short_term_debt: ["ShortTermBorrowings", "ShortTermDebtCurrent"],
  long_term_debt: ["LongTermDebtNoncurrent", "LongTermDebtAndFinanceLeaseObligationsNoncurrent"],
  property_plant_equipment_net: ["PropertyPlantAndEquipmentNet"],
  shares_outstanding: [
    "EntityCommonStockSharesOutstanding",
    "CommonStocksIncludingAdditionalPaidInCapitalSharesOutstanding",
    "WeightedAverageNumberOfDilutedSharesOutstanding",
  ],
} as const;

type Reader = (url: string) => Promise<unknown>;
type TextReader = (url: string) => Promise<string>;

export interface ProviderError {
  provider: string;
  message: string;
}

export interface CandidatePayload {
  candidates: Candidate[];
  provider_errors: ProviderError[];
  generated_at: string;
  [key: string]: unknown;
}

interface SecTickerRow {
  cik_str: number | string;
  ticker: string;
  title?: string;
}

interface SecFact {
  val: unknown;
  filed?: string;
  end?: string;
  form?: string;
  accn?: string;
  concept: string;
}

interface SecFilingColumns {
  accessionNumber?: unknown[];
  filingDate?: unknown[];
  form?: unknown[];
  primaryDocument?: unknown[];
  primaryDocDescription?: unknown[];
  reportDate?: unknown[];
}

export function payload(candidates: Candidate[] = []): CandidatePayload {
  return {
    candidates,
    provider_errors: [],
    generated_at: new Date().toISOString(),
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const userAgent = process.env.OPENCLAW_EDGAR_USER_AGENT
    ?? process.env.SEC_USER_AGENT
    ?? "operationscenter-equity-research/1.0 admin@example.invalid";
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": userAgent },
  });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json() as Promise<unknown>;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "user-agent": process.env.OPENCLAW_FINVIZ_USER_AGENT ?? "Mozilla/5.0" },
  });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.text();
}

function sourceError(provider: string, error: unknown): ProviderError {
  return {
    provider,
    message: error instanceof Error ? error.message : String(error),
  };
}

function isTickerRow(value: unknown): value is SecTickerRow {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (typeof row.cik_str === "string" || typeof row.cik_str === "number")
    && typeof row.ticker === "string";
}

export class SECProvider {
  constructor(private readonly reader: Reader = fetchJson) {}

  async seed(tickers: string[] = [], limit = 40): Promise<CandidatePayload> {
    const result = payload();
    if (tickers.length === 0) {
      return result;
    }
    let rows: SecTickerRow[];
    try {
      rows = await secTickerRows(this.reader);
    } catch (error) {
      result.provider_errors.push(sourceError("sec_xbrl", error));
      return result;
    }
    const wanted = new Set(tickers.map((ticker) => ticker.toUpperCase()));
    const selected = rows
      .filter((row) => wanted.size === 0 || wanted.has(row.ticker.toUpperCase()))
      .slice(0, limit);
    for (const row of selected) {
      try {
        const candidate = await this.candidateFromRow(row);
        if (candidate) {
          result.candidates.push(candidate);
        }
      } catch (error) {
        result.provider_errors.push(sourceError("sec_xbrl", error));
      }
    }
    return result;
  }

  private async candidateFromRow(row: SecTickerRow): Promise<Candidate | null> {
    const parsedCik = Number.parseInt(String(row.cik_str), 10);
    if (!Number.isFinite(parsedCik)) {
      throw new Error(`${row.ticker} SEC CIK must be numeric`);
    }
    const cik = String(parsedCik).padStart(10, "0");
    const factsResponse = await this.reader(SEC_COMPANY_FACTS_URL.replace("{cik}", cik));
    const { metrics, filingRefs } = extractSecFacts(factsResponse);
    if (Object.keys(metrics).length === 0) {
      return null;
    }
    const candidate = blankCandidate(row.ticker, row.title ?? "");
    candidate.sources = ["sec_xbrl"];
    candidate.metrics = metrics;
    candidate.metrics.sec_cik = cik;
    candidate.filing_refs = filingRefs;
    candidate.screen_reasons = secScreenReasons(metrics);
    if (candidate.screen_reasons.length === 0) {
      candidate.evidence_gaps.push("SEC facts need value or profitability review.");
    }
    return candidate;
  }
}

async function secTickerRows(reader: Reader): Promise<SecTickerRow[]> {
  const tickerIndex = recordValue(await reader(SEC_TICKER_INDEX_URL));
  const rows = Object.values(tickerIndex).filter(isTickerRow);
  if (rows.length === 0) {
    throw new Error("SEC ticker index has no rows");
  }
  return rows;
}

export function extractSecFacts(companyFacts: unknown): {
  metrics: Record<string, MetricValue>;
  filingRefs: Array<Record<string, string>>;
} {
  const response = recordValue(companyFacts);
  const facts = recordValue(response.facts);
  const taxonomy = recordValue(facts["us-gaap"]);
  const metrics: Record<string, MetricValue> = {};
  const filingRefs: Array<Record<string, string>> = [];
  for (const [metric, concepts] of Object.entries(SEC_FACTS)) {
    const fact = latestSecFact(taxonomy, concepts);
    if (!fact) {
      continue;
    }
    metrics[metric] = fact.val as MetricValue;
    metrics[`${metric}_filed`] = fact.filed ?? null;
    filingRefs.push({
      concept: fact.concept,
      form: fact.form ?? "",
      filed: fact.filed ?? "",
      accession: fact.accn ?? "",
    });
  }
  const revenue = numeric(metrics.revenue);
  const netIncome = numeric(metrics.net_income);
  const operatingCashFlow = numeric(metrics.operating_cash_flow);
  const capitalExpenditures = numeric(metrics.capital_expenditures);
  const assets = numeric(metrics.assets);
  const currentAssets = numeric(metrics.current_assets);
  const liabilities = numeric(metrics.liabilities);
  const currentLiabilities = numeric(metrics.current_liabilities);
  const equity = numeric(metrics.stockholders_equity);
  const shortTermDebt = numeric(metrics.short_term_debt);
  const longTermDebt = numeric(metrics.long_term_debt);
  if (revenue && netIncome !== null) {
    metrics.net_margin = round(netIncome / revenue);
  }
  if (assets && liabilities !== null) {
    metrics.liabilities_to_assets = round(liabilities / assets);
  }
  if (currentAssets !== null && currentLiabilities !== null) {
    metrics.working_capital = round(currentAssets - currentLiabilities);
    if (currentLiabilities !== 0) {
      metrics.current_ratio = round(currentAssets / currentLiabilities);
    }
  }
  if (shortTermDebt !== null || longTermDebt !== null) {
    metrics.total_debt = round((shortTermDebt ?? 0) + (longTermDebt ?? 0));
  }
  if (equity && netIncome !== null) {
    metrics.return_on_equity = round(netIncome / equity);
  }
  if (equity && liabilities !== null) {
    metrics.liabilities_to_equity = round(liabilities / equity);
  }
  if (equity && numeric(metrics.total_debt) !== null) {
    metrics.debt_to_equity = round(Number(metrics.total_debt) / equity);
  }
  if (operatingCashFlow !== null && capitalExpenditures !== null) {
    metrics.owner_earnings_proxy = round(operatingCashFlow - Math.abs(capitalExpenditures));
  }
  return { metrics, filingRefs };
}

function latestSecFact(
  taxonomy: Record<string, unknown>,
  concepts: readonly string[],
): SecFact | undefined {
  const facts: SecFact[] = [];
  for (const concept of concepts) {
    const conceptRecord = taxonomy[concept];
    if (!conceptRecord || typeof conceptRecord !== "object") {
      continue;
    }
    const unitsValue = (conceptRecord as Record<string, unknown>).units;
    if (!unitsValue || typeof unitsValue !== "object") {
      continue;
    }
    const units = unitsValue as Record<string, unknown>;
    for (const unit of ["USD", "USD/shares", "shares"]) {
      const entries = units[unit];
      if (!Array.isArray(entries)) {
        continue;
      }
      for (const entry of entries) {
        if (entry && typeof entry === "object") {
          const fact = entry as Record<string, unknown>;
          if ((fact.form === "10-K" || fact.form === "10-Q") && "val" in fact) {
            facts.push({ ...(fact as Omit<SecFact, "concept">), concept });
          }
        }
      }
    }
  }
  return facts.sort((left, right) => {
    const filed = String(left.filed ?? "").localeCompare(String(right.filed ?? ""));
    return filed || String(left.end ?? "").localeCompare(String(right.end ?? ""));
  }).at(-1);
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function secScreenReasons(metrics: Record<string, MetricValue>): string[] {
  const reasons: string[] = [];
  const income = numeric(metrics.net_income);
  const equity = numeric(metrics.stockholders_equity);
  const leverage = numeric(metrics.liabilities_to_assets);
  if (income !== null && income > 0) {
    reasons.push("SEC facts show positive latest net income.");
  }
  if (equity !== null && equity > 0) {
    reasons.push("SEC facts show positive stockholders equity.");
  }
  if (leverage !== null && leverage < 0.8) {
    reasons.push("SEC facts show liabilities below 80% of assets.");
  }
  return reasons;
}

export class FinvizProvider {
  constructor(private readonly reader: TextReader = fetchText) {}

  async seed(limit = 40): Promise<CandidatePayload> {
    return seedFinvizCandidates(
      this.reader,
      process.env.OPENCLAW_FINVIZ_SEED_URL ?? FINVIZ_DEFAULT_SEED_URL,
      limit,
      "finviz",
      "Finviz value, liquidity, profitability, and leverage seed filter.",
    );
  }
}

export class FinvizTechnicalProvider {
  constructor(private readonly reader: TextReader = fetchText) {}

  async seed(limit = 40): Promise<CandidatePayload> {
    return seedFinvizCandidates(
      this.reader,
      process.env.OPENCLAW_FINVIZ_TECHNICAL_SEED_URL ?? FINVIZ_TECHNICAL_SEED_URL,
      limit,
      "finviz_technical",
      "Finviz technical trend seed: liquid US stocks above 20-, 50-, and 200-day SMAs.",
    );
  }
}

async function seedFinvizCandidates(
  reader: TextReader,
  seedUrl: string,
  limit: number,
  provider: string,
  reason: string,
): Promise<CandidatePayload> {
  const result = payload();
  let tickers: string[];
  try {
    const html = await reader(seedUrl);
    const candidates = parseFinvizCandidates(html, provider, reason).slice(0, limit);
    if (candidates.length > 0) {
      result.candidates.push(...candidates);
      return result;
    }
    tickers = parseFinvizTickers(html).slice(0, limit);
  } catch (error) {
    result.provider_errors.push(sourceError(provider, error));
    return result;
  }
  for (const ticker of tickers) {
    const candidate = blankCandidate(ticker);
    candidate.sources = [provider];
    candidate.screen_reasons = [reason];
    candidate.evidence_gaps = [
      "Finviz seed values are discovery context and require primary-source checks.",
    ];
    result.candidates.push(candidate);
  }
  return result;
}

export class SECFilingSearchProvider {
  constructor(private readonly reader: Reader = fetchJson) {}

  async enrich(seed: unknown, limit = 6): Promise<CandidatePayload> {
    const result = mergeSeedPayloads(seed);
    let rows: SecTickerRow[];
    try {
      rows = await secTickerRows(this.reader);
    } catch (error) {
      result.provider_errors.push(sourceError("sec_submissions", error));
      return result;
    }
    const rowsByTicker = new Map(rows.map((row) => [row.ticker.toUpperCase(), row]));
    for (const candidate of result.candidates) {
      const row = rowsByTicker.get(candidate.ticker.toUpperCase());
      if (!row) {
        candidate.evidence_gaps.push("SEC filing search could not map this ticker to a CIK.");
        continue;
      }
      try {
        const cik = cikForRow(row);
        await this.enrichCompanyFacts(candidate, cik);
        const submissions = await this.reader(SEC_SUBMISSIONS_URL.replace("{cik}", cik));
        const filingRefs = extractSecFilingRefs(submissions, cik, limit);
        if (filingRefs.length === 0) {
          candidate.evidence_gaps.push("SEC filing search found no recent research filing refs.");
        }
        appendUnique(candidate.filing_refs, filingRefs);
      } catch (error) {
        result.provider_errors.push(sourceError("sec_submissions", error));
      }
    }
    return result;
  }

  private async enrichCompanyFacts(candidate: Candidate, cik: string): Promise<void> {
    try {
      const factsResponse = await this.reader(SEC_COMPANY_FACTS_URL.replace("{cik}", cik));
      const { metrics, filingRefs } = extractSecFacts(factsResponse);
      if (Object.keys(metrics).length === 0) {
        candidate.evidence_gaps.push("SEC company facts returned no usable value metrics.");
        return;
      }
      for (const [key, value] of Object.entries(metrics)) {
        if (!(key in candidate.metrics)) {
          candidate.metrics[key] = value;
        }
      }
      candidate.metrics.sec_cik = cik;
      appendUnique(candidate.sources, ["sec_xbrl"]);
      appendUnique(candidate.filing_refs, filingRefs);
      appendUnique(candidate.screen_reasons, secScreenReasons(metrics));
    } catch (error) {
      candidate.evidence_gaps.push(
        `SEC company facts enrichment failed: ${error instanceof Error ? error.message : String(error)}.`,
      );
    }
  }
}

export function extractSecFilingRefs(
  submissions: unknown,
  cik: string,
  limit = 6,
  forms: ReadonlySet<string> = configuredSecFilingForms(),
): Array<Record<string, string>> {
  const submission = recordValue(submissions);
  const filings = recordValue(submission.filings);
  const recent = recordValue(filings.recent) as SecFilingColumns;
  const found: Array<Record<string, string>> = [];
  for (let index = 0; index < (recent.form?.length ?? 0) && found.length < limit; index += 1) {
    const form = columnString(recent.form, index).toUpperCase();
    const accession = columnString(recent.accessionNumber, index);
    const primaryDocument = columnString(recent.primaryDocument, index);
    if (!form || !forms.has(form) || !accession || !primaryDocument) {
      continue;
    }
    const archiveCik = String(Number.parseInt(cik, 10));
    const archiveAccession = accession.replaceAll("-", "");
    found.push({
      source: "sec_submissions",
      form,
      filed: columnString(recent.filingDate, index),
      report_date: columnString(recent.reportDate, index),
      accession,
      primary_document: primaryDocument,
      primary_document_description: columnString(recent.primaryDocDescription, index),
      document_url: SEC_ARCHIVE_DOCUMENT_URL
        .replace("{cik}", archiveCik)
        .replace("{accession}", archiveAccession)
        .replace("{document}", primaryDocument),
    });
  }
  return found;
}

function cikForRow(row: SecTickerRow): string {
  const cik = Number.parseInt(String(row.cik_str), 10);
  if (!Number.isFinite(cik)) {
    throw new Error(`${row.ticker} SEC CIK must be numeric`);
  }
  return String(cik).padStart(10, "0");
}

function configuredSecFilingForms(): ReadonlySet<string> {
  const configured = process.env.OPENCLAW_SEC_FILING_FORMS;
  if (!configured) {
    return DEFAULT_SEC_FILING_FORMS;
  }
  return new Set(configured.split(",").map((form) => form.trim().toUpperCase()).filter(Boolean));
}

function columnString(column: unknown[] | undefined, index: number): string {
  const value = column?.[index];
  return typeof value === "string" ? value : "";
}

function appendUnique(target: unknown[], additions: unknown[]): void {
  for (const addition of additions) {
    if (!target.some((current) => JSON.stringify(current) === JSON.stringify(addition))) {
      target.push(addition);
    }
  }
}

const FINVIZ_TICKER_PATTERNS = [
  /quote\.ashx\?t=([A-Z0-9.-]+)/gi,
  /stock\?t=([A-Z0-9.-]+)/gi,
  /data-boxover-ticker="([A-Z0-9.-]+)"/gi,
] as const;

const FINVIZ_ROW_PATTERNS = [
  /<tr[^>]*>[\s\S]*?quote\.ashx\?t=([A-Z0-9.-]+)[\s\S]*?<\/tr>/gi,
  /<tr[^>]*>[\s\S]*?data-boxover-ticker="([A-Z0-9.-]+)"[\s\S]*?<\/tr>/gi,
] as const;

export function parseFinvizTickers(html: string): string[] {
  const tickers = new Set<string>();
  for (const pattern of FINVIZ_TICKER_PATTERNS) {
    for (const match of html.matchAll(pattern)) {
      tickers.add(match[1].toUpperCase());
    }
  }
  if (tickers.size === 0) {
    throw new Error("Finviz screener response has no quote tickers");
  }
  return [...tickers];
}

export function parseFinvizCandidates(html: string, provider: string, reason: string): Candidate[] {
  const candidates: Candidate[] = [];
  for (const rows of FINVIZ_ROW_PATTERNS) {
    for (const row of html.matchAll(rows)) {
      const candidate = finvizCandidateFromRow(row[0], row[1], provider, reason);
      if (candidate && !candidates.some((entry) => entry.ticker === candidate.ticker)) {
        candidates.push(candidate);
      }
    }
    if (candidates.length > 0) {
      return candidates;
    }
  }
  return candidates;
}

function finvizCandidateFromRow(
  rowHtml: string,
  tickerRaw: string,
  provider: string,
  reason: string,
): Candidate | null {
  const ticker = tickerRaw.toUpperCase();
  const companyMatch = rowHtml.match(/data-boxover-company="([^"]+)"/i);
  const valueMatch = rowHtml.match(/data-boxover-value="([^"]+)"/i);
  const cells = tableCells(rowHtml);
  const tickerIndex = cells.findIndex((cell) => cell.toUpperCase() === ticker);
  const candidate = blankCandidate(
    ticker,
    companyMatch?.[1] ?? (tickerIndex >= 0 ? cells[tickerIndex + 1] ?? "" : ""),
  );
  candidate.sources = [provider];
  candidate.screen_reasons = [reason];
  candidate.evidence_gaps = [
    "Finviz seed values are discovery context and require primary-source checks.",
  ];
  const marketCap = parseFinvizNumber(valueMatch?.[1])
    ?? parseFinvizNumber(tickerIndex >= 0 ? cells[tickerIndex + 5] : undefined);
  const peRatio = parsePlainNumber(tickerIndex >= 0 ? cells[tickerIndex + 6] : undefined);
  const price = parsePlainNumber(tickerIndex >= 0 ? cells[tickerIndex + 7] : undefined);
  if (marketCap !== null) {
    candidate.metrics.market_cap = marketCap;
  }
  if (peRatio !== null) {
    candidate.metrics.pe_ratio = peRatio;
  }
  if (price !== null) {
    candidate.metrics.price = price;
  }
  return candidate;
}

function tableCells(rowHtml: string): string[] {
  return [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
    .map((match) => stripHtml(match[1]))
    .filter((cell) => cell.length > 0);
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFinvizNumber(value: string | undefined): number | null {
  if (!value || value === "-") {
    return null;
  }
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)([KMBT])?$/i);
  if (!match) {
    return parsePlainNumber(value);
  }
  const number = Number.parseFloat(match[1]);
  if (!Number.isFinite(number)) {
    return null;
  }
  const suffix = match[2]?.toUpperCase();
  const multiplier = suffix === "T" ? 1_000_000_000_000
    : suffix === "B" ? 1_000_000_000
      : suffix === "M" ? 1_000_000
        : suffix === "K" ? 1_000
          : 1;
  return Math.round(number * multiplier);
}

function parsePlainNumber(value: string | undefined): number | null {
  if (!value || value === "-") {
    return null;
  }
  const parsed = Number.parseFloat(value.replace(/[$,%]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function appendSeed(upstream: unknown, addition: unknown): CandidatePayload {
  const combined = payload([
    ...validatePayloadCandidates(upstream),
    ...validatePayloadCandidates(addition),
  ]);
  combined.provider_errors = [
    ...payloadErrors(upstream),
    ...payloadErrors(addition),
  ];
  return combined;
}

export function mergeSeedPayloads(...seeds: unknown[]): CandidatePayload {
  const merged = payload();
  const candidates = new Map<string, Candidate>();
  for (const seed of seeds) {
    merged.provider_errors.push(...payloadErrors(seed));
    for (const candidate of validatePayloadCandidates(seed)) {
      const current = candidates.get(candidate.ticker);
      if (current) {
        mergeCandidate(current, candidate);
      } else {
        candidates.set(candidate.ticker, candidate);
      }
    }
  }
  merged.candidates = [...candidates.values()];
  return merged;
}

function payloadErrors(seed: unknown): ProviderError[] {
  if (!seed || typeof seed !== "object") {
    return [];
  }
  const errors = (seed as Record<string, unknown>).provider_errors;
  return Array.isArray(errors) ? errors as ProviderError[] : [];
}

function validatePayloadCandidates(seed: unknown): Candidate[] {
  if (!seed || typeof seed !== "object" || Array.isArray(seed)) {
    throw new ContractError("seed payload must be an object");
  }
  const candidates = (seed as Record<string, unknown>).candidates ?? [];
  if (!Array.isArray(candidates)) {
    throw new ContractError("seed payload candidates must be an array");
  }
  return candidates.map(normalizeCandidate);
}

function mergeCandidate(target: Candidate, incoming: Candidate): void {
  if (!target.company && incoming.company) {
    target.company = incoming.company;
  }
  for (const field of CANDIDATE_ARRAY_FIELDS) {
    for (const value of incoming[field]) {
      if (!target[field].some((current) => JSON.stringify(current) === JSON.stringify(value))) {
        target[field].push(value);
      }
    }
  }
  for (const [key, value] of Object.entries(incoming.metrics)) {
    const current = target.metrics[key];
    if (!(key in target.metrics)) {
      target.metrics[key] = value;
    } else if (JSON.stringify(current) !== JSON.stringify(value)) {
      const conflicts = conflictMetrics(target.metrics);
      const values = conflicts[key] ?? [current];
      if (!values.some((item) => JSON.stringify(item) === JSON.stringify(value))) {
        values.push(value);
      }
      conflicts[key] = values;
    }
  }
}

function conflictMetrics(metrics: Record<string, MetricValue>): Record<string, MetricValue[]> {
  if (!metrics._conflicts || typeof metrics._conflicts !== "object" || Array.isArray(metrics._conflicts)) {
    metrics._conflicts = {};
  }
  return metrics._conflicts as Record<string, MetricValue[]>;
}
