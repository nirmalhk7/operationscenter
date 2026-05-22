# `@nirmalhk7/equity-research`

TypeScript CLI package for the OpenClaw weekday US equity research workflow.
The package owns deterministic SEC seed and filing search steps, Finviz
fundamental and technical discovery screens, JSON contract validation, merge and
narrowing steps, and configured OpenClaw agent turns used by
`/root/.openclaw/mountainvalue.lobster`.

## Package Boundary

`equity-research` produces research handoffs. It does not execute trades.
Oracle, QuantSieve, EventHound, and RiskSkeptic remain configured OpenClaw
agents; this package gives Lobster repeatable JSON steps around those agent
turns.

The CLI is published to GitHub Packages as
`@nirmalhk7/equity-research`. Changes to this package on `main` run
`semantic-release`; Conventional Commits decide the next semver release:

- `fix:` produces a patch version.
- `feat:` produces a minor version.
- a `BREAKING CHANGE:` footer produces a major version.

`semantic-release` writes the published package version, creates the
`equity-research-v<version>` tag, and publishes GitHub release notes. Manual
`version:patch`, `version:minor`, and `version:major` scripts remain available
for local inspection, but CI owns normal releases.

## Install

GitHub Packages npm installs require registry authentication, including for
public packages. Configure a classic GitHub token with `read:packages` for the
OpenClaw node:

```ini
@nirmalhk7:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=TOKEN
```

The Ansible OpenClaw deploy writes that config from
`OPENCLAW_GITHUB_TOKEN` and installs the version pinned by
`equity_research_version`.

For local package work:

```sh
npm install
npm test
npm pack --dry-run
```

## CLI Contract

Each Lobster step prints compact JSON to stdout. Steps after `sec-seed` accept
the previous step JSON on stdin.

```text
equity-research sec-seed [--limit N] [--tickers ABC,XYZ]
equity-research finviz-seed [--limit N] [--disabled]
equity-research finviz-technical-seed [--limit N] [--disabled]
equity-research merge-seed-pool
equity-research sec-filing-search [--limit N]
equity-research quantsieve-review
equity-research eventhound-scan
equity-research narrow-pool [--limit N]
equity-research riskskeptic-review
equity-research oracle-finalize
equity-research validate-contract reviews|event|final
```

Candidate handoffs use `ticker`, `company`, `sources`, `screen_reasons`,
`metrics`, `filing_refs`, `news_refs`, `polymarket_context`, and
`evidence_gaps`. Review verdicts use `ticker`, `verdict`, `bull_case`,
`bear_case`, `disqualifiers`, `required_checks`, and `confidence`. Oracle must
return a final memo or docket object.

## Providers

SEC company ticker and XBRL company-facts responses anchor filing-derived facts.
The SEC filing search step then uses the SEC submissions history for every
mapped candidate and adds recent research-relevant filing references with primary
document URLs before agent review. Use a real contact user agent via
`SEC_USER_AGENT` on the OpenClaw node.

The Finviz paths are isolated, fail-soft seed providers. The fundamental screen
looks for a bounded cheap/profitable/liquid seed set. The technical screen looks
for a bounded liquid US set above its 20-, 50-, and 200-day simple moving
averages. The TypeScript adapter extracts ticker quote links from Finviz
screener HTML responses; it does not treat Finviz as primary evidence. Disable
or replace them with:

- `OPENCLAW_FINVIZ_DISABLED=1`
- `OPENCLAW_FINVIZ_SEED_URL`
- `OPENCLAW_FINVIZ_USER_AGENT`
- `OPENCLAW_FINVIZ_TECHNICAL_DISABLED=1`
- `OPENCLAW_FINVIZ_TECHNICAL_SEED_URL`

Other runtime controls:

- `OPENCLAW_SEC_SEED_TICKERS`: optional comma-separated SEC ticker subset.
- `OPENCLAW_SEC_SEED_LIMIT`: default `40`.
- `OPENCLAW_SEC_FILING_SEARCH_LIMIT`: recent filing refs per candidate, default `6`.
- `OPENCLAW_SEC_FILING_FORMS`: optional comma-separated SEC forms to retain.
- `OPENCLAW_FINVIZ_SEED_LIMIT`: default `40`.
- `OPENCLAW_FINVIZ_TECHNICAL_SEED_LIMIT`: default `40`.
- `OPENCLAW_EQUITY_DEEP_REVIEW_LIMIT`: default `8`.
- `OPENCLAW_EQUITY_AGENT_TIMEOUT_SECONDS`: default `900`.
- `OPENCLAW_EQUITY_DISCORD_FORUM_CHANNEL_ID`: Oracle forum target.

## Schedule

Create the weekday premarket job on the OpenClaw host after deployment:

```sh
openclaw cron add \
  --name "MountainValue Daily Equity Research" \
  --cron "0 6 * * 1-5" \
  --tz "America/Denver" \
  --session isolated \
  --agent oracle \
  --no-deliver \
  --message "Run the Lobster workflow at /root/.openclaw/mountainvalue.lobster. Oracle must publish exactly one final Discord forum artifact or a docket."
```

`--no-deliver` avoids a second cron reply. Keep
`OPENCLAW_EQUITY_DISCORD_FORUM_CHANNEL_ID` at the placeholder value until a
staging or production forum channel is chosen.

## Polymarket

Ansible installs `berlinbra/polymarket-mcp` as a `uv` tool. OpenClaw registers
its `/root/.local/bin/polymarket-mcp` command. EventHound is the only daily
research role left with bundled MCP visibility and may use Polymarket only for
read-only catalyst context.

## Validation

Local package checks:

```sh
npm test
```

Target-host checks after Ansible deployment:

```sh
openclaw config validate
openclaw doctor
openclaw mcp show polymarket
printf '{"reviews":[]}' | equity-research validate-contract reviews
openclaw cron list --agent oracle
```

Then run a bounded Oracle Lobster job against a staging Discord forum channel
before enabling the production schedule.
