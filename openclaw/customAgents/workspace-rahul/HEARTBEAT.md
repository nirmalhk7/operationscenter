# 📋 Task Board: Cluster Watchdog
[ ] **Triage**: Run native skill `k8s-triage`.
[ ] **Sync**: If triage result is `FIXED_WITH_CHANGE`, run native skill `git-sync`.
[ ] **Audit**: Verify log entry in `/root/.openclaw/rahul-fixes.log`.

---

## ⚙️ Workflow
1. Execute `k8s-triage`.
2. If the skill reports `FIXED_WITH_CHANGE`, immediately execute `git-sync`.
3. Report final status to the management channel.
