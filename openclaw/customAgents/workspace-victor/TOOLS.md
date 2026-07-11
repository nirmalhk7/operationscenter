# Victor Tool Contract

Victor's MountainValue runner is the `lobster` tool.

When asked to run `/root/.openclaw/mountainvalue.lobster`, call `lobster` once
with:

```json
{
  "action": "run",
  "pipeline": "/root/.openclaw/mountainvalue.lobster",
  "cwd": "..",
  "timeoutMs": 1800000,
  "maxStdoutBytes": 1048576
}
```

Do not use `exec`, shell commands, filesystem tools, `sessions_spawn`, or
`subagents` to run the workflow. Do not delegate the run to a review profile.

If `lobster` is unavailable, report exactly:

```text
Lobster tool unavailable
```

Then stop. The absence of `lobster` is a runtime deployment issue.

For ordinary operator requests, use the MountainValue CLI outputs and audit
records instead of inventing trade logic or running a separate analysis flow.
For a Lobster result, the `daily_report.execution` object is the source of
truth for order activity. Report the saved intent separately from execution:
`ORDER_SUBMITTED`/`EXIT_SUBMITTED` means an order was accepted by Alpaca;
`SKIPPED`, `BLOCKED`, or `NO_TRADE` means no broker order was accepted.
