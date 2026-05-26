import { CandidatePayload, mergeSeedPayloads, payload } from "./adapters.js";
import { Candidate, MetricValue } from "./contracts.js";

type GateStatus = "pass" | "watch" | "fail";

interface Scorecard extends Record<string, unknown> {
  score: number;
  max_score: number;
  status: GateStatus;
  positives: string[];
  failures: string[];
  missing_inputs: string[];
}

interface EarningsYieldScorecard extends Scorecard {
  earnings_yield: number | null;
  return_on_capital: number | null;
  earnings_yield_rank: number | null;
  return_on_capital_rank: number | null;
  combined_rank: number | null;
}

interface CompositeScorecard {
  score: number;
  max_score: number;
  status: GateStatus;
  blocking_failures: string[];
  missing_inputs: string[];
}

interface OpportunityScorecard extends Scorecard {
  market_cap: number | null;
  market_cap_band: string;
  primary_evidence_count: number;
  catalyst_forms: string[];
  crowding_penalty: boolean;
  opportunity_type: string[];
}

export function scoreEarningsYield(seed: unknown): CandidatePayload {
  const result = normalizedPayload(seed);
  for (const candidate of result.candidates) {
    const scorecard = buildEarningsYieldScorecard(candidate);
    candidate.metrics.earnings_yield_scorecard = scorecard as unknown as MetricValue;
    appendScorecardNotes(candidate, "Earnings-yield", scorecard);
  }
  applyEarningsYieldRanks(result.candidates);
  applyCompositeScores(result.candidates);
  applyOpportunityScores(result.candidates);
  return result;
}

export function scoreBalanceSheetSafety(seed: unknown): CandidatePayload {
  const result = normalizedPayload(seed);
  for (const candidate of result.candidates) {
    const scorecard = buildBalanceSheetSafetyScorecard(candidate);
    candidate.metrics.balance_sheet_safety = scorecard as unknown as MetricValue;
    appendScorecardNotes(candidate, "Balance-sheet safety", scorecard);
  }
  applyCompositeScores(result.candidates);
  applyOpportunityScores(result.candidates);
  return result;
}

export function scoreOwnerEarningsQuality(seed: unknown): CandidatePayload {
  const result = normalizedPayload(seed);
  for (const candidate of result.candidates) {
    const scorecard = buildOwnerEarningsQualityScorecard(candidate);
    candidate.metrics.owner_earnings_quality = scorecard as unknown as MetricValue;
    appendScorecardNotes(candidate, "Owner-earnings quality", scorecard);
  }
  applyCompositeScores(result.candidates);
  applyOpportunityScores(result.candidates);
  return result;
}

export function rankOpportunities(seed: unknown, limit: number): CandidatePayload {
  const result = normalizedPayload(seed);
  for (const candidate of result.candidates) {
    if (!isRecord(candidate.metrics.earnings_yield_scorecard)) {
      candidate.metrics.earnings_yield_scorecard = buildEarningsYieldScorecard(candidate) as unknown as MetricValue;
    }
    if (!isRecord(candidate.metrics.balance_sheet_safety)) {
      candidate.metrics.balance_sheet_safety = buildBalanceSheetSafetyScorecard(candidate) as unknown as MetricValue;
    }
    if (!isRecord(candidate.metrics.owner_earnings_quality)) {
      candidate.metrics.owner_earnings_quality = buildOwnerEarningsQualityScorecard(candidate) as unknown as MetricValue;
    }
  }
  applyEarningsYieldRanks(result.candidates);
  applyCompositeScores(result.candidates);
  applyOpportunityScores(result.candidates);

  const rejected = rejectedByReviews(seed);
  const ranked = result.candidates
    .filter((candidate) => !rejected.has(candidate.ticker))
    .sort(compareValueCandidates);
  const narrowed = {
    ...result,
    candidates: ranked.slice(0, limit),
    excluded_after_narrowing: ranked.slice(limit).map((candidate) => candidate.ticker),
  };
  return narrowed as CandidatePayload;
}

function normalizedPayload(seed: unknown): CandidatePayload {
  const normalized = mergeSeedPayloads(seed);
  const base = isRecord(seed) ? seed : {};
  return {
    ...base,
    ...payload(normalized.candidates),
    provider_errors: normalized.provider_errors,
  };
}

function buildEarningsYieldScorecard(candidate: Candidate): EarningsYieldScorecard {
  const metrics = candidate.metrics;
  const marketCap = numberMetric(metrics.market_cap);
  const enterpriseValue = numberMetric(metrics.enterprise_value)
    ?? enterpriseValueFromParts(metrics, marketCap);
  const ebit = numberMetric(metrics.ebit) ?? numberMetric(metrics.operating_income);
  const workingCapital = numberMetric(metrics.working_capital)
    ?? differenceMetric(metrics.current_assets, metrics.current_liabilities);
  const tangibleCapital = numberMetric(metrics.tangible_capital)
    ?? sumPositive(workingCapital, numberMetric(metrics.property_plant_equipment_net));
  const earningsYield = ebit !== null && enterpriseValue !== null && enterpriseValue > 0
    ? round(ebit / enterpriseValue)
    : null;
  const returnOnCapital = ebit !== null && tangibleCapital !== null && tangibleCapital > 0
    ? round(ebit / tangibleCapital)
    : null;
  const missing = missingInputs({
    ebit,
    enterprise_value: enterpriseValue,
    tangible_capital: tangibleCapital,
  });
  const positives: string[] = [];
  const failures: string[] = [];
  if (earningsYield !== null && earningsYield >= 0.08) {
    positives.push("Earnings yield is at or above 8%.");
  } else if (earningsYield !== null) {
    failures.push("Earnings yield is below 8%.");
  }
  if (returnOnCapital !== null && returnOnCapital >= 0.15) {
    positives.push("Return on capital is at or above 15%.");
  } else if (returnOnCapital !== null) {
    failures.push("Return on capital is below 15%.");
  }
  return {
    score: positives.length,
    max_score: 2,
    status: statusFor(positives.length, 2, failures, missing),
    positives,
    failures,
    missing_inputs: missing,
    earnings_yield: earningsYield,
    return_on_capital: returnOnCapital,
    earnings_yield_rank: null,
    return_on_capital_rank: null,
    combined_rank: null,
  };
}

function buildBalanceSheetSafetyScorecard(candidate: Candidate): Scorecard {
  const metrics = candidate.metrics;
  const currentRatio = numberMetric(metrics.current_ratio)
    ?? ratioMetric(metrics.current_assets, metrics.current_liabilities);
  const debtToEquity = numberMetric(metrics.debt_to_equity)
    ?? ratioMetric(totalDebt(metrics), metrics.stockholders_equity);
  const marketCap = numberMetric(metrics.market_cap);
  const ncav = ncavMetric(metrics);
  const ncavMargin = ncav !== null && marketCap !== null && marketCap > 0
    ? round((ncav - marketCap) / marketCap)
    : null;
  const peRatio = numberMetric(metrics.pe_ratio);
  const priceToBook = numberMetric(metrics.price_to_book);
  const missing = missingInputs({
    current_assets: numberMetric(metrics.current_assets),
    current_liabilities: numberMetric(metrics.current_liabilities),
    total_debt: totalDebt(metrics),
    stockholders_equity: numberMetric(metrics.stockholders_equity),
    market_cap: marketCap,
    pe_ratio: peRatio,
    price_to_book: priceToBook,
  });
  const positives: string[] = [];
  const failures: string[] = [];
  if (currentRatio !== null && currentRatio >= 2) {
    positives.push("Current ratio is at or above 2.0.");
  } else if (currentRatio !== null) {
    failures.push("Current ratio is below balance-sheet safety threshold.");
  }
  if (debtToEquity !== null && debtToEquity <= 0.5) {
    positives.push("Debt to equity is at or below 0.5.");
  } else if (debtToEquity !== null) {
    failures.push("Debt to equity is above balance-sheet safety threshold.");
  }
  if (ncavMargin !== null && ncavMargin >= 0.33) {
    positives.push("Market cap is at least 33% below NCAV.");
  } else if (ncavMargin !== null) {
    failures.push("No net-current-asset margin of safety.");
  }
  if (peRatio !== null && peRatio <= 15) {
    positives.push("P/E is at or below 15.");
  } else if (peRatio !== null) {
    failures.push("P/E is above the value threshold.");
  }
  if (priceToBook !== null && priceToBook <= 1.5) {
    positives.push("Price/book is at or below 1.5.");
  } else if (priceToBook !== null) {
    failures.push("Price/book is above the asset-value threshold.");
  }
  return withComputedMetrics({
    score: positives.length,
    max_score: 5,
    status: statusFor(positives.length, 5, failures, missing),
    positives,
    failures,
    missing_inputs: missing,
  }, {
    current_ratio: currentRatio,
    debt_to_equity: debtToEquity,
    ncav,
    ncav_margin: ncavMargin,
  });
}

function buildOwnerEarningsQualityScorecard(candidate: Candidate): Scorecard {
  const metrics = candidate.metrics;
  const roe = numberMetric(metrics.return_on_equity);
  const netMargin = numberMetric(metrics.net_margin);
  const ownerEarnings = numberMetric(metrics.owner_earnings_proxy);
  const netIncome = numberMetric(metrics.net_income);
  const liabilitiesToEquity = numberMetric(metrics.liabilities_to_equity);
  const repurchases = numberMetric(metrics.stock_repurchases);
  const dividends = numberMetric(metrics.dividends_paid);
  const missing = missingInputs({
    return_on_equity: roe,
    net_margin: netMargin,
    owner_earnings_proxy: ownerEarnings,
    net_income: netIncome,
    liabilities_to_equity: liabilitiesToEquity,
    stock_repurchases: repurchases,
    dividends_paid: dividends,
  });
  const positives: string[] = [];
  const failures: string[] = [];
  if (roe !== null && roe >= 0.15) {
    positives.push("ROE is at or above 15%.");
  } else if (roe !== null) {
    failures.push("ROE is below owner-earnings quality threshold.");
  }
  if (netMargin !== null && netMargin >= 0.1) {
    positives.push("Net margin is at or above 10%.");
  } else if (netMargin !== null) {
    failures.push("Net margin is below 10%.");
  }
  if (ownerEarnings !== null && netIncome !== null && netIncome > 0 && ownerEarnings / netIncome >= 0.8) {
    positives.push("Owner-earnings proxy converts at least 80% of net income.");
  } else if (ownerEarnings !== null && netIncome !== null && netIncome > 0) {
    failures.push("Owner-earnings proxy converts less than 80% of net income.");
  }
  if (liabilitiesToEquity !== null && liabilitiesToEquity <= 1) {
    positives.push("Liabilities are not greater than equity.");
  } else if (liabilitiesToEquity !== null) {
    failures.push("Liabilities exceed equity.");
  }
  if ((repurchases !== null && repurchases > 0) || (dividends !== null && dividends > 0)) {
    positives.push("Capital returns are visible in filings.");
  }
  return withComputedMetrics({
    score: positives.length,
    max_score: 5,
    status: statusFor(positives.length, 5, failures, missing),
    positives,
    failures,
    missing_inputs: missing,
  }, {
    owner_earnings_conversion: ownerEarnings !== null && netIncome !== null && netIncome !== 0
      ? round(ownerEarnings / netIncome)
      : null,
  });
}

function applyEarningsYieldRanks(candidates: Candidate[]): void {
  const eligible = candidates
    .map((candidate) => ({ candidate, scorecard: candidate.metrics.earnings_yield_scorecard }))
    .filter((item): item is { candidate: Candidate; scorecard: EarningsYieldScorecard } => (
      isRecord(item.scorecard)
      && typeof item.scorecard.earnings_yield === "number"
      && typeof item.scorecard.return_on_capital === "number"
    ));
  const byYield = [...eligible].sort((left, right) => (
    (right.scorecard.earnings_yield ?? 0) - (left.scorecard.earnings_yield ?? 0)
  ));
  const byCapital = [...eligible].sort((left, right) => (
    (right.scorecard.return_on_capital ?? 0) - (left.scorecard.return_on_capital ?? 0)
  ));
  for (const [index, item] of byYield.entries()) {
    item.scorecard.earnings_yield_rank = index + 1;
  }
  for (const [index, item] of byCapital.entries()) {
    item.scorecard.return_on_capital_rank = index + 1;
  }
  for (const item of eligible) {
    item.scorecard.combined_rank = (item.scorecard.earnings_yield_rank ?? eligible.length)
      + (item.scorecard.return_on_capital_rank ?? eligible.length);
  }
}

function applyCompositeScores(candidates: Candidate[]): void {
  for (const candidate of candidates) {
    const cards = [
      candidate.metrics.earnings_yield_scorecard,
      candidate.metrics.balance_sheet_safety,
      candidate.metrics.owner_earnings_quality,
    ].filter(isRecord);
    const score = sumNumbers(cards.map((card) => numberMetric(card.score)));
    const maxScore = sumNumbers(cards.map((card) => numberMetric(card.max_score)));
    const blockingFailures = cards.flatMap((card) => (
      Array.isArray(card.failures) && card.status === "fail" ? card.failures.map(String) : []
    ));
    const missingInputs = uniqueStrings(cards.flatMap((card) => (
      Array.isArray(card.missing_inputs) ? card.missing_inputs.map(String) : []
    )));
    const composite: CompositeScorecard = {
      score,
      max_score: maxScore,
      status: blockingFailures.length > 0 ? "fail" : score >= Math.ceil(maxScore * 0.55) ? "pass" : "watch",
      blocking_failures: blockingFailures,
      missing_inputs: missingInputs,
    };
    candidate.metrics.value_composite = composite as unknown as MetricValue;
  }
}

function applyOpportunityScores(candidates: Candidate[]): void {
  for (const candidate of candidates) {
    const scorecard = buildOpportunityScorecard(candidate);
    candidate.metrics.opportunity_scorecard = scorecard as unknown as MetricValue;
    appendScorecardNotes(candidate, "Gem", scorecard);
  }
}

function buildOpportunityScorecard(candidate: Candidate): OpportunityScorecard {
  const metrics = candidate.metrics;
  const marketCap = numberMetric(metrics.market_cap);
  const earningsYieldScorecard = isRecord(metrics.earnings_yield_scorecard) ? metrics.earnings_yield_scorecard : {};
  const balanceSheetScorecard = isRecord(metrics.balance_sheet_safety) ? metrics.balance_sheet_safety : {};
  const earningsYield = numberMetric(earningsYieldScorecard.earnings_yield);
  const peRatio = numberMetric(metrics.pe_ratio);
  const priceToBook = numberMetric(metrics.price_to_book);
  const ownerEarnings = numberMetric(metrics.owner_earnings_proxy);
  const netIncome = numberMetric(metrics.net_income);
  const ncavMargin = numberMetric(balanceSheetScorecard.ncav_margin);
  const liabilitiesToEquity = numberMetric(metrics.liabilities_to_equity);
  const debtToEquity = numberMetric(metrics.debt_to_equity);
  const primaryEvidenceCount = primaryEvidenceRefs(candidate).length;
  const catalystForms = catalystFilingForms(candidate);
  const positives: string[] = [];
  const failures: string[] = [];
  const missing = missingInputs({ market_cap: marketCap });
  const opportunityType: string[] = [];
  const isCrowdedLargeCap = marketCap !== null && marketCap > 50_000_000_000;

  if (marketCap !== null && marketCap >= 300_000_000 && marketCap <= 10_000_000_000) {
    positives.push("Market cap is in a less-crowded small/mid-cap discovery band.");
    opportunityType.push("less_crowded");
  } else if (isCrowdedLargeCap) {
    missing.push("large_cap_specific_mispricing_or_catalyst");
  } else if (marketCap !== null && marketCap < 300_000_000) {
    failures.push("Market cap is below the minimum liquidity band.");
  }

  if ((earningsYield !== null && earningsYield >= 0.08) || (peRatio !== null && peRatio <= 12)) {
    positives.push("Valuation is cheap on earnings yield or P/E.");
    opportunityType.push("cheap_earnings");
  } else if (earningsYield !== null || peRatio !== null) {
    failures.push("No clear cheapness signal from earnings yield or P/E.");
  } else {
    missing.push("earnings_yield_or_pe_ratio");
  }

  if ((priceToBook !== null && priceToBook <= 1.5) || (ncavMargin !== null && ncavMargin > 0)) {
    positives.push("Asset-value signal is present through price/book or NCAV.");
    opportunityType.push("asset_value");
  } else if (priceToBook !== null) {
    failures.push("Price/book does not show asset-value cheapness.");
  }

  if (ownerEarnings !== null && ownerEarnings > 0 && netIncome !== null && netIncome > 0) {
    positives.push("Owner-earnings proxy and net income are positive.");
    opportunityType.push("owner_earnings");
  } else if (ownerEarnings !== null || netIncome !== null) {
    failures.push("Owner-earnings or net-income quality is not clearly positive.");
  } else {
    missing.push("owner_earnings_and_net_income");
  }

  if ((debtToEquity !== null && debtToEquity <= 0.5) || (liabilitiesToEquity !== null && liabilitiesToEquity <= 1)) {
    positives.push("Balance sheet does not appear over-levered.");
  } else if (debtToEquity !== null || liabilitiesToEquity !== null) {
    failures.push("Balance-sheet leverage weakens the opportunity case.");
  }

  if (primaryEvidenceCount >= 3) {
    positives.push("Primary SEC evidence has multiple filed anchors.");
  } else {
    failures.push("Primary SEC evidence is too thin for an opportunity memo.");
  }

  if (catalystForms.length > 0) {
    positives.push(`Special-situation filing forms present: ${catalystForms.join(", ")}.`);
    opportunityType.push("special_situation");
  }

  const hasOpportunity = opportunityType.some((type) => type !== "less_crowded");
  if (isCrowdedLargeCap && !hasOpportunity) {
    failures.push("Large-cap candidate lacks a specific cheapness, asset-value, owner-earnings, or catalyst angle.");
  }

  return {
    score: positives.length,
    max_score: 7,
    status: !hasOpportunity || failures.length >= 3
      ? "fail"
      : positives.length >= 4 ? "pass" : "watch",
    positives,
    failures,
    missing_inputs: uniqueStrings(missing),
    market_cap: marketCap,
    market_cap_band: marketCapBand(marketCap),
    primary_evidence_count: primaryEvidenceCount,
    catalyst_forms: catalystForms,
    crowding_penalty: isCrowdedLargeCap,
    opportunity_type: uniqueStrings(opportunityType),
  };
}

function appendScorecardNotes(candidate: Candidate, label: string, scorecard: Scorecard): void {
  if (scorecard.positives.length > 0) {
    appendUnique(candidate.screen_reasons, `${label} screen: ${scorecard.positives.join(" ")}`);
  }
  if (scorecard.failures.length > 0) {
    appendUnique(candidate.evidence_gaps, `${label} screen failures: ${scorecard.failures.join(" ")}`);
  }
  if (scorecard.missing_inputs.length > 0) {
    appendUnique(candidate.evidence_gaps, `${label} screen missing inputs: ${scorecard.missing_inputs.join(", ")}.`);
  }
}

function compareValueCandidates(left: Candidate, right: Candidate): number {
  const leftComposite = isRecord(left.metrics.value_composite) ? left.metrics.value_composite : {};
  const rightComposite = isRecord(right.metrics.value_composite) ? right.metrics.value_composite : {};
  const leftOpportunity = isRecord(left.metrics.opportunity_scorecard) ? left.metrics.opportunity_scorecard : {};
  const rightOpportunity = isRecord(right.metrics.opportunity_scorecard) ? right.metrics.opportunity_scorecard : {};
  const leftRank = earningsYieldCombinedRank(left);
  const rightRank = earningsYieldCombinedRank(right);
  const leftScore = numberMetric(leftComposite.score) ?? 0;
  const rightScore = numberMetric(rightComposite.score) ?? 0;
  const leftOpportunityScore = numberMetric(leftOpportunity.score) ?? 0;
  const rightOpportunityScore = numberMetric(rightOpportunity.score) ?? 0;
  const leftStatus = statusWeight(String(leftComposite.status ?? "watch"));
  const rightStatus = statusWeight(String(rightComposite.status ?? "watch"));
  const leftOpportunityStatus = statusWeight(String(leftOpportunity.status ?? "watch"));
  const rightOpportunityStatus = statusWeight(String(rightOpportunity.status ?? "watch"));
  return (rightOpportunityStatus - leftOpportunityStatus)
    || (rightOpportunityScore - leftOpportunityScore)
    || (rightStatus - leftStatus)
    || (rightScore - leftScore)
    || (leftRank - rightRank)
    || left.ticker.localeCompare(right.ticker);
}

function earningsYieldCombinedRank(candidate: Candidate): number {
  const card = candidate.metrics.earnings_yield_scorecard;
  if (!isRecord(card)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return numberMetric(card.combined_rank) ?? Number.MAX_SAFE_INTEGER;
}

function statusWeight(status: string): number {
  if (status === "pass") {
    return 2;
  }
  if (status === "watch") {
    return 1;
  }
  return 0;
}

function primaryEvidenceRefs(candidate: Candidate): Record<string, unknown>[] {
  return candidate.filing_refs
    .filter(isRecord)
    .filter((ref) => Boolean(ref.accession || ref.document_url || ref.filed));
}

function catalystFilingForms(candidate: Candidate): string[] {
  const catalystForms = new Set([
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
  return uniqueStrings(primaryEvidenceRefs(candidate)
    .map((ref) => String(ref.form ?? "").toUpperCase())
    .filter((form) => catalystForms.has(form)));
}

function marketCapBand(marketCap: number | null): string {
  if (marketCap === null) {
    return "unknown";
  }
  if (marketCap < 300_000_000) {
    return "micro/illiquid";
  }
  if (marketCap <= 2_000_000_000) {
    return "small";
  }
  if (marketCap <= 10_000_000_000) {
    return "mid";
  }
  if (marketCap <= 50_000_000_000) {
    return "large";
  }
  return "mega";
}

function statusFor(score: number, maxScore: number, failures: string[], missing: string[]): GateStatus {
  if (failures.length >= Math.max(2, Math.ceil(maxScore / 2))) {
    return "fail";
  }
  if (missing.length > 0 || failures.length > 0 || score < Math.ceil(maxScore * 0.5)) {
    return "watch";
  }
  return "pass";
}

function rejectedByReviews(seed: unknown): Set<string> {
  if (!isRecord(seed)) {
    return new Set();
  }
  const reviews = [
    seed.first_pass_reviews,
    seed.catalyst_reviews,
    seed.risk_reviews,
  ].filter(Array.isArray).flat();
  return new Set(reviews
    .filter(isRecord)
    .filter((review) => review.verdict === "reject")
    .map((review) => String(review.ticker ?? "").toUpperCase())
    .filter(Boolean));
}

function enterpriseValueFromParts(metrics: Record<string, MetricValue>, marketCap: number | null): number | null {
  if (marketCap === null) {
    return null;
  }
  const debt = totalDebt(metrics) ?? 0;
  const cash = numberMetric(metrics.cash_and_equivalents) ?? 0;
  return round(marketCap + debt - cash);
}

function ncavMetric(metrics: Record<string, MetricValue>): number | null {
  const currentAssets = numberMetric(metrics.current_assets);
  const liabilities = numberMetric(metrics.liabilities);
  if (currentAssets === null || liabilities === null) {
    return null;
  }
  return round(currentAssets - liabilities);
}

function totalDebt(metrics: Record<string, MetricValue>): number | null {
  const explicitDebt = numberMetric(metrics.total_debt);
  if (explicitDebt !== null) {
    return explicitDebt;
  }
  const shortTermDebt = numberMetric(metrics.short_term_debt);
  const longTermDebt = numberMetric(metrics.long_term_debt);
  if (shortTermDebt === null && longTermDebt === null) {
    return null;
  }
  return (shortTermDebt ?? 0) + (longTermDebt ?? 0);
}

function ratioMetric(numerator: unknown, denominator: unknown): number | null {
  const top = numberMetric(numerator);
  const bottom = numberMetric(denominator);
  if (top === null || bottom === null || bottom === 0) {
    return null;
  }
  return round(top / bottom);
}

function differenceMetric(left: unknown, right: unknown): number | null {
  const leftNumber = numberMetric(left);
  const rightNumber = numberMetric(right);
  if (leftNumber === null || rightNumber === null) {
    return null;
  }
  return round(leftNumber - rightNumber);
}

function sumPositive(...values: Array<number | null>): number | null {
  if (values.some((value) => value === null)) {
    return null;
  }
  let sum = 0;
  for (const value of values) {
    sum += Math.max(0, value ?? 0);
  }
  return sum;
}

function sumNumbers(values: Array<number | null>): number {
  let sum = 0;
  for (const value of values) {
    sum += value ?? 0;
  }
  return sum;
}

function missingInputs(inputs: Record<string, number | null>): string[] {
  return Object.entries(inputs)
    .filter(([, value]) => value === null)
    .map(([key]) => key);
}

function withComputedMetrics<T extends Scorecard>(
  scorecard: T,
  metrics: Record<string, number | null>,
): T & Record<string, number | null> {
  return { ...scorecard, ...metrics };
}

function numberMetric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function appendUnique(values: unknown[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
