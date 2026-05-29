export const CANDIDATE_ARRAY_FIELDS = [
  "sources",
  "screen_reasons",
  "filing_refs",
  "news_refs",
  "polymarket_context",
  "evidence_gaps",
] as const;

export const REVIEW_ARRAY_FIELDS = [
  "bull_case",
  "bear_case",
  "disqualifiers",
  "required_checks",
] as const;

const VERDICTS = new Set(["proceed", "caution", "reject"]);
const CONFIDENCE_LEVELS = new Set(["low", "medium", "high"]);
const REPORT_MODES = new Set(["memo", "docket"]);

export type JsonScalar = string | number | boolean | null;
export type MetricValue = JsonScalar | Record<string, unknown> | unknown[];

export interface Candidate {
  ticker: string;
  company: string;
  sources: unknown[];
  screen_reasons: unknown[];
  metrics: Record<string, MetricValue>;
  filing_refs: unknown[];
  news_refs: unknown[];
  polymarket_context: unknown[];
  evidence_gaps: unknown[];
}

export interface ReviewVerdict {
  ticker: string;
  verdict: "proceed" | "caution" | "reject";
  bull_case: unknown[];
  bear_case: unknown[];
  disqualifiers: unknown[];
  required_checks: unknown[];
  confidence: "low" | "medium" | "high";
}

export interface FinalReport {
  mode: "memo" | "docket";
  title: string;
  selected_ticker: string | null;
  body_markdown: string;
  reviewed_candidates: unknown[];
  rejected_candidates: unknown[];
  missing_evidence: unknown[];
}

export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractError";
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringField(
  record: Record<string, unknown>,
  field: string,
  message: string,
): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ContractError(message);
  }
  return value;
}

function arrayField(
  record: Record<string, unknown>,
  field: string,
  label: string,
): unknown[] {
  const value = record[field] ?? [];
  if (!Array.isArray(value)) {
    throw new ContractError(`${label} ${field} must be an array`);
  }
  return clone(value);
}

export function blankCandidate(ticker: string, company = ""): Candidate {
  return {
    ticker: ticker.toUpperCase(),
    company,
    sources: [],
    screen_reasons: [],
    metrics: {},
    filing_refs: [],
    news_refs: [],
    polymarket_context: [],
    evidence_gaps: [],
  };
}

export function normalizeCandidate(candidate: unknown): Candidate {
  if (!isRecord(candidate)) {
    throw new ContractError("candidate must be an object");
  }
  const ticker = stringField(
    candidate,
    "ticker",
    "candidate ticker must be a non-empty string",
  );
  const company = typeof candidate.company === "string" ? candidate.company : "";
  const normalized = blankCandidate(ticker.trim(), company);
  const metrics = candidate.metrics ?? {};
  if (!isRecord(metrics)) {
    throw new ContractError(`${normalized.ticker} metrics must be an object`);
  }
  normalized.metrics = clone(metrics) as Record<string, MetricValue>;
  for (const field of CANDIDATE_ARRAY_FIELDS) {
    normalized[field] = arrayField(candidate, field, normalized.ticker);
  }
  return normalized;
}

export function validateCandidates(candidates: unknown): Candidate[] {
  if (!Array.isArray(candidates)) {
    throw new ContractError("candidates must be an array");
  }
  return candidates.map(normalizeCandidate);
}

export function validateReview(review: unknown): ReviewVerdict {
  if (!isRecord(review)) {
    throw new ContractError("review must be an object");
  }
  const ticker = stringField(review, "ticker", "review ticker must be a non-empty string");
  const { verdict, confidence } = review;
  if (typeof verdict !== "string" || !VERDICTS.has(verdict)) {
    throw new ContractError(`${ticker} verdict must be one of caution, proceed, reject`);
  }
  if (typeof confidence !== "string" || !CONFIDENCE_LEVELS.has(confidence)) {
    throw new ContractError(`${ticker} confidence must be one of high, low, medium`);
  }
  return {
    ticker: ticker.toUpperCase(),
    verdict: verdict as ReviewVerdict["verdict"],
    confidence: confidence as ReviewVerdict["confidence"],
    bull_case: arrayField(review, "bull_case", ticker),
    bear_case: arrayField(review, "bear_case", ticker),
    disqualifiers: arrayField(review, "disqualifiers", ticker),
    required_checks: arrayField(review, "required_checks", ticker),
  };
}

export function validateReviewBatch(batch: unknown): ReviewVerdict[] {
  if (!isRecord(batch) || !Array.isArray(batch.reviews)) {
    throw new ContractError("worker output must include reviews array");
  }
  return batch.reviews.map(validateReview);
}

export function validateEventBatch(batch: unknown): {
  reviews: ReviewVerdict[];
  eventCandidates: Candidate[];
} {
  if (!isRecord(batch)) {
    throw new ContractError("event output must be an object");
  }
  return {
    reviews: validateReviewBatch(batch),
    eventCandidates: validateCandidates(batch.event_candidates ?? []),
  };
}

export function validateFinalReport(report: unknown): FinalReport {
  if (!isRecord(report)) {
    throw new ContractError("final report must be an object");
  }
  if (typeof report.mode !== "string" || !REPORT_MODES.has(report.mode)) {
    throw new ContractError("final report mode must be one of docket, memo");
  }
  const title = stringField(report, "title", "final report title must be a non-empty string");
  const body = stringField(
    report,
    "body_markdown",
    "final report body_markdown must be a non-empty string",
  );
  if (report.selected_ticker !== null && report.selected_ticker !== undefined
    && typeof report.selected_ticker !== "string") {
    throw new ContractError("final report selected_ticker must be a string or null");
  }
  const selectedTicker = typeof report.selected_ticker === "string" && report.selected_ticker
    ? report.selected_ticker.toUpperCase()
    : null;
  return {
    mode: report.mode as FinalReport["mode"],
    title,
    selected_ticker: selectedTicker,
    body_markdown: body,
    reviewed_candidates: arrayField(report, "reviewed_candidates", "final report"),
    rejected_candidates: arrayField(report, "rejected_candidates", "final report"),
    missing_evidence: arrayField(report, "missing_evidence", "final report"),
  };
}

export function recordValue(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ContractError("payload must be an object");
  }
  return value;
}
