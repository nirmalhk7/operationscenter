import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

import { configuredAgentTurn } from "../src/agent-turns.js";
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

function repoText(path: string): string {
  return readFileSync(resolve(process.cwd(), "../../..", path), "utf8");
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
  const models = config.models as Record<string, unknown>;
  const agentsConfig = models.agents as Record<string, unknown>;
  const defaults = agentsConfig.defaults as Record<string, unknown>;
  const defaultsModel = defaults.model as Record<string, unknown>;
  const discord = models.channels as Record<string, unknown>;
  const discordConfig = discord.discord as Record<string, unknown>;
  const mainDiscordAccount = ((discordConfig.accounts as Record<string, unknown>).main) as Record<string, unknown>;
  const mainProfile = (agentsConfig.list as Array<Record<string, unknown>>)
    .find((agent) => agent.id === "main") as Record<string, unknown>;
  const mainModel = mainProfile.model as Record<string, unknown>;

  assert.equal((config.meta as Record<string, unknown>).lastTouchedVersion, "2026.5.28");
  assert.equal(workflow.name, "mountainvalue-daily-equity-research");
  assert.equal(defaultsModel.primary, "openai/gpt-5.4-mini");
  assert.equal(mainModel.primary, "openai/gpt-5.4-mini");
  assert.equal(mainProfile.thinkingDefault, "minimal");
  assert.equal(mainDiscordAccount.status, "online");
  assert.deepEqual(
    steps.map((step) => step.id),
    [
      "seed_configured_universe",
      "discover_value_candidates",
      "discover_technical_candidates",
      "merge_candidates",
      "enrich_primary_filings",
      "score_earnings_yield",
      "score_balance_sheet_safety",
      "score_owner_earnings_quality",
      "first_pass_review",
      "scan_news",
      "scan_catalysts",
      "rank_opportunities",
      "review_thesis_depth",
      "review_risks",
      "publish_final_report",
    ],
  );
  assert.ok(steps.every((step) => "command" in step));
  assert.equal("stdin" in steps[0], false);
  assert.ok(steps.slice(1).every((step) => "stdin" in step));
  const agents = (agentsConfig.list as Array<Record<string, unknown>>)
    .map((agent) => agent as Record<string, unknown>);
  const plugins = models.plugins as Record<string, unknown>;
  assert.deepEqual(plugins.allow, ["discord", "workboard"]);
  const agentIds = agents.map((agent) => agent.id);
  const bindings = (models.bindings as Array<Record<string, unknown>>)
    .filter((binding) => (binding.match as Record<string, unknown>).channel === "discord")
    .map((binding) => binding.agentId);
  assert.ok(agentIds.includes("victor"));
  assert.ok(bindings.includes("victor"));
  for (const worker of [
    "eq_quantsieve",
    "newswire",
    "eq_eventhound",
    "eq_riskskeptic",
    "eq_thesis_depth_reviewer",
  ]) {
    const profile = agents.find((agent) => agent.id === worker);
    assert.ok(profile, `${worker} should be a configured non-Discord profile`);
    const profileModel = profile.model as Record<string, unknown>;
    assert.equal(profile.workspace, `/root/.openclaw/subAgents/${worker}`);
    assert.equal(profile.agentDir, `/root/.openclaw/subAgents/${worker}`);
    assert.equal(profileModel.primary, "openai/gpt-5.5");
    assert.equal(bindings.includes(worker), false, `${worker} must not be Discord-bound`);
    assert.match(repoText(join("openclaw", "subAgents", worker, "AGENTS.md")), /subagent/i);
    assert.equal(existsSync(resolve(process.cwd(), "../../..", "openclaw", "subAgents", worker, "SOUL.md")), false);
  }
  const victor = agents.find((agent) => agent.id === "victor") as Record<string, unknown>;
  const victorTools = victor.tools as Record<string, unknown>;
  assert.equal(victorTools.profile, "minimal");
  assert.deepEqual(victorTools.allow, [
    "message",
    "lobster",
    "subagents",
    "sessions_spawn",
    "sessions_list",
    "sessions_history",
    "agents_list",
    "polymarket__getAllMarkets",
    "polymarket__getMarketDetails",
  ]);
  assert.equal((victorTools.allow as string[]).includes("exec"), false);
  assert.ok((victorTools.deny as string[]).includes("group:runtime"));
  assert.match(repoText(join("openclaw", "customAgents", "workspace-victor", "TOOLS.md")), /Lobster tool unavailable/u);
  assert.match(repoText(join("openclaw", "customAgents", "workspace-victor", "TOOLS.md")), /"cwd": "\.\."/u);
  assert.match(repoText(join("openclaw", "customAgents", "workspace-victor", "AGENTS.md")), /"cwd": "\.\."/u);
  const victorSubagents = (victor.subagents as Record<string, unknown> | undefined)
    ?? (defaults.subagents as Record<string, unknown>);
  const defaultSubagents = defaults.subagents as Record<string, unknown>;
  assert.equal((defaultSubagents.allowAgents as string[]).includes("newswire"), false);
  assert.deepEqual(victorSubagents.allowAgents, [
    "eq_quantsieve",
    "newswire",
    "eq_eventhound",
    "eq_riskskeptic",
    "eq_thesis_depth_reviewer",
  ]);
  const newswire = agents.find((agent) => agent.id === "newswire") as Record<string, unknown>;
  const newswireTools = newswire.tools as Record<string, unknown>;
  assert.deepEqual(newswireTools.allow, [
    "exa__web_search_exa",
    "exa__web_fetch_exa",
    "exa__web_search_advanced_exa",
  ]);
  const pluginEntries = plugins.entries as Record<string, Record<string, unknown>>;
  assert.ok(pluginEntries.openai?.enabled);
});

test("worker turns target configured role profiles directly", () => {
  let capturedArgs: string[] = [];
  const result = configuredAgentTurn(
    "eq_quantsieve",
    { candidates: [] },
    (args) => {
      capturedArgs = args;
      return {
        status: 0,
        stderr: "",
        stdout: JSON.stringify({ reviews: [] }),
      };
    },
  );

  assert.deepEqual(result, { reviews: [] });
  assert.equal(capturedArgs[0], "agent");
  assert.equal(capturedArgs[1], "--agent");
  assert.equal(capturedArgs[2], "eq_quantsieve");
  assert.equal(capturedArgs[3], "--message");
  const envelope = JSON.parse(capturedArgs[4]) as Record<string, unknown>;
  assert.equal(envelope.role, "eq_quantsieve");
  assert.equal(envelope.role_profile, "/root/.openclaw/subAgents/eq_quantsieve");
  assert.equal(envelope.output_contract, "ReviewBatch");
  assert.ok(Array.isArray((envelope.input as Record<string, unknown>).candidates));
  assert.doesNotMatch(capturedArgs[4], /Use the OpenClaw subagent tool/u);
  assert.ok(capturedArgs[4].length < 120_000);
});

test("worker turns tolerate missing stderr on failure", () => {
  assert.throws(
    () => configuredAgentTurn(
      "eq_quantsieve",
      { candidates: [] },
      () => ({
        status: 1,
        stdout: "",
        stderr: undefined as unknown as string,
      }),
    ),
    /no stdout\/stderr/u,
  );
});
