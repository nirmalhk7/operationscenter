# `@nirmalhk7/equity-research`

TypeScript CLI package for the OpenClaw weekday US equity research workflow.
The package owns deterministic SEC seed and filing search steps, Finviz
fundamental and technical discovery screens, earnings-yield/balance-sheet-safety/owner-earnings-quality
scorecard stages, JSON contract validation, value ranking, and configured OpenClaw agent turns used by
`/root/.openclaw/mountainvalue.lobster`.

## Package Boundary

`equity-research` produces research handoffs. It does not execute trades.
Victor is the only Discord-facing MountainValue configured agent.
`eq_quantsieve`, `eq_eventhound`, `eq_riskskeptic`, and
`eq_thesis_depth_reviewer` are MountainValue OpenClaw profiles with no Discord
bindings. `newswire` is a reusable NewsMCP-backed news profile, currently
allowlisted only for Victor. Their runtime workspaces live under
`/root/.openclaw/subAgents`, and their injected runtime instructions are
`AGENTS.md` and `TOOLS.md`. Victor can spawn only those profiles as subagents
for interactive work; the Lobster CLI calls the same profiles directly for
synchronous JSON review steps so each stage has a concrete stdout contract.
Deterministic scorecards calculate available earnings-yield,
balance-sheet-safety, and owner-earnings-quality checks first, then
`eq_thesis_depth_reviewer` reviews intrinsic value, owner earnings or
normalized free cash flow, capital allocation, per-share dilution or buybacks,
management quality, moat durability, and reinvestment runway.

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

Each Lobster step prints compact JSON to stdout. Steps after
`seed-configured-universe` accept the previous step JSON on stdin.

```text
equity-research seed-configured-universe [--limit N] [--tickers ABC,XYZ]
equity-research discover-value-candidates [--limit N] [--disabled]
equity-research discover-technical-candidates [--limit N] [--disabled]
equity-research merge-candidates
equity-research enrich-primary-filings [--limit N]
equity-research score-earnings-yield
equity-research score-balance-sheet-safety
equity-research score-owner-earnings-quality
equity-research first-pass-review
equity-research scan-news
equity-research scan-catalysts
equity-research rank-opportunities [--limit N]
equity-research narrow-review-pool [--limit N]
equity-research review-thesis-depth
equity-research review-risks
equity-research publish-final-report
equity-research validate-contract reviews|event|final
```

Candidate handoffs use `ticker`, `company`, `sources`, `screen_reasons`,
`metrics`, `filing_refs`, `news_refs`, `polymarket_context`, and
`evidence_gaps`. The value stages write `metrics.earnings_yield_scorecard`, `metrics.balance_sheet_safety`,
`metrics.owner_earnings_quality`, `metrics.opportunity_scorecard`, and `metrics.value_composite`; missing inputs
are explicit instead of implied. The opportunity scorecard scores buying
opportunities across the full universe: cheap normalized earnings, asset value,
owner-earnings durability, balance-sheet support, primary filing evidence, and
special situations. Large caps are allowed, but generic quality is not enough.
Review verdicts use `ticker`, `verdict`, `bull_case`,
`bear_case`, `disqualifiers`, `required_checks`, and `confidence`. Victor must
return a final memo or docket object. A memo should not clear unless the
thesis-depth review has enough primary evidence for intrinsic value, per-share
capital allocation, management/governance, and moat claims; otherwise Victor
should publish a docket.

## Providers

SEC company ticker and XBRL company-facts responses anchor filing-derived facts.
The SEC filing search step then uses the SEC submissions history for every
mapped candidate and adds recent research-relevant filing references with primary
document URLs before agent review. Use a real contact user agent via
`OPENCLAW_EDGAR_USER_AGENT` or `SEC_USER_AGENT` on the OpenClaw node. When available, SEC XBRL extraction also
passes operating income, operating cash flow, capital expenditures, stock
repurchases, dividends, current assets, current liabilities, cash, debt,
property and equipment, shares outstanding, return on equity, liabilities to
equity, debt to equity, working capital, current ratio, and an owner-earnings
proxy into the candidate metrics for deterministic scorecards and thesis-depth
review.

The value stages are deliberately mechanical:

- `score-earnings-yield`: calculates earnings yield and return on capital when EBIT,
  enterprise value or market-cap/debt/cash, and tangible-capital inputs exist.
- `score-balance-sheet-safety`: checks current ratio, debt/equity, NCAV margin,
  P/E, and price/book when inputs exist.
- `score-owner-earnings-quality`: checks ROE, margin durability proxy, owner-earnings
  conversion, leverage, and visible capital returns.
- `rank-opportunities`: ranks by opportunity score, composite score, and
  earnings-yield rank while
  excluding candidates already rejected by subagent reviews.

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
  When unset, SEC seeding stays empty and Finviz discovery drives the universe.
- `OPENCLAW_SEC_SEED_LIMIT`: default `40`.
- `OPENCLAW_SEC_FILING_SEARCH_LIMIT`: recent filing refs per candidate, default `6`.
- `OPENCLAW_SEC_FILING_FORMS`: optional comma-separated SEC forms to retain.
- `OPENCLAW_FINVIZ_SEED_LIMIT`: default `40`.
- `OPENCLAW_FINVIZ_TECHNICAL_SEED_LIMIT`: default `40`.
- `OPENCLAW_EQUITY_DEEP_REVIEW_LIMIT`: default `8`.
- `OPENCLAW_EQUITY_AGENT_TIMEOUT_SECONDS`: default `900`.
- `OPENCLAW_EQUITY_DISCORD_FORUM_CHANNEL_ID`: Victor forum target. The
  deployed MountainValue target is `1504282224789295134`.

## Schedule

The LXC playbook deploys the workflow and defaults the Victor forum target to
`1504282224789295134`. The playbook does not create the cron entry; add or remove
cron jobs manually from the OpenClaw host.

## Polymarket

Ansible installs `polymarket-mcp` from npm. OpenClaw registers
its `/root/.local/share/pnpm/polymarket-mcp` command. `eq_eventhound` is the
only MountainValue review profile expected to use Polymarket context, and
`openclaw/openclaw.json` allows only the reviewed market discovery/detail tools
for catalyst context.

## News

Ansible installs `@newsmcp/server` from npm. OpenClaw registers
its `/root/.local/share/pnpm/newsmcp` command. `newswire` is the only profile
in this package expected to use NewsMCP context. It is general-purpose, but
MountainValue currently calls it in the `scan-news` lane before
`scan-catalysts`; it can support timing, risk, or repricing context, but it is
not valuation evidence.

## Validation

Local package checks:

```sh
npm test
```

Target-host checks after Ansible deployment:

```sh
openclaw --version
openclaw config validate
openclaw doctor
openclaw mcp list
openclaw mcp show github --json
openclaw mcp show kubernetes --json
openclaw mcp show newsmcp --json
openclaw mcp show nseindia --json
openclaw mcp show polymarket --json
printf '{"reviews":[]}' | equity-research validate-contract reviews
openclaw cron list --agent victor
```

Then run a bounded Victor Lobster job against a staging Discord forum channel
before enabling the production schedule.
