# MountainValue Cron To Discord Flow

This note describes the deployed MountainValue weekday equity research flow from
the moment the OpenClaw cron job fires through the final Discord forum post.

Source files:

- `openclaw/README.md`
- `openclaw/mountainvalue.lobster`
- `openclaw/openclaw.json`
- `openclaw/cli/equity-research/src/cli.ts`
- `openclaw/cli/equity-research/src/agent-turns.ts`
- `openclaw/customAgents/workspace-victor/AGENTS.md`

## 1. Cron Fires

OpenClaw cron is enabled in `openclaw/openclaw.json`:

```json
"cron": {
  "enabled": true,
  "store": "/root/.openclaw/cron/cron.json",
  "maxConcurrentRuns": 2,
  "sessionRetention": "24h"
}
```

The MountainValue job is not created by Ansible. It must already exist in the
deployed host's cron store. The intended schedule is:

```sh
0 6 * * 1-5
```

Timezone:

```sh
America/Denver
```

Expected behavior:

- At 6:00 AM Mountain time, Monday through Friday, OpenClaw starts the saved
  cron job.
- The job should be owned by `victor`, not `main`.
- The documented cron uses `--session isolated --no-deliver`, so the cron
  trigger itself should not post a normal Discord reply.

## 2. Victor Receives The Scheduled Message

The cron message tells Victor to run the Lobster workflow:

```text
Use the Lobster tool with action "run" and pipeline "/root/.openclaw/mountainvalue.lobster". Set cwd to "/root/.openclaw", timeoutMs to 1800000, and maxStdoutBytes to 1048576. Do not read the path as a directory.
```

Victor's runtime instructions say to call the Lobster tool directly.

Expected behavior:

- Victor should not chat casually.
- Victor should call the Lobster tool.
- If the Lobster run fails, times out, or reports an unavailable stage, Victor
  should not invent a final memo.

## 3. Lobster Starts The Pipeline

Victor's tool call should be:

```json
{
  "action": "run",
  "pipeline": "/root/.openclaw/mountainvalue.lobster",
  "cwd": "/root/.openclaw",
  "timeoutMs": 1800000,
  "maxStdoutBytes": 1048576
}
```

Expected behavior:

- Lobster reads `/root/.openclaw/mountainvalue.lobster`.
- It runs each step in order.
- Each step receives the previous step's JSON stdout as stdin.
- Each step must print compact JSON to stdout.

## 4. Seed Configured Universe

Command:

```sh
equity-research seed-configured-universe
```

What it does:

- Uses `OPENCLAW_SEC_SEED_TICKERS` if set.
- Pulls SEC ticker and company-facts data for those tickers.
- If no ticker list is configured, this can legitimately start with an empty
  candidate list.

Expected JSON shape:

```json
{
  "candidates": [],
  "provider_errors": [],
  "generated_at": "..."
}
```

## 5. Discover Value Candidates

Command:

```sh
equity-research discover-value-candidates
```

What it does:

- Uses Finviz as a discovery source.
- Looks for cheap, profitable, liquid US candidates.
- Treats Finviz as discovery context only, not primary evidence.

Expected output:

- Candidate list grows.
- Each Finviz candidate gets `sources`, `screen_reasons`, and
  `evidence_gaps`.
- If Finviz fails, the run should continue with a `provider_errors` entry.

## 6. Discover Technical Candidates

Command:

```sh
equity-research discover-technical-candidates
```

What it does:

- Adds liquid US names above selected moving averages.
- Treats these names as discovery context only.

Expected output:

- More candidates may be appended.
- Failures are recorded as provider errors instead of killing the whole run.

## 7. Merge Candidates

Command:

```sh
equity-research merge-candidates
```

What it does:

- Normalizes candidate records.
- Deduplicates and merges ticker payloads from SEC and Finviz sources.

Expected output:

- One candidate object per ticker.
- Combined `sources`, `screen_reasons`, `metrics`, `filing_refs`, and
  `evidence_gaps`.

## 8. Enrich Primary Filings

Command:

```sh
equity-research enrich-primary-filings
```

What it does:

- Maps tickers to SEC CIKs.
- Pulls SEC company facts and recent filings.
- Adds filing refs such as 10-K, 10-Q, 8-K, S-1, S-4, proxy filings, and
  tender documents.

Expected output:

- Candidates get `sec_xbrl` evidence where available.
- `filing_refs` should contain dated SEC references and document URLs.
- Missing SEC mapping or SEC failures appear as `evidence_gaps` or
  `provider_errors`.

## 9. Mechanical Scorecards

Commands:

```sh
equity-research score-earnings-yield
equity-research score-balance-sheet-safety
equity-research score-owner-earnings-quality
```

What they do:

- Add deterministic scorecards under `candidate.metrics`.
- Required scorecards include `earnings_yield_scorecard`,
  `balance_sheet_safety`, `owner_earnings_quality`, `opportunity_scorecard`,
  and `value_composite`.

Expected output:

- Each candidate gets pass, watch, or fail style scorecard data.
- Missing inputs are explicit.
- Failures are added to `evidence_gaps`.

## 10. First-Pass Review

Command:

```sh
equity-research first-pass-review
```

What it does:

- Calls OpenClaw directly:

```sh
openclaw agent --agent eq_quantsieve --message <json> --timeout 900 --json
```

Expected answer from `eq_quantsieve`:

```json
{
  "reviews": [
    {
      "ticker": "ABC",
      "verdict": "proceed",
      "bull_case": [],
      "bear_case": [],
      "disqualifiers": [],
      "required_checks": [],
      "confidence": "medium"
    }
  ]
}
```

If the worker returns prose, malformed JSON, or the wrong fields, the stage
fails.

## 11. News Scan

Command:

```sh
equity-research scan-news
```

What it does:

- Calls the `newswire` OpenClaw profile.
- Uses NewsMCP context.
- Keeps news separate from primary valuation evidence.

Expected answer:

```json
{
  "reviews": [],
  "event_candidates": []
}
```

The output is merged back into the candidate payload.

## 12. Catalyst Scan

Command:

```sh
equity-research scan-catalysts
```

What it does:

- Calls `eq_eventhound`.
- Looks for special situations, filings, restructurings, tender offers,
  spinoffs, insider events, and corporate catalysts.
- May use allowed Polymarket market context.

Expected answer:

```json
{
  "reviews": [],
  "event_candidates": []
}
```

## 13. Rank Opportunities

Command:

```sh
equity-research rank-opportunities
```

What it does:

- Recomputes or refreshes scorecards if needed.
- Filters out rejected names.
- Sorts by opportunity score, value composite, and earnings-yield rank.
- Narrows to `OPENCLAW_EQUITY_DEEP_REVIEW_LIMIT`, default `8`.

Expected output:

- A smaller candidate set.
- `excluded_after_narrowing` lists names cut from deep review.

## 14. Thesis-Depth Review

Command:

```sh
equity-research review-thesis-depth
```

What it does:

- Calls `eq_thesis_depth_reviewer`.
- Checks intrinsic value, owner earnings or normalized free cash flow, capital
  allocation, management quality, moat, and reinvestment runway.

Expected answer:

- A `reviews` array.
- If evidence is thin, expect `caution` or `reject`, not forced conviction.

## 15. Risk Review

Command:

```sh
equity-research review-risks
```

What it does:

- Calls `eq_riskskeptic`.
- Looks for accounting, dilution, governance, legal or regulatory,
  refinancing, and unsupported-evidence risks.

Expected answer:

- A final `reviews` array.
- A risk rejection blocks a memo-quality final pick.

## 16. Publish Final Report

Command:

```sh
equity-research publish-final-report
```

What it does:

- First checks that all required gates exist.
- If gates are missing, it returns a blocked docket automatically.
- If gates are complete, it calls Victor as the final report agent.

Expected Victor JSON for a memo:

```json
{
  "mode": "memo",
  "title": "Daily Equity Idea - ABC",
  "selected_ticker": "ABC",
  "body_markdown": "...",
  "reviewed_candidates": [],
  "rejected_candidates": [],
  "missing_evidence": []
}
```

Expected Victor JSON when no name clears the bar:

```json
{
  "mode": "docket",
  "title": "Daily Equity Docket - Pipeline Incomplete",
  "selected_ticker": null,
  "body_markdown": "...",
  "reviewed_candidates": [],
  "rejected_candidates": [],
  "missing_evidence": []
}
```

## 17. Discord Forum Post

Victor is the only Discord-facing MountainValue agent. In `openclaw.json`, the
Discord account `victor` is bound to agent `victor`.

The forum target comes from:

```sh
OPENCLAW_EQUITY_DISCORD_FORUM_CHANNEL_ID
```

Default deployed target:

```text
1504282224789295134
```

Expected Discord result:

- Exactly one final forum artifact.
- Either a memo for a selected ticker, or a docket explaining why nothing
  cleared.
- No duplicate casual follow-up message after the forum post.

## Failure Checks

If the cron fires but Discord gets no final post, inspect in this order:

```sh
openclaw cron list --agent main
openclaw cron list --agent victor
openclaw config validate
openclaw doctor
printf '{"reviews":[]}' | equity-research validate-contract reviews
```

Stale cron jobs under `main` can still run from
`/root/.openclaw/cron/cron.json`. The intended MountainValue job should be
Victor-owned.
