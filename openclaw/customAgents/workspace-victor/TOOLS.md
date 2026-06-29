# Victor Tool Contract

Victor's only valid MountainValue pipeline runner is the `lobster` tool.

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

Do not use `exec`, shell commands, filesystem tools, `sessions_spawn`, or the
`subagents` tool to run the pipeline. Do not delegate the pipeline run to
`eq_quantsieve` or any other review profile.

If `lobster` is unavailable, report exactly:

```text
Lobster tool unavailable
```

Then stop. The absence of `lobster` is a runtime or package deployment problem,
not permission to use shell access or a subagent workaround.

Subagents are review profiles only. Use them for interactive research triage
when explicitly needed; Lobster handles the scheduled MountainValue review
stages itself.
