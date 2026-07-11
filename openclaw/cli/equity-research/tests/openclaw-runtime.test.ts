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
  const channelsConfig = config.channels as Record<string, unknown>;
  const agentList = agentsConfig.list as Array<Record<string, unknown>>;
  const defaults = agentsConfig.defaults as Record<string, unknown>;
  const main = agentList.find((agent) => agent.id === "main");
  const rahul = agentList.find((agent) => agent.id === "rahul");
  const victor = (agentsConfig.list as Array<Record<string, unknown>>).find((agent) => agent.id === "victor");
  const gateway = config.gateway as Record<string, unknown>;
  const plugins = config.plugins as Record<string, unknown>;
  const discord = channelsConfig.discord as Record<string, unknown>;
  const discordAccounts = discord.accounts as Record<string, Record<string, unknown>>;
  const bindings = config.bindings as Array<Record<string, unknown>>;

  assert.ok(main);
  assert.ok(rahul);
  assert.ok(victor);
  assert.equal(discord.enabled, true);
  assert.equal((((plugins.entries as Record<string, Record<string, unknown>>) ?? {}).discord ?? {}).enabled, true);
  assert.equal(discord.defaultAccount, "main");
  assert.deepEqual(Object.keys(discordAccounts).sort(), ["main", "rahul", "victor"]);
  assert.equal(((discordAccounts.main.token as Record<string, unknown>) ?? {}).id, "OPENCLAW_DISCORD_BOT_TOKEN_MAIN");
  assert.equal(((discordAccounts.rahul.token as Record<string, unknown>) ?? {}).id, "OPENCLAW_DISCORD_BOT_TOKEN_RAHUL");
  assert.equal(((discordAccounts.victor.token as Record<string, unknown>) ?? {}).id, "OPENCLAW_DISCORD_BOT_TOKEN_VICTOR");
  assert.equal(discord.groupPolicy, "allowlist");
  assert.equal(((discord.guilds as Record<string, Record<string, unknown>>)["1487714737964716084"] ?? {}).requireMention, true);
  assert.equal(discord.dmPolicy, "allowlist");
  assert.equal(discord.replyToMode, "first");
  assert.equal(discord.ackReaction, "👀");
  assert.equal(((discord.threadBindings as Record<string, unknown>) ?? {}).enabled, true);
  assert.equal(((discord.execApprovals as Record<string, unknown>) ?? {}).target, "dm");
  assert.equal(((discord.actions as Record<string, unknown>) ?? {}).presence, true);
  assert.deepEqual(
    bindings
      .filter((binding) => ((binding.match as Record<string, unknown>) ?? {}).channel === "discord")
      .map((binding) => ({
        accountId: ((binding.match as Record<string, unknown>) ?? {}).accountId,
        agentId: binding.agentId,
      }))
      .sort((a, b) => String(a.accountId).localeCompare(String(b.accountId))),
    [
      { accountId: "main", agentId: "main" },
      { accountId: "rahul", agentId: "rahul" },
      { accountId: "victor", agentId: "victor" },
    ],
  );
  for (const agent of [main, rahul, victor]) {
    assert.equal(((agent.heartbeat as Record<string, unknown>) ?? {}).model, "openrouter/free");
  }
  assert.equal(((main.heartbeat as Record<string, unknown>) ?? {}).accountId, "main");
  assert.equal(((rahul.heartbeat as Record<string, unknown>) ?? {}).accountId, "rahul");
  assert.equal(((victor.heartbeat as Record<string, unknown>) ?? {}).accountId, "victor");
  assert.ok(Array.isArray(defaults.skills));
  assert.ok("openrouter/free" in (defaults.models as Record<string, unknown>));
  assert.ok("openrouter/qwen/qwen3.5-flash-02-23" in (defaults.models as Record<string, unknown>));
  assert.ok(agentList.every((agent) => Array.isArray(agent.skills)));
  assert.ok(agentList.every((agent) => {
    const tools = agent.tools as Record<string, unknown>;
    return Array.isArray(tools.allow) && Array.isArray(tools.deny) && Array.isArray(tools.alsoAllow);
  }));
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
  assert.match(ansible, /Build local equity-research package/u);
  assert.match(ansible, /npm run build/u);
  assert.match(ansible, /MountainValue evaluate buy sell/u);
  assert.doesNotMatch(ansible, /channels[\s\S]*?- add[\s\S]*?OPENCLAW_DISCORD_BOT_TOKEN_VICTOR/u);
  assert.match(ansible, /OPENCLAW_DISCORD_BOT_TOKEN_MAIN/u);
  assert.match(ansible, /OPENCLAW_DISCORD_BOT_TOKEN_RAHUL/u);
  assert.match(ansible, /OPENCLAW_DISCORD_BOT_TOKEN_VICTOR/u);
  assert.match(ansible, /- openclaw[\s\S]*?- cron[\s\S]*?- add/u);
  assert.match(ansible, /0 8-13 \* \* 1-5/u);
  assert.match(ansible, /- --agent[\s\S]*?- victor/u);
  assert.match(ansible, /- --announce/u);
  assert.match(ansible, /- --channel[\s\S]*?- discord/u);
  assert.match(ansible, /- --account[\s\S]*?- victor/u);
  assert.match(ansible, /- --to[\s\S]*OPENCLAW_EQUITY_DISCORD_FORUM_CHANNEL_ID/u);
  const envTemplate = repoText(join("infrastructure", "ansible", "templates", "openclaw.env.j2"));
  assert.match(envTemplate, /EXECUTION_MODE=paper/u);
  assert.doesNotMatch(envTemplate, /^DISCORD_BOT_TOKEN=/mu);
  assert.match(repoText(join("openclaw", "customAgents", "workspace-victor", "TOOLS.md")), /daily_report\.execution/u);
});
