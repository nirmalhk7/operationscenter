import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

function repoText(path: string): string {
  return readFileSync(resolve(process.cwd(), "../../..", path), "utf8");
}

function repoJson(path: string): Record<string, unknown> {
  return JSON.parse(repoText(path)) as Record<string, unknown>;
}

test("OpenClaw runtime config parses and points at the MountainValue operator workspace", () => {
  const config = repoJson(join("openclaw", "openclaw.json"));
  const agentsConfig = config.agents as Record<string, unknown>;
  const victor = (agentsConfig.list as Array<Record<string, unknown>>).find((agent) => agent.id === "victor");
  const gateway = config.gateway as Record<string, unknown>;

  assert.ok(victor);
  assert.equal(victor?.workspace, "/root/.openclaw/workspace-victor");
  assert.equal(((victor as Record<string, unknown>).tools as Record<string, unknown>).profile, "full");
  assert.equal("agentDir" in (victor ?? {}), false);
  assert.equal(gateway.mode, "local");
  const allowedOrigins = (gateway.controlUi as Record<string, unknown>).allowedOrigins as string[];
  assert.ok(allowedOrigins.includes("http://localhost:5173"));
  assert.ok(allowedOrigins.every((origin) => /^https?:\/\//u.test(origin)));
});

test("MountainValue workflow is deterministic and trader-facing docs mention paper mode", () => {
  const workflow = repoJson(join("openclaw", "mountainvalue.lobster"));
  const signalsWorkflow = repoJson(join("openclaw", "mountainvalue-signals.lobster"));
  const cycleWorkflow = repoJson(join("openclaw", "mountainvalue-cycle.lobster"));
  const cancelWorkflow = repoJson(join("openclaw", "mountainvalue-cancel-stale.lobster"));
  const watchdogWorkflow = repoJson(join("openclaw", "mountainvalue-watchdog.lobster"));
  const stepIds = (workflow.steps as Array<Record<string, unknown>>).map((step) => step.id);

  assert.equal(workflow.name, "mountainvalue-paper-trading");
  assert.deepEqual(stepIds, [
    "preflight",
    "reconcile",
    "watchdog",
    "signals_if_due",
    "cycle_if_due",
    "cancel_stale_entries_if_due",
    "daily_report",
  ]);
  assert.deepEqual((signalsWorkflow.steps as Array<Record<string, unknown>>).map((step) => step.id), ["preflight", "reconcile", "watchdog", "signals_if_due", "daily_report"]);
  assert.deepEqual((cycleWorkflow.steps as Array<Record<string, unknown>>).map((step) => step.id), ["preflight", "reconcile", "watchdog", "cycle_if_due", "daily_report"]);
  assert.deepEqual((cancelWorkflow.steps as Array<Record<string, unknown>>).map((step) => step.id), ["preflight", "reconcile", "watchdog", "cancel_stale_entries_if_due", "daily_report"]);
  assert.deepEqual((watchdogWorkflow.steps as Array<Record<string, unknown>>).map((step) => step.id), ["preflight", "reconcile", "watchdog", "daily_report"]);
  assert.match(repoText(join("openclaw", "customAgents", "workspace-victor", "AGENTS.md")), /\[PAPER\]/u);
  assert.match(repoText(join("openclaw", "customAgents", "workspace-victor", "TOOLS.md")), /lobster/i);
  assert.match(repoText(join("openclaw", "README.md")), /Victor-owned OpenClaw\s+cron/u);
  assert.match(repoText(join("openclaw", "plugins", "lobster", "openclaw.plugin.json")), /"id": "lobster"/u);
  assert.match(repoText(join("openclaw", "plugins", "lobster", "src", "index.js")), /name: "lobster"/u);
  const ansible = repoText(join("infrastructure", "ansible", "lxc-openclaw.ansible.yaml"));
  assert.match(ansible, /MountainValue evaluate buy sell/u);
  assert.match(ansible, /- openclaw[\s\S]*?- channels[\s\S]*?- add/u);
  assert.match(ansible, /--use-env/u);
  assert.match(ansible, /- openclaw[\s\S]*?- cron[\s\S]*?- add/u);
  assert.match(ansible, /0 8-13 \* \* 1-5/u);
  assert.match(ansible, /- --agent[\s\S]*?- victor/u);
  assert.match(ansible, /- --announce/u);
  assert.match(ansible, /- --channel[\s\S]*?- discord/u);
  assert.match(ansible, /- --to[\s\S]*OPENCLAW_EQUITY_DISCORD_FORUM_CHANNEL_ID/u);
  const envTemplate = repoText(join("infrastructure", "ansible", "templates", "openclaw.env.j2"));
  assert.match(envTemplate, /EXECUTION_MODE=paper/u);
  assert.match(envTemplate, /DISCORD_BOT_TOKEN=/u);
});
