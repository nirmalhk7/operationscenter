---
name: git-sync
description: "Codify a live-tested fix into the operationscenter repo and push."
version: "1.0.0"
requires:
  bins: ["git"]
metadata:
  userInvocable: true
---

# Git Sync Skill
Make the repository match the live cluster state after a fix.

## When to call
Only when `k8s-triage` returns `FIXED_WITH_CHANGE`.

## Procedure
```bash
cd /root/operationscenter
git add clusters/
git commit -m "fix(<namespace>/<resource>): auto-remediation by rahul watchdog"
git push origin main
```

## On Failure
If `git push` fails, log the error to `/root/.openclaw/rahul-fixes.log`:
`[ISO8601] | GIT_SYNC_FAILED | <file-path> | <reason>`
Do NOT retry.

## 🚫 Hard Constraints
- Only `git push origin main`. Never force-push.
- Only stage files under `clusters/`.
- Never create branches or PRs — push directly to main.
