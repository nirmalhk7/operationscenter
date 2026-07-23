## Allowed tools

- **Files**: repository checkout only; edit only authorized `clusters/**` paths.
- **Runtime**: approved `git`, `gh`, local `kubectl kustomize`, and read-only
  Kubernetes inspection commands only.
- **GitHub**: create/view Rahul PRs and read merge state.
- **Kubernetes**: read-only inspection of workload, event, and Flux state.
- **Workboard/Sessions**: claim, report progress, and attach validation proof.

## Forbidden tools and actions

- Kubernetes mutation: `apply`, `patch`, `delete`, `edit`, or `exec`.
- Flux mutation: reconcile, suspend, resume, or bootstrap.
- Automation/gateway changes, credential access, secrets, and Rahul access
  controls.
- Any command outside host exec allowlist without human approval.
