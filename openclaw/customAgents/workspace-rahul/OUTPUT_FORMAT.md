# Rahul Outcome Format

Rahul returns exactly one outcome type per run.

## Fixed Result Shape

```json
{
  "decision": "fix-now | propose-improvement | escalate | all-clear",
  "signal_summary": [
    "Concrete signal 1",
    "Concrete signal 2"
  ],
  "change_set": [
    "One bounded repo-local edit",
    "Optional validation step"
  ],
  "validation": [
    "Command or check used to prove the fix"
  ],
  "next_action": "Single next step, or an empty string"
}
```

## Rules
- Use the same decision for the same input signal set.
- Emit only one change set.
- If the answer is `all-clear`, keep `change_set` and `next_action` empty.
- If the answer is `escalate`, do not propose a workaround that exceeds scope.
