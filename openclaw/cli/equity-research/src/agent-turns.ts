import { spawnSync } from "node:child_process";

import { CandidatePayload, mergeSeedPayloads, payload } from "./adapters.js";
import {
  Candidate,
  ContractError,
  FinalReport,
  MetricValue,
  ReviewVerdict,
  normalizeCandidate,
  validateEventBatch,
  validateFinalReport,
  validateReviewBatch,
} from "./contracts.js";
import { rankOpportunities } from "./value-engine.js";

const TASK_ENVELOPES = {
  eq_quantsieve: {
    task: "first_pass_review",
    role_profile: "/root/.openclaw/subAgents/eq_quantsieve",
    output_contract: "ReviewBatch",
    review_focus: [
      "deterministic_scorecard_audit",
      "missing_market_data",
      "missing_primary_evidence",
      "value_trap_risk",
    ],
  },
  eq_thesis_depth_reviewer: {
    task: "review_thesis_depth",
    role_profile: "/root/.openclaw/subAgents/eq_thesis_depth_reviewer",
    output_contract: "ReviewBatch",
    review_focus: [
      "owner_earnings_or_normalized_fcf",
      "intrinsic_value_and_margin_of_safety",
      "capital_allocation_and_share_count",
      "management_governance_quality",
      "moat_durability",
      "reinvestment_runway",
    ],
  },
  newswire: {
    task: "scan_news",
    role_profile: "/root/.openclaw/subAgents/newswire",
    output_contract: "EventBatch",
    review_focus: [
      "company_specific_news",
      "dated_source_attribution",
      "forced_selling_or_repricing_context",
      "separate_news_context_from_primary_evidence",
    ],
  },
  eq_eventhound: {
    task: "scan_catalysts",
    role_profile: "/root/.openclaw/subAgents/eq_eventhound",
    output_contract: "EventBatch",
    review_focus: [
      "spin_offs_and_separations",
      "restructurings_and_asset_sales",
      "tenders_mergers_and_recapitalizations",
      "insider_events",
      "material_sec_filing_catalysts",
    ],
  },
  eq_riskskeptic: {
    task: "review_risks",
    role_profile: "/root/.openclaw/subAgents/eq_riskskeptic",
    output_contract: "ReviewBatch",
    review_focus: [
      "accounting_quality",
      "dilution",
      "governance",
      "litigation_regulatory_debt_refinancing",
      "catalyst_resolution",
      "unsupported_primary_evidence",
    ],
  },
  victor: {
    task: "publish_final_report",
    role_profile: "/root/.openclaw/workspace-victor",
    output_contract: "FinalReport",
    review_focus: [
      "single_discord_forum_artifact",
      "memo_or_docket_selection",
      "publish_bar_enforcement",
    ],
  },
} as const;

type Agent = keyof typeof TASK_ENVELOPES;

export interface ReviewedPayload extends CandidatePayload {
  first_pass_reviews?: ReviewVerdict[];
  news_reviews?: ReviewVerdict[];
  thesis_depth_reviews?: ReviewVerdict[];
  catalyst_reviews?: ReviewVerdict[];
  risk_reviews?: ReviewVerdict[];
  excluded_after_narrowing?: string[];
}

export interface AgentResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

type AgentRunner = (args: string[]) => AgentResult;

const AGENT_METRIC_KEYS = new Set([
  "earnings_yield_scorecard",
  "balance_sheet_safety",
  "owner_earnings_quality",
  "opportunity_scorecard",
  "value_composite",
  "market_cap",
  "pe_ratio",
  "price",
  "sec_cik",
]);

function agentReviewLimit(): number {
  const parsed = Number.parseInt(process.env.OPENCLAW_EQUITY_DEEP_REVIEW_LIMIT ?? "8", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8;
}

function slimCandidateForAgent(candidate: Candidate): Candidate {
  const normalized = normalizeCandidate(candidate);
  const metrics: Record<string, MetricValue> = {};
  for (const key of AGENT_METRIC_KEYS) {
    if (key in normalized.metrics) {
      metrics[key] = normalized.metrics[key];
    }
  }
  return {
    ...normalized,
    metrics,
    filing_refs: normalized.filing_refs.slice(0, 4),
    news_refs: normalized.news_refs.slice(0, 4),
    polymarket_context: normalized.polymarket_context.slice(0, 2),
  };
}

function compactAgentInput(inputPayload: unknown): Record<string, unknown> {
  if (!isRecord(inputPayload)) {
    return {};
  }
  const pool = inputPayload as ReviewedPayload;
  const limit = agentReviewLimit();
  let candidates = Array.isArray(pool.candidates)
    ? pool.candidates.map((candidate) => slimCandidateForAgent(normalizeCandidate(candidate)))
    : [];
  if (candidates.length > limit) {
    const ranked = rankOpportunities({ ...pool, candidates }, limit);
    candidates = ranked.candidates.map((candidate) => slimCandidateForAgent(normalizeCandidate(candidate)));
  }
  const compact: Record<string, unknown> = {
    candidates,
    provider_errors: pool.provider_errors ?? [],
  };
  for (const field of [
    "first_pass_reviews",
    "news_reviews",
    "catalyst_reviews",
    "thesis_depth_reviews",
    "risk_reviews",
    "excluded_after_narrowing",
  ] as const) {
    if (Array.isArray(pool[field])) {
      compact[field] = pool[field];
    }
  }
  return compact;
}

function resolveOpenClawBin(): string {
  return process.env.OPENCLAW_BIN ?? "/usr/local/bin/openclaw";
}

const runAgent: AgentRunner = (args) => {
  const completed = spawnSync(resolveOpenClawBin(), args, { encoding: "utf8" });
  if (completed.error) {
    throw new Error(`openclaw MountainValue role launch failed: ${completed.error.message}`);
  }
  return {
    status: completed.status,
    stdout: completed.stdout,
    stderr: completed.stderr,
  };
};

export function configuredAgentTurn(
  agent: Agent,
  inputPayload: unknown,
  runner: AgentRunner = runAgent,
): Record<string, unknown> {
  const envelope: Record<string, unknown> = {
    workflow: "mountainvalue-daily-equity-research",
    contract_version: 1,
    role: agent,
    ...TASK_ENVELOPES[agent],
    instructions: [
      "Use the role rules loaded from AGENTS.md and TOOLS.md in role_profile.",
      "Return the output_contract JSON object only.",
      "Do not wrap the JSON in prose or Markdown.",
    ],
    contracts: {
      Candidate: [
        "ticker",
        "company",
        "sources",
        "screen_reasons",
        "metrics",
        "filing_refs",
        "news_refs",
        "polymarket_context",
        "evidence_gaps",
      ],
      ReviewVerdict: [
        "ticker",
        "verdict",
        "bull_case",
        "bear_case",
        "disqualifiers",
        "required_checks",
        "confidence",
      ],
      FinalReport: [
        "mode",
        "title",
        "selected_ticker",
        "body_markdown",
        "reviewed_candidates",
        "rejected_candidates",
        "missing_evidence",
      ],
    },
    input: compactAgentInput(inputPayload),
  };
  if (agent === "victor") {
    const channel = process.env.OPENCLAW_EQUITY_DISCORD_FORUM_CHANNEL_ID
      ?? "REPLACE_WITH_DISCORD_FORUM_CHANNEL_ID";
    envelope.discord_forum_channel_id = channel;
  }
  const message = JSON.stringify(envelope);
  if (message.length > 120_000) {
    throw new ContractError(
      `MountainValue ${agent} input exceeds OpenClaw CLI message limits (${message.length} chars).`,
    );
  }
  const completed = runner([
    "agent",
    "--agent",
    agent,
    "--message",
    message,
    "--timeout",
    process.env.OPENCLAW_EQUITY_AGENT_TIMEOUT_SECONDS ?? "900",
    "--json",
  ]);
  if (completed.status !== 0) {
    const stderr = (completed.stderr ?? "").trim();
    const stdout = (completed.stdout ?? "").trim();
    throw new Error(`openclaw MountainValue role ${agent} failed: ${stderr || stdout || "no stdout/stderr"}`);
  }
  return parseAgentJson(JSON.parse(completed.stdout) as unknown);
}

export function parseAgentJson(output: unknown): Record<string, unknown> {
  if (isContractOutput(output)) {
    return output;
  }
  for (const value of walkValues(output)) {
    if (typeof value === "string") {
      const parsed = parseJsonText(value);
      if (isContractOutput(parsed)) {
        return parsed;
      }
    }
  }
  throw new ContractError("agent output did not contain contract JSON");
}

function isContractOutput(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && ["reviews", "event_candidates", "body_markdown"]
      .some((field) => field in value);
}

function walkValues(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return [value, ...value.flatMap(walkValues)];
  }
  if (value && typeof value === "object") {
    return [value, ...Object.values(value).flatMap(walkValues)];
  }
  return [value];
}

function parseJsonText(text: string): unknown {
  const stripped = text.trim().replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "");
  try {
    return JSON.parse(stripped) as unknown;
  } catch {
    const objectMatch = stripped.match(/(\{[\s\S]*\})/u);
    if (!objectMatch) {
      return null;
    }
    try {
      return JSON.parse(objectMatch[1]) as unknown;
    } catch {
      return null;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function firstPassReview(seedPool: ReviewedPayload): ReviewedPayload {
  const workerOutput = configuredAgentTurn("eq_quantsieve", seedPool);
  return { ...seedPool, first_pass_reviews: validateReviewBatch(workerOutput) };
}

export function reviewThesisDepth(narrowedPool: ReviewedPayload): ReviewedPayload {
  const workerOutput = configuredAgentTurn("eq_thesis_depth_reviewer", narrowedPool);
  return { ...narrowedPool, thesis_depth_reviews: validateReviewBatch(workerOutput) };
}

export function scanNews(reviewedPool: ReviewedPayload): ReviewedPayload {
  const workerOutput = configuredAgentTurn("newswire", reviewedPool);
  const { reviews, eventCandidates } = validateEventBatch(workerOutput);
  const merged = mergeSeedPayloads(reviewedPool, { candidates: eventCandidates });
  return {
    ...merged,
    first_pass_reviews: reviewedPool.first_pass_reviews ?? [],
    news_reviews: reviews,
  };
}

export function scanCatalysts(reviewedPool: ReviewedPayload): ReviewedPayload {
  const workerOutput = configuredAgentTurn("eq_eventhound", reviewedPool);
  const { reviews, eventCandidates } = validateEventBatch(workerOutput);
  const merged = mergeSeedPayloads(reviewedPool, { candidates: eventCandidates });
  return {
    ...merged,
    first_pass_reviews: reviewedPool.first_pass_reviews ?? [],
    news_reviews: reviewedPool.news_reviews ?? [],
    catalyst_reviews: reviews,
  };
}

export function narrowReviewPool(reviewedPool: ReviewedPayload, limit: number): ReviewedPayload {
  const rejected = new Set(
    (reviewedPool.first_pass_reviews ?? [])
      .filter((review) => review.verdict === "reject")
      .map((review) => review.ticker),
  );
  const candidates = reviewedPool.candidates
    .filter((candidate) => !rejected.has(candidate.ticker.toUpperCase()))
    .map(normalizeCandidate)
    .sort((left, right) => compareRank(candidateRank(right), candidateRank(left)));
  const narrowed = payload(candidates.slice(0, limit)) as ReviewedPayload;
  narrowed.provider_errors = [...reviewedPool.provider_errors];
  narrowed.first_pass_reviews = reviewedPool.first_pass_reviews ?? [];
  narrowed.news_reviews = reviewedPool.news_reviews ?? [];
  narrowed.catalyst_reviews = reviewedPool.catalyst_reviews ?? [];
  narrowed.excluded_after_narrowing = candidates.slice(limit).map((candidate) => candidate.ticker);
  return narrowed;
}

function candidateRank(candidate: Candidate): [number, number, number] {
  return [
    candidate.sources.includes("sec_xbrl") ? 1 : 0,
    candidate.sources.length,
    candidate.screen_reasons.length,
  ];
}

function compareRank(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

export function reviewRisks(narrowedPool: ReviewedPayload): ReviewedPayload {
  const workerOutput = configuredAgentTurn("eq_riskskeptic", narrowedPool);
  return { ...narrowedPool, risk_reviews: validateReviewBatch(workerOutput) };
}

export function publishFinalReport(reviewedPool: ReviewedPayload): FinalReport {
  const blockers = finalizationBlockers(reviewedPool);
  if (blockers.length > 0) {
    return blockedFinalReport(reviewedPool, blockers);
  }
  return validateFinalReport(configuredAgentTurn("victor", reviewedPool));
}

function finalizationBlockers(reviewedPool: ReviewedPayload): string[] {
  const blockers: string[] = [];
  if (!Array.isArray(reviewedPool.candidates)) {
    return ["Pipeline did not provide a candidate array to Victor."];
  }
  if (reviewedPool.candidates.length === 0) {
    blockers.push("No candidates reached final review.");
  }
  for (const field of [
    "first_pass_reviews",
    "news_reviews",
    "catalyst_reviews",
    "thesis_depth_reviews",
    "risk_reviews",
  ] as const) {
    if (!Array.isArray(reviewedPool[field])) {
      blockers.push(`${field} missing; an upstream review step did not complete.`);
    }
  }
  const missingScorecards = reviewedPool.candidates
    .map(normalizeCandidate)
    .filter((candidate) => !hasRequiredScorecards(candidate))
    .map((candidate) => candidate.ticker);
  if (missingScorecards.length > 0) {
    blockers.push(
      `Missing deterministic earnings-yield/balance-sheet-safety/owner-earnings-quality/opportunity/value_composite scorecards for: ${missingScorecards.join(", ")}.`,
    );
  }
  return blockers;
}

function hasRequiredScorecards(candidate: Candidate): boolean {
  return [
    "earnings_yield_scorecard",
    "balance_sheet_safety",
    "owner_earnings_quality",
    "opportunity_scorecard",
    "value_composite",
  ]
    .every((field) => isRecord(candidate.metrics[field]));
}

function blockedFinalReport(reviewedPool: ReviewedPayload, blockers: string[]): FinalReport {
  const tickers = Array.isArray(reviewedPool.candidates)
    ? reviewedPool.candidates.map((candidate) => normalizeCandidate(candidate).ticker)
    : [];
  return {
    mode: "docket",
    title: "Daily Equity Docket - Pipeline Incomplete",
    selected_ticker: null,
    body_markdown: [
      "No publishable equity memo was produced because the MountainValue pipeline did not complete all required gates.",
      "",
      "Missing gates:",
      ...blockers.map((blocker) => `- ${blocker}`),
    ].join("\n"),
    reviewed_candidates: tickers,
    rejected_candidates: [],
    missing_evidence: blockers,
  };
}
