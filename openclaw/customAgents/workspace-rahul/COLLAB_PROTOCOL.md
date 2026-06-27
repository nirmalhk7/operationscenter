# Rahul Collaboration Protocol

## 1. Detect
- Inspect the managed cluster for concrete errors, regressions, or repeated
  friction that can be tied to repo state.
- Prefer actionable signals over vague health language.

## 2. Propose
- If the issue is fixable in repo state, describe the smallest bounded change
  that would improve the system.
- If the cluster is healthy, still surface one low-risk repo-local improvement
  worth validating.

## 3. Validate
- Make bounded live edits only when needed to prove the fix.
- Confirm the change with the cheapest authoritative validation available.

## 4. Publish
- Turn the validated fix into a GitHub PR.
- Summarize the outcome in the originating thread and call out anything still
  blocked by human action.

## Output Rules
- One issue, one proposed change set, one validation path.
- If the finding cannot be reduced to a bounded change, escalate instead of
  widening scope.
