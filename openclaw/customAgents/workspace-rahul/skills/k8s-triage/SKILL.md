---
name: k8s-triage
description: "Detect errors in the cluster, apply fixes live, and verify they hold."
version: "1.0.0"
requires:
  bins: ["kubectl", "flux", "grep", "jq"]
metadata:
  userInvocable: true
---

# K8s Triage Skill
Detect and repair common Kubernetes and FluxCD failures.

## Outputs
Return exactly one of these result codes when done:
- `HEALTHY`: No errors found.
- `FIXED_TRANSIENT`: Fix applied (restart/delete). No file changed.
- `FIXED_WITH_CHANGE`: Fix applied AND a YAML file was modified.
- `UNRESOLVED`: Error detected but not fixable.

## Step 1: Detect
Run all four commands:
```bash
kubectl get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded -o wide
kubectl get pods -A | grep -E "CrashLoopBackOff|OOMKilled|ImagePullBackOff|Error|Evicted"
flux get kustomizations -A 2>/dev/null | grep -v "True"
flux get helmreleases -A 2>/dev/null | grep -v "True"
```
→ If ALL outputs are empty: return `HEALTHY`.

## Step 2: Triage and Fix
### CrashLoopBackOff | Error | OOMKilled
```bash
kubectl rollout restart deployment/<name> -n <namespace>
```
→ Result: `FIXED_TRANSIENT`.

### ImagePullBackOff
1. `kubectl describe pod <pod-name> -n <namespace>` to find the error.
2. Locate and fix the image tag in `/root/operationscenter/clusters/managed/<namespace>/*.yaml`.
3. Test live: `kubectl apply -f <file>.yaml`.
→ Result: `FIXED_WITH_CHANGE`.

### Evicted
```bash
kubectl delete pod <pod-name> -n <namespace>
```
→ Result: `FIXED_TRANSIENT`.

### Flux Kustomization/HelmRelease Not Ready
1. `flux reconcile <resource> <name> -n <namespace>`.
2. If it fails after 60s, check `kubectl describe`.
3. If YAML error: fix in `/root/operationscenter/clusters/managed/` and `kubectl apply`.
→ Result: `FIXED_WITH_CHANGE` or `UNRESOLVED`.

## Step 3: Verify
Wait 60s and check:
```bash
kubectl rollout status deployment/<name> -n <namespace> --timeout=60s
```

## Step 4: Log
Append to `/root/.openclaw/rahul-fixes.log`:
`[ISO8601] | <action> | <resource> | <namespace> | <result-code>`

## 🚫 Hard Constraints
- Do NOT touch `flux-system`, `kube-system`, or RBAC.
- Do NOT delete Deployments, StatefulSets, Services, or PVCs.
- Do NOT `kubectl apply` unless a file was modified.
