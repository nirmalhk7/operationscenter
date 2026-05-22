import { spawnSync } from "node:child_process";

import { CandidatePayload, mergeSeedPayloads, payload } from "./adapters.js";
import {
  Candidate,
  ContractError,
  FinalReport,
  ReviewVerdict,
  normalizeCandidate,
  validateEventBatch,
  validateFinalReport,
  validateReviewBatch,
} from "./contracts.js";

const AGENT_TASKS = {
  quantsieve: `Review the supplied seed candidates. Return JSON only:
{"reviews":[ReviewVerdict,...]}
Score value, quality, balance-sheet strength, liquidity, margin-of-safety potential,
and obvious value-trap risk. Do not promote Finviz or technical seeds to thesis evidence.`,
  eventhound: `Review candidates and add event-driven US equity candidates.
Return JSON only: {"reviews":[ReviewVerdict,...],"event_candidates":[Candidate,...]}.
Look for Greenblatt-style spin-offs, separations, restructurings, tender offers,
mergers, asset sales, recapitalizations, insider events, and material SEC/news
catalysts. Polymarket is context only when a market maps to a catalyst; keep it out
of valuation and primary evidence. Open primary SEC documents needed for claims;
a filing ref alone is not evidence.`,
  riskskeptic: `Challenge the bounded pool. Return JSON only:
{"reviews":[ReviewVerdict,...]}. Use reject, caution, or proceed. Mark accounting,
dilution, governance, litigation, debt/refinancing, regulatory, catalyst-resolution,
and unsupported-primary-evidence gaps.`,
  oracle: `Select the daily result and return FinalReport JSON only. Full memo
mode requires primary-source support for the thesis, explicit source dates, valuation
and balance-sheet checks, RiskSkeptic review, and unresolved gaps. Otherwise return
a short docket. Post exactly one Discord forum artifact only when
OPENCLAW_EQUITY_DISCORD_FORUM_CHANNEL_ID is a real channel id; use the body_markdown
from the FinalReport and the message tool. Do not post to a placeholder channel.
A filing ref alone is not primary-source support; use primary SEC documents.`,
} as const;

type Agent = keyof typeof AGENT_TASKS;

export interface ReviewedPayload extends CandidatePayload {
  quantsieve_reviews?: ReviewVerdict[];
  eventhound_reviews?: ReviewVerdict[];
  riskskeptic_reviews?: ReviewVerdict[];
  excluded_after_narrowing?: string[];
}

export interface AgentResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

type AgentRunner = (args: string[]) => AgentResult;

const runAgent: AgentRunner = (args) => {
  const completed = spawnSync("openclaw", args, { encoding: "utf8" });
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
  let prompt = [
    AGENT_TASKS[agent],
    "Candidate contract keys are ticker, company, sources, screen_reasons, metrics, filing_refs, news_refs, polymarket_context, and evidence_gaps.",
    "ReviewVerdict keys are ticker, verdict, bull_case, bear_case, disqualifiers, required_checks, and confidence.",
    `Input JSON:\n${JSON.stringify(inputPayload)}`,
  ].join("\n\n");
  if (agent === "oracle") {
    const channel = process.env.OPENCLAW_EQUITY_DISCORD_FORUM_CHANNEL_ID
      ?? "REPLACE_WITH_DISCORD_FORUM_CHANNEL_ID";
    prompt = `${prompt}\n\nDiscord forum channel target: ${channel}`;
  }
  const completed = runner([
    "agent",
    "--agent",
    agent,
    "--message",
    prompt,
    "--timeout",
    process.env.OPENCLAW_EQUITY_AGENT_TIMEOUT_SECONDS ?? "900",
    "--json",
  ]);
  if (completed.status !== 0) {
    throw new Error(`openclaw agent ${agent} failed: ${completed.stderr.trim() || "no stderr"}`);
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

export function quantsieveReview(seedPool: ReviewedPayload): ReviewedPayload {
  const workerOutput = configuredAgentTurn("quantsieve", seedPool);
  return { ...seedPool, quantsieve_reviews: validateReviewBatch(workerOutput) };
}

export function eventhoundScan(reviewedPool: ReviewedPayload): ReviewedPayload {
  const workerOutput = configuredAgentTurn("eventhound", reviewedPool);
  const { reviews, eventCandidates } = validateEventBatch(workerOutput);
  const merged = mergeSeedPayloads(reviewedPool, { candidates: eventCandidates });
  return {
    ...merged,
    quantsieve_reviews: reviewedPool.quantsieve_reviews ?? [],
    eventhound_reviews: reviews,
  };
}

export function narrowPool(reviewedPool: ReviewedPayload, limit: number): ReviewedPayload {
  const rejected = new Set(
    (reviewedPool.quantsieve_reviews ?? [])
      .filter((review) => review.verdict === "reject")
      .map((review) => review.ticker),
  );
  const candidates = reviewedPool.candidates
    .filter((candidate) => !rejected.has(candidate.ticker.toUpperCase()))
    .map(normalizeCandidate)
    .sort((left, right) => compareRank(candidateRank(right), candidateRank(left)));
  const narrowed = payload(candidates.slice(0, limit)) as ReviewedPayload;
  narrowed.provider_errors = [...reviewedPool.provider_errors];
  narrowed.quantsieve_reviews = reviewedPool.quantsieve_reviews ?? [];
  narrowed.eventhound_reviews = reviewedPool.eventhound_reviews ?? [];
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

export function riskskepticReview(narrowedPool: ReviewedPayload): ReviewedPayload {
  const workerOutput = configuredAgentTurn("riskskeptic", narrowedPool);
  return { ...narrowedPool, riskskeptic_reviews: validateReviewBatch(workerOutput) };
}

export function oracleFinalize(reviewedPool: ReviewedPayload): FinalReport {
  return validateFinalReport(configuredAgentTurn("oracle", reviewedPool));
}
