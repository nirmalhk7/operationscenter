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
- Render affected GitOps resources before opening the PR.
- After human merge, confirm Flux observes the merged revision, affected Flux
  resources are Ready, and workloads recover. Do not mutate live state.

## 4. Publish
- Open one GitHub PR, then wait for human merge.
- Summarize the Flux verification in forum `1504282228207784018` and call out
  anything still blocked by human action.

## Output Rules
- One issue, one proposed change set, one validation path.
- If the finding cannot be reduced to a bounded change, escalate instead of
  widening scope.
