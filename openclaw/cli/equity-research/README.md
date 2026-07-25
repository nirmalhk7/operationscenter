# `@nirmalhk7/equity-research`

TypeScript CLI package for MountainValue: reproducible research, validated
strategies, deterministic portfolio/risk management, and Alpaca paper-broker
execution. It is paper-endpoint-only; deployed mode is `[PAPER]`, with
deterministic, bounded Alpaca paper-order execution.

## Package Boundary

`equity-research` keeps research, approval, targets, and execution separate.
Only deterministic code ranks, sizes, and can submit a paper order. Victor and
review agents report source-backed findings or veto a stock thesis; they cannot
promote candidates, alter weights, or submit orders.

`backtest --as-of YYYY-MM-DD` is an informational historical experiment. It
records immutable, reproducible validation runs but cannot overwrite the
current user-approved paper-trading manifest; only `build-targets` may refresh
that manifest.
Victor is the only Discord-facing MountainValue configured agent.
`eq_quantsieve`, `eq_eventhound`, `eq_riskskeptic`, and
`eq_thesis_depth_reviewer` are MountainValue OpenClaw profiles with no Discord
bindings. `newswire` is a reusable Exa MCP-backed news profile, currently
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

For MountainValue trading runs, `daily-report.execution` is the authoritative
result of the execution cycle. `today_intent` records the deterministic signal
that was saved; it does not mean that Alpaca accepted an order. The execution
status and action reasons must be used when reporting whether a trade happened.
`daily-report.discord_summary` is the deterministic Discord-ready outcome card
and must be posted verbatim by Victor.

MountainValue remains paper-endpoint-only. `MOUNTAINVALUE_OPERATING_MODE=paper`
plus `AUTONOMOUS_EXECUTION_ENABLED=true` permits only an approved, expiring
strategy manifest to submit Alpaca paper orders. `build-targets` grants that
approval only when an immutable short-horizon validation run has an approved
candidate; otherwise it records targets in shadow mode and broker mutation is
blocked. There is no live endpoint path.

ETF sleeve: up to 90% risk assets plus a 10% BIL reserve. Universe is
VTI/QQQ/IWM/VEA/VWO/VNQ/GLD/DBC/IEF/TLT/XLK/XLF/XLV/XLE/XLI/BIL. The aggressive
paper mandate ranks the top three ETFs after each close using only 5/10/20-day
momentum, a 10-day trend gate, and 20-day realized volatility. Each ETF is
capped at 30%; no leverage, shorting, options, or extended-hours orders are
allowed. Positions exit on a 10-day trend break, target removal, or after 20
trading sessions. The next regular session may submit all required rotation
orders, subject to deterministic quote, spread, drawdown, idempotency, and
position-risk gates. The stock sleeve is research-only until point-in-time SEC
data plus all three veto-stage reviews are available. Drawdown tiers are 8%
(25% risk reduction), 12% (50%), and 15% (halt/explicit reviewed resume).
Quotes must be <=15 seconds old; ETF and stock spread caps are 15 and 30 bps.
ETF/stock stops use 3x ATR14 clamped to 6–10% and 8–15%; BIL has no stop.

Short-horizon validation is deliberately finite: three pre-registered
strategies, each using no more than 20 sessions of signal history. It uses a
504-session training history, a 20-session purge, five-session embargo, and
63-session rolling out-of-sample folds. Returns begin at the next session's
open, not the signal close; each candidate is scored against fixed 90/10
SPY/BIL and exposure-matched SPY/BIL benchmarks at 20- and 40-bps one-way
costs. The validator also applies Victor's existing 8/12/15% drawdown risk
throttle before each next-open execution. A candidate must pass at least eight folds, win six against its matched
benchmark, have positive aggregate stressed excess return, and respect the
drawdown limits before it may be considered for a future promotion. Paper
fills record midpoint-to-fill shortfall and `daily-report` exposes its average
and 95th percentile.

```text
equity-research data-sync [--as-of YYYY-MM-DD]
equity-research research-etfs [--as-of YYYY-MM-DD]
equity-research research-stocks [--as-of YYYY-MM-DD]
equity-research review-stocks [--as-of YYYY-MM-DD]
equity-research build-targets [--as-of YYYY-MM-DD]
equity-research backtest [--as-of YYYY-MM-DD]
equity-research strategy-status
equity-research weekly-report
equity-research preflight|reconcile|watchdog|signals-if-due|cycle-if-due
equity-research cancel-stale-entries-if-due|daily-report|status|pause|request-resume|audit-log
```

Persisted contracts are schema-migrated in SQLite: `StrategyManifest`,
`ResearchRun`, `CandidateScore`, `AgentReview`, `TargetAllocation`,
`TradeIntent`, `OrderAttempt`, `Fill`, `PositionRisk`, and
`PerformanceSnapshot`, and immutable `ValidationRun`. Raw provider snapshots retain provider, requested time,
effective-as-of, source URL, checksum, and strategy-run linkage.

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

The LXC playbook deploys three GitOps-managed Victor jobs to
`1504897560261689544`: intraday paper execution, post-close next-day signal
locking, and a post-close short-horizon validation run. The validator is
read-only and reports only candidate gates; it cannot submit orders.

## Polymarket

Ansible installs `polymarket-mcp` from npm. OpenClaw registers
its `/root/.local/share/pnpm/polymarket-mcp` command. `eq_eventhound` is the
only MountainValue review profile expected to use Polymarket context, and
`openclaw/openclaw.json` allows only the reviewed market discovery/detail tools
for catalyst context.

## News

OpenClaw registers Exa MCP as a remote streamable HTTP server. `newswire` is
the only profile in this package expected to use Exa search and fetch context.
It is general-purpose, but MountainValue currently calls it in the `scan-news`
lane before `scan-catalysts`; it can support timing, risk, or repricing
context, but it is not valuation evidence.

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
openclaw mcp show exa --json
openclaw mcp show nseindia --json
openclaw mcp show polymarket --json
printf '{"reviews":[]}' | equity-research validate-contract reviews
openclaw cron list --agent victor
```

Then run a bounded Victor Lobster job against a staging Discord forum channel
before enabling the production schedule.
