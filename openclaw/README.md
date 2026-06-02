# OpenClaw Operations

## Agent Inventory

This inventory reflects the deployed OpenClaw runtime configuration in
`openclaw/openclaw.json` plus the workspace docs copied by
`infrastructure/ansible/lxc-openclaw.ansible.yaml`.

### Configured agents

- `main`: default Operations Center coordinator. Runtime workspace:
  `/root/.openclaw/workspace`. External access: Discord `main`, Telegram
  `main`.
- `rahul`: Proxmox, Kubernetes monitoring, Flux repo troubleshooting, YAML
  fixes, and PR-oriented ops work. Runtime workspace:
  `/root/.openclaw/workspace-rahul`. External access: Discord `rahul`.
- `victor`: MountainValue final value analyst and publisher. Owns Lobster
  equity research runs, coordinates the configured review profiles,
  enforces the evidence bar, and posts the final Discord forum artifact.
  Runtime workspace: `/root/.openclaw/workspace-victor`. External access:
  Discord `victor`.

## Discord Operating Guide

- Use `main` for general Operations Center coordination and cross-agent routing.
- Use `rahul` for Proxmox, Kubernetes, Flux, YAML, and PR-oriented ops work.
- Use `victor` for MountainValue status, runs, and final equity research
  publishing.
- Start work in the relevant server channel or thread when the context should
  remain visible. OpenClaw keeps thread bindings active for up to 48 idle hours
  and 168 total hours.
- Approvals continue to route to DM and are limited to the configured approver.
  Do not move access tokens, credentials, or sensitive blockers into public
  channels.
- Long-running Discord tasks should produce short progress updates at start,
  major stage changes, and completion or blockage. Final replies should include
  the result, validation performed, and any live follow-up still required.

Common prompts:

```text
Rahul, check the Flux health for the managed cluster and summarize blockers.
```

```text
Victor, run MountainValue.
```

```text
Main, route this to the right agent and keep status updates in this thread.
```

### Configured subagents

These profiles are also active in `agents.list`, but they have no Discord or
Telegram bindings. The `eq_*` profiles are MountainValue equity workers.
`newswire` is a reusable news-context worker currently allowlisted only for
Victor. The Lobster CLI may call these profiles directly for synchronous JSON
review stages.

- `eq_quantsieve`: first-pass value and quality reviewer. Audits cheapness,
  business quality, leverage, liquidity, balance-sheet sanity,
  margin-of-safety potential, and value-trap risk. Workspace:
  `/root/.openclaw/subAgents/eq_quantsieve`.
- `newswire`: reusable news-context reviewer. Uses Exa MCP for dated,
  source-attributed entity or topic news. For MountainValue it looks for
  company-specific news that could explain forced selling, repricing,
  regulatory pressure, litigation, management change, capital-market stress, or
  catalyst timing. Workspace: `/root/.openclaw/subAgents/newswire`.
- `eq_eventhound`: corporate catalyst and special-situation reviewer. Looks
  for spin-offs, restructurings, tender offers, mergers, asset sales,
  recapitalizations, insider activity, and material SEC filing events.
  Workspace: `/root/.openclaw/subAgents/eq_eventhound`.
- `eq_thesis_depth_reviewer`: thesis-depth US equity reviewer. Checks owner
  earnings or normalized free cash flow, intrinsic value support, margin of
  safety, capital allocation, dilution or buybacks, governance, moat durability,
  reinvestment runway, and dated filing events. Workspace:
  `/root/.openclaw/subAgents/eq_thesis_depth_reviewer`.
- `eq_riskskeptic`: bear-case and evidence-quality reviewer. Challenges
  accounting, dilution, governance, litigation, refinancing, regulatory
  exposure, management churn, catalyst resolution, moat durability, valuation
  support, and unsupported claims. Workspace:
  `/root/.openclaw/subAgents/eq_riskskeptic`.

### Workspace docs present but not configured

The LXC playbook copies every directory under `openclaw/customAgents/` to
`/root/.openclaw/`, but a copied workspace is not an active OpenClaw agent unless
it is also listed in `openclaw/openclaw.json`.

- `workspace-max`: not configured as an active agent. Docs describe a startup
  opportunity advocate.
- `workspace-marie`: not configured as an active agent. Docs describe a startup
  flaw finder.
- `workspace-motabhai`: not configured as an active agent. Docs describe a
  senior Indian equity analyst for Dhandho-style NSE/BSE research.

## MountainValue Manual Run

The LXC deployment copies `mountainvalue.lobster` to:

```sh
/root/.openclaw/mountainvalue.lobster
```

Run the pipeline from Discord or the OpenClaw UI by telling Victor exactly:

```text
Use the Lobster tool with action "run" and pipeline "/root/.openclaw/mountainvalue.lobster". Set cwd to "/root/.openclaw", timeoutMs to 1800000, and maxStdoutBytes to 1048576. Do not read the path as a directory.
```

Victor's Lobster tool call should be:

```json
{
  "action": "run",
  "pipeline": "/root/.openclaw/mountainvalue.lobster",
  "cwd": "/root/.openclaw",
  "timeoutMs": 1800000,
  "maxStdoutBytes": 1048576
}
```

The workflow itself handles the final `publish-final-report` step. Victor should post
one Discord forum artifact only when `OPENCLAW_EQUITY_DISCORD_FORUM_CHANNEL_ID`
points to the real forum channel. The deployed default target is
`1504282224789295134`.

MountainValue worker roles are configured OpenClaw profiles with no Discord
bindings. Their workspaces and role docs deploy to `/root/.openclaw/subAgents/`.
OpenClaw v2026.4.23 subagent context injects `AGENTS.md` and `TOOLS.md`, so those
two files are the runtime contract:

- `eq_quantsieve`: first-pass value and quality review.
- `newswire`: reusable Exa MCP-backed news scan.
- `eq_eventhound`: corporate catalyst and special-situation scan.
- `eq_thesis_depth_reviewer`: thesis-depth US equity review.
- `eq_riskskeptic`: bear-case and evidence-quality review.

Victor is allowed to spawn only these configured profiles as subagents.
The Lobster CLI also calls these profiles directly for synchronous JSON review
steps, which keeps the pipeline deterministic instead of waiting on background
subagent announce messages.

## Optional Manual Cron

The LXC Ansible playbook does not create or update this cron job. To schedule it
manually on the OpenClaw host, run:

```sh
openclaw cron add \
  --name "MountainValue Daily Equity Research" \
  --cron "0 6 * * 1-5" \
  --tz "America/Denver" \
  --session isolated \
  --agent victor \
  --no-deliver \
  --message 'Use the Lobster tool with action "run" and pipeline "/root/.openclaw/mountainvalue.lobster". Set cwd to "/root/.openclaw", timeoutMs to 1800000, and maxStdoutBytes to 1048576. Do not read the path as a directory. After the workflow completes, publish exactly one final Discord forum artifact or docket when the configured forum channel id is real.'
```

To run that scheduled job immediately:

```sh
openclaw cron list --agent victor
openclaw cron run <job-id>
```

## Remove Old Cron

The LXC playbook no longer manages the MountainValue cron. If an older job still
exists on the OpenClaw host, it can still run from the persisted cron registry
and post through the agent that originally owned it. Check both Victor and the
main agent before testing manual runs:

```sh
openclaw cron list --agent main
openclaw cron list --agent victor
```

Remove every old `MountainValue Daily Equity Research` job shown under the wrong
agent, especially any job under `main`, using the job id from the list output:

```sh
openclaw cron remove <job-id>
```

After the stale job is gone, add only the Victor-owned cron shown above.

## Deployment Validation

The LXC Ansible playbook validates the candidate `openclaw/openclaw.json`
before promoting it into `/root/.openclaw/openclaw.json`. Validation runs with
the pinned OpenClaw CLI version from `infrastructure/ansible/vars/versions.yaml`
and a temporary staged HOME on the OpenClaw host.

If the config is invalid, the notebook fails during validation and leaves the
live OpenClaw config untouched. The currently running service continues to use
the previous deployed config until a valid candidate passes validation.


# codex resume 019e537a-5065-7fd1-b08c-99e1667ba4d7
