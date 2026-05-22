import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  ContractError,
  validateEventBatch,
  validateFinalReport,
  validateReviewBatch,
} from "../src/contracts.js";

function review(ticker = "ABC", verdict = "proceed"): Record<string, unknown> {
  return {
    ticker,
    verdict,
    bull_case: [],
    bear_case: [],
    disqualifiers: [],
    required_checks: [],
    confidence: "low",
  };
}

function repoJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(process.cwd(), "../../..", path), "utf8")) as Record<string, unknown>;
}

test("worker review contract", () => {
  assert.equal(validateReviewBatch({ reviews: [review()] })[0].ticker, "ABC");
});

test("event contract validates added candidate", () => {
  const candidate = {
    ticker: "EVT",
    company: "Event Corp",
    sources: ["sec_xbrl"],
    screen_reasons: [],
    metrics: {},
    filing_refs: [],
    news_refs: [],
    polymarket_context: [],
    evidence_gaps: [],
  };
  const event = validateEventBatch({
    reviews: [review("EVT", "caution")],
    event_candidates: [candidate],
  });

  assert.equal(event.reviews[0].verdict, "caution");
  assert.equal(event.eventCandidates[0].ticker, "EVT");
});

test("invalid worker verdict fails", () => {
  assert.throws(() => validateReviewBatch({ reviews: [review("ABC", "maybe")] }), ContractError);
});

test("final report contract", () => {
  const report = validateFinalReport({
    mode: "docket",
    title: "Daily Equity Docket",
    selected_ticker: null,
    body_markdown: "No cleared memo today.",
    reviewed_candidates: [],
    rejected_candidates: [],
    missing_evidence: ["Primary valuation check not cleared."],
  });

  assert.equal(report.mode, "docket");
});

test("workflow stays JSON command steps", () => {
  const config = repoJson(join("openclaw", "openclaw.json"));
  const workflow = repoJson(join("openclaw", "mountainvalue.lobster"));
  const steps = workflow.steps as Array<Record<string, unknown>>;

  assert.equal((config.meta as Record<string, unknown>).lastTouchedVersion, "2026.4.1");
  assert.equal(workflow.name, "mountainvalue-daily-equity-research");
  assert.deepEqual(
    steps.map((step) => step.id),
    [
      "sec_seed",
      "finviz_seed",
      "finviz_technical_seed",
      "merge_seed_pool",
      "sec_filing_search",
      "quantsieve_review",
      "eventhound_scan",
      "narrow_pool",
      "riskskeptic_review",
      "oracle_finalize",
    ],
  );
  assert.ok(steps.every((step) => "command" in step));
  assert.equal("stdin" in steps[0], false);
  assert.ok(steps.slice(1).every((step) => "stdin" in step));
});
