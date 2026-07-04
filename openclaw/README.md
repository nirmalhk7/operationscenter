# OpenClaw Operations

## Agent Inventory

This inventory reflects the deployed OpenClaw runtime configuration in
`openclaw/openclaw.json` plus the workspace docs copied by
`infrastructure/ansible/lxc-openclaw.ansible.yaml`.

### Configured agents

- `main`: default Operations Center coordinator. Runtime workspace:
  `/root/.openclaw/workspace`. External access: Discord `main`.
- `rahul`: Proxmox, Kubernetes monitoring, Flux repo troubleshooting, YAML
  fixes, and PR-oriented ops work. His 5-minute heartbeat checks the managed
  cluster through the Kubernetes MCP server, then opens a PR for repo-local
  fixes or escalates to the forum channel when human action is needed. When
  the cluster is quiet, he still looks for one bounded improvement worth
  proposing. His outcome type is one of `fix-now`, `propose-improvement`,
  `escalate`, or `all-clear`.
  He also has the Rahul-only `fix-that-thang` package for repeatable
  maintenance analysis and PR drafting.
  Runtime workspace: `/root/.openclaw/workspace-rahul`. External access:
  Discord `rahul`.
- `victor`: MountainValue operator interface. Owns the Lobster paper-trading
  workflow, reports status and audit history, and handles explicit pause /
  resume requests. Runtime workspace: `/root/.openclaw/workspace-victor`.
  External access: Discord `victor`.
  Runtime workspace: `/root/.openclaw/workspace-victor`. External access:
  Discord `victor`.
- `alexa`: technical storyteller and blog-draft writer for Rahul's solved
  cluster problems. Turns validated, blog-worthy fixes into publish-ready
  posts that cover the problem, why it happened, the options considered, the
  chosen fix, and the validation path. She returns either `blog-worthy` or
  `needs-more-evidence`. Runtime workspace:
  `/root/.openclaw/workspace-alexa`. External access: none yet; draft-only
  agent.

## Discord Operating Guide

- Use `main` for general Operations Center coordination and cross-agent routing.
- Use `rahul` for Proxmox, Kubernetes, Flux, YAML, and PR-oriented ops work.
- Use `victor` for MountainValue status, workflow runs, reports, and explicit
  pause / resume control.
- Use `alexa` for postmortem-style engineering blogs about Rahul's solved
  cluster issues, but only when the fix is validated and worth a real writeup.
- Discord-facing agents can inspect image and GIF attachments, and may reply
  with GIF/image attachments using `MEDIA:` when that is the natural response.
- Start work in the relevant server channel or thread when the context should
  remain visible. OpenClaw keeps thread bindings active for up to 48 idle hours
  and 168 total hours.
- Approvals continue to route to DM and are limited to the configured approver.
  Do not move access tokens, credentials, or sensitive blockers into public
  channels.
- Long-running Discord tasks should produce short progress updates at start,
  major stage changes, and completion or blockage. Final replies should include
  the result, validation performed, and any live follow-up still required.
- Discord progress drafts are intentionally enabled with
  `channels.discord.streaming.mode: progress`. OpenClaw v2026.5.28 surfaces
  commentary in those drafts, so long-running runs should show useful live
  context before the final reply.
- Workboard is enabled for coordinating active agent work. Use it for work that
  needs ownership, heartbeat/progress, proof, release, comments, or unblock
  state instead of relying only on Discord scrollback. Rahul has explicit
  Workboard tool access; main gets Workboard through the full tool profile.

Common prompts:

```text
Rahul, check the Flux health for the managed cluster and summarize blockers.
```

```text
Rahul, inspect managed-cluster errors, make bounded live edits to validate the fix, open a PR if the fix is repo-local, and escalate to Discord forum channel 1504282224789295134 only if I need to intervene.
```

```text
Rahul, run fix-that-thang on this maintenance bundle and draft the PR if it stays within the fixed decision rules.
```

```text
Alexa, turn Rahul's latest validated fix into a publish-ready blog draft with the problem, root cause, options, chosen fix, and validation.
```

```text
Victor, run MountainValue.
```

```text
Main, route this to the right agent and keep status updates in this thread.
```

### Configured subagents

These profiles are also active in `agents.list`, but they have no Discord
bindings. MountainValue v1 does not use them for trade execution. The
`eq_*` profiles remain available for separate research work, and `newswire`
is a reusable news-context worker currently allowlisted only for Victor.

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

### Free RSS MCP

OpenClaw also registers the free `rss-reader-mcp` package as `rss-reader`.
It accepts any RSS or Atom feed URL at query time.

Sample news feeds:

- BBC News: `https://feeds.bbci.co.uk/news/rss.xml`
- TechCrunch: `https://techcrunch.com/feed/`
- Hacker News: `https://hnrss.org/frontpage`
- MIT Technology Review: `https://www.technologyreview.com/feed/`

### Reddit MCP

OpenClaw registers `reddit-mcp-server` as `reddit`.

### Filesystem MCP

OpenClaw registers `@modelcontextprotocol/server-filesystem` as `filesystem`
and constrains it to `/root/.openclaw`.

### X MCP

OpenClaw registers `@mbelinky/x-mcp-server` as `x` using the package's
default OAuth 1.0a flow. Populate these environment variables before using it:

- `OPENCLAW_X_API_KEY`
- `OPENCLAW_X_API_SECRET_KEY`
- `OPENCLAW_X_ACCESS_TOKEN`
- `OPENCLAW_X_ACCESS_TOKEN_SECRET`

### Kubernetes MCP

OpenClaw registers `kubectl-mcp-tool` as `kubernetes` through a dedicated
Python virtualenv at `/root/.local/share/kubectl-mcp-server-venv`. It uses the
service `KUBECONFIG` and is the path Rahul's heartbeat uses to inspect the
managed cluster for fresh errors.

### Langfuse tracing

OpenClaw can emit Langfuse traces when these environment variables are present
on the OpenClaw host:

- `OPENCLAW_LANGFUSE_BASE_URL`
- `OPENCLAW_LANGFUSE_PUBLIC_KEY`
- `OPENCLAW_LANGFUSE_SECRET_KEY`

`infrastructure/ansible/lxc-openclaw.ansible.yaml` copies `OPENCLAW_*`
environment variables into `/root/.openclaw/.env`, so exporting those values
before running the OpenClaw deployment makes the equity-research CLI and its
agent turns trace into Langfuse automatically. If `OPENCLAW_LANGFUSE_BASE_URL`
is omitted, the runtime defaults to `https://langfuse.trusted.nirmalhk7.com`.

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

## MountainValue Workflow

The LXC deployment copies `mountainvalue.lobster` to:

```sh
/root/.openclaw/mountainvalue.lobster
```

Run the pipeline from Discord or the OpenClaw UI by telling Victor exactly:

```text
Use the Lobster tool with action "run" and pipeline "/root/.openclaw/mountainvalue.lobster". Set cwd to ".." so it resolves to "/root/.openclaw" from Victor's workspace, timeoutMs to 1800000, and maxStdoutBytes to 1048576. Do not read the path as a directory.
```

Victor's Lobster tool call should be:

```json
{
  "action": "run",
  "pipeline": "/root/.openclaw/mountainvalue.lobster",
  "cwd": "..",
  "timeoutMs": 1800000,
  "maxStdoutBytes": 1048576
}
```

The workflow is deterministic:

`preflight` → `reconcile` → `watchdog` → `signals-if-due` → `cycle-if-due` →
`cancel-stale-entries-if-due` → `daily-report`

Signals are generated after the close, execution happens the next morning, and
watchdog checks are supervision only. Victor should report the workflow result,
not invent trades. The deployed default forum target remains
`1504282224789295134` for ordinary OpenClaw posting when explicitly requested.

MountainValue worker roles are configured OpenClaw profiles with no Discord
bindings. Their workspaces and role docs deploy to `/root/.openclaw/subAgents/`.
OpenClaw v2026.5.28 subagent context injects `AGENTS.md` and `TOOLS.md`, so those
two files are the runtime contract:

- `eq_quantsieve`: first-pass value and quality review.
- `newswire`: reusable Exa MCP-backed news scan.
- `eq_eventhound`: corporate catalyst and special-situation scan.
- `eq_thesis_depth_reviewer`: thesis-depth US equity review.
- `eq_riskskeptic`: bear-case and evidence-quality review.

Victor does not use these profiles for trading decisions in MountainValue v1.

## Autonomous Schedule

MountainValue autonomous runs are GitOps-managed by
`infrastructure/ansible/lxc-openclaw.ansible.yaml` as a Victor-owned OpenClaw
cron job. The cron wakes Victor in an isolated session, calls the repo-owned
Lobster tool plugin, and announces the final result back through Victor's
private Discord route. Victor remains the private operator interface for
manual status and explicit workflow runs.

The playbook deploys focused Lobster pipelines:

- `/root/.openclaw/mountainvalue-watchdog.lobster`
- `/root/.openclaw/mountainvalue-cycle.lobster`
- `/root/.openclaw/mountainvalue-cancel-stale.lobster`
- `/root/.openclaw/mountainvalue-signals.lobster`
- `/root/.openclaw/mountainvalue.lobster`

The OpenClaw cron uses `America/Denver` and runs the buy/sell evaluation
workflow with:

```cron
0 8-13 * * 1-5
```

The `*-if-due` CLI commands still perform their own market-day and clock gates.
Cron provides autonomy; the strategy code decides whether anything is due.

## Remove Old MountainValue Cron

The current LXC playbook removes legacy root crontab entries and old
MountainValue OpenClaw cron jobs before creating the current Victor-owned job.
To inspect the active schedule on the OpenClaw host:

```sh
openclaw cron list --agent victor
crontab -l
```

There should be one OpenClaw cron named `MountainValue evaluate buy sell`, and
no MountainValue entries in root's crontab. If a stale OpenClaw cron job exists,
remove it with the job id from the list output:

```sh
openclaw cron rm <job-id>
```

The Lobster tool itself is provided by
`openclaw/plugins/lobster/src/index.js`, a local wrapper around the installed
`lobster` binary. That keeps the runtime tool contract explicit and avoids
depending on a newer hosted plugin package than this VM has pinned.

## Deployment Validation

The LXC Ansible playbook validates the candidate `openclaw/openclaw.json`
before promoting it into `/root/.openclaw/openclaw.json`. Validation runs with
the pinned OpenClaw CLI version from `infrastructure/ansible/vars/versions.yaml`
and a temporary staged HOME on the OpenClaw host.

If the config is invalid, the notebook fails during validation and leaves the
live OpenClaw config untouched. The currently running service continues to use
the previous deployed config until a valid candidate passes validation.


# codex resume 019e537a-5065-7fd1-b08c-99e1667ba4d7
