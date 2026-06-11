# Project: Operations Center - Repository Agent Instructions

## Scope
- This file guides agents developing this repository. It does not define the identity, persona, or delegation structure of the agent editing the repo.
- `openclaw/` contains deployment assets for the OpenClaw instance. Runtime workspaces such as `openclaw/mainAgent/`, `openclaw/subAgents/*/`, and `openclaw/customAgents/*/` may contain their own `AGENTS.md`, `SOUL.md`, `TOOLS.md`, or skill files. Treat those files as deployable OpenClaw prompt artifacts and configuration data, not as repo-development overrides for Codex, unless the task is specifically to change that runtime behavior.
- When working on OpenClaw assets, read the local files that define the runtime contract before editing. Do not project OpenClaw runtime personas onto repo-development work.

## Repository Map
- `clusters/managed/` is the Flux-managed Kubernetes tree. Namespace directories aggregate feature directories with Kustomize.
- `infrastructure/terra/` holds Terraform for Proxmox and Discord resources.
- `infrastructure/ansible/` holds inventory, vars, roles, and `.ansible.yaml` playbooks for configured hosts.
- `nginx/` is the source of truth for reverse-proxy configuration copied to the Nginx host by `make nginx-build`.
- `charts/` contains local chart assets; third-party Kubernetes charts in the managed cluster are normally declared through Flux `HelmRelease` resources.
- Generated Flux manifests in `clusters/managed/flux-system/fluxcd/gotk-*.yaml` say `DO NOT EDIT`; change them only through the Flux generation/bootstrap workflow.

## Coding Standards
### Kubernetes and Flux
- Use Kustomize for managed manifests and Flux `HelmRelease` resources for third-party charts.
- Keep resources in `clusters/managed/<namespace>/<feature>/`. Feature directories should have a local `kustomization.yaml`.
- Keep managed resources reachable from `clusters/managed/kustomization.yaml`. Its label transformer supplies `milano.level: managed` to the managed tree; preserve that label when a resource, template, or generated output needs an explicit label.
- Namespace kustomizations set the `mgd-*` namespace for most features and aggregate their `_repositories`, middleware, namespace, Flux Kustomization, and feature resources. Follow the nearest namespace pattern before adding new top-level wiring.
- Prefer persistent storage via CSI drivers such as Longhorn for stateful services.
- Add Prometheus discovery such as `ServiceMonitor` when the service actually exposes metrics and nearby monitoring patterns support it.

### Shared NFS Storage
- `vm-mgdnfs1.ansible.yaml` exports the parent `/mnt/2tbhdd` tree. Managed applications use static NFS PVs that point at app-specific subdirectories such as `nextcloud`, `immich`, and `gitea`.
- PVCs are namespace-scoped. A pod cannot mount another namespace's PVC; create a separate PV/PVC in the consuming namespace or mount the NFS path through another supported mechanism.
- Treat Immich and Gitea NFS roots as application-owned storage, not general shared folders. Exposing them through Nextcloud external storage bypasses the source application's authorization and metadata model.
- When app-owned storage must be exposed to another workload, default to read-only mounts and explicitly confirm who may see the data. A read-only mount prevents writes but does not preserve the source application's access controls.

### Infrastructure
- New VM and LXC names should reflect their tier where the nearby Terraform/Ansible pattern supports it, for example `vm-mgd-*` or `lxc-dev-*`.
- Do not rename existing Terraform resource addresses or inventory identifiers only to normalize naming; that can create state moves and host churn. Match the local resource, pool, tag, and firewall conventions around the resource being changed.
- Ansible playbooks use the `.ansible.yaml` suffix.
- Keep sensitive host data in vars or environment-backed lookups instead of hardcoding it. Keep base playbooks generic and reusable.

### Nginx
- The `nginx/` directory is the reverse-proxy source of truth.
- Test proxy rule changes against the existing Nginx version before deploying them.

### OpenClaw
- Follow the OpenClaw JSON schema used by the repo and runtime validation output. Do not invent configuration keys.
- Diagnostics for the deployed OpenClaw host must come from user-provided logs or local workspace files unless the task explicitly provides another authorized path.
- Do not remove security-critical settings such as `allowFrom` without verification against the current schema or explicit user direction.

### Authelia OIDC
- Authelia at `secure.trusted.nirmalhk7.com` is the managed-cluster SSO provider. OIDC clients are declared in `clusters/managed/security/authelia/helmrelease.yaml`; client secrets live in `authelia-app-secrets` (`app-secret.px.yaml` → `make encrypt`).
- `clusters/managed/security/authelia/oidc-proxy.yaml` runs `authelia-oidc` / `authelia-oidc-proxy` in `mgd-security`. It proxies Authelia over HTTPS with `proxy_ssl_verify off` and rewrites discovery metadata so in-cluster callers use internal HTTP endpoints instead of the public issuer URL.
- **Split URL pattern (required for most apps):** keep the browser authorization redirect on the public issuer (`https://secure.trusted.nirmalhk7.com/api/oidc/authorization`), but point server-side token and userinfo calls at `http://authelia-oidc.mgd-security.svc/api/oidc/token` and `.../userinfo`. Pods that call the public HTTPS issuer directly often fail with `self-signed certificate` because Traefik presents an untrusted cert on that path. Gitea (`clusters/managed/devbench/gitea/helmrelease.yaml`) is the reference implementation; Outline uses the same split via `OIDC_AUTH_URI` plus internal `OIDC_TOKEN_URI` / `OIDC_USERINFO_URI`.
- **OIDC client secret pairing:** Authelia stores `client-secret-<app>` values as pbkdf2 hashes in `authelia-app-secrets`. The consuming app needs the matching **plaintext** secret in its own sealed secret (for example `OIDC_CLIENT_SECRET` on Outline, `N8N_SSO_OIDC_CLIENT_SECRET` on n8n). Generate a matched pair with `authelia crypto hash generate pbkdf2 --variant sha512 --random` inside the Authelia pod: put `Digest` in `app-secret.px.yaml` and `Random Password` in the app `.px.yaml`, then re-encrypt both files. A plaintext/hash mismatch breaks the OAuth callback after consent even when the browser redirect looks correct.
- When adding a client: register it in Authelia `identity_providers.oidc.clients`, add an `access_control` domain rule if needed, create the paired secrets, and wire the app `HelmRelease` to consume them. Prefer `email` (or another stable claim) for `OIDC_USERNAME_CLAIM` when the app should map logins to existing users.
- Immich is an exception: it uses public discovery and sets `NODE_TLS_REJECT_UNAUTHORIZED: "0"` until the issuer certificate is trusted. Prefer the in-cluster proxy pattern for new integrations.

## Workflows
### Sealed Secrets
1. Never commit plaintext secret payloads.
2. Create or update a local `<name>.px.yaml` raw Kubernetes `Secret` only as the input to encryption. `.gitignore` excludes `*.px.yaml`.
3. Run `make encrypt FILE=<path/to/file.px.yaml>`.
4. Commit the generated sealed `.yaml` output and the Kustomize references that consume it. Do not add the `.px.yaml` input unless the repository policy changes explicitly.
5. Set `metadata.namespace` on the `.px.yaml` input and on `spec.template.metadata` in the sealed output to the namespace where the consuming workload runs. Kustomize `namespace:` on a feature `kustomization.yaml` rewrites resource metadata, but it does **not** change `SealedSecret.spec.template.metadata.namespace`; a template pointing at the wrong namespace leaves the decrypted `Secret` in another namespace or prevents keys from syncing into the app namespace.
6. If `kubectl describe sealedsecret` reports `no key could decrypt secret`, re-encrypt with `make encrypt` (or `make encrypt_newkey` then `make encrypt_all` after controller rotation). Until the SealedSecret is `Synced: True`, dependent pods may run with missing env vars.

### Adding a Kubernetes Service
1. Create `clusters/managed/<namespace>/<service>/`.
2. Add a service-local `kustomization.yaml` that references its manifests, sealed secret output if needed, and any service-specific labels used by nearby features.
3. For third-party charts, add or reuse the namespace-local repository manifest under `_repositories` and define the service with a `HelmRelease`.
4. Add the service directory to `clusters/managed/<namespace>/kustomization.yaml`.
5. Add a new namespace directory to `clusters/managed/kustomization.yaml` only when the namespace itself is new.

### Provisioning Infrastructure
1. Update the relevant Terraform directory under `infrastructure/terra/`.
2. Update `infrastructure/ansible/inventory.ini` and the matching playbook or vars under `infrastructure/ansible/`.
3. Update `nginx/` if external proxying is required.
4. Treat apply and deployment commands as explicit operational steps, not routine validation.

## Validation and Safety
- Prefer non-mutating validation first: render affected Kustomize paths, run `terraform fmt` and validation for Terraform changes where provider setup permits it, run Ansible syntax checks for changed playbooks, and run an Nginx config test on the Nginx version that will receive the files.
- The `Makefile` contains live operational targets. Do not run `make init`, `make terraform-apply*`, `make terraform-clear`, `make terraform-reset`, `make ansible-run*`, `make kubernetes-init`, `make kubernetes-clean`, `make nginx-build`, or `make sync` unless the user asked for that operation and the target environment is understood.
- Do not assume local access to Proxmox, Kubernetes, Nginx, or the OpenClaw host from repository files alone. State which validation was local and which live validation still requires the target environment.

## Operational Notes
### OIDC and auth troubleshooting
- A `401` on Outline `POST /api/auth.info` before login is expected; it is not by itself evidence of misconfiguration.
- OIDC login loops after Authelia consent usually mean the app failed the server-side token exchange. Check app logs for TLS errors against `secure.trusted.nirmalhk7.com` or missing/mismatched `OIDC_CLIENT_SECRET`.
- Verify the decrypted secret in the app namespace contains every expected key (`kubectl get secret <name> -n <ns> -o jsonpath='{.data}'`) and that the pod env includes them after rollout.
- A `HelmRelease` can show `Stalled` / `UpgradeFailed` while an older ReplicaSet pod still serves traffic. After fixing the underlying issue, restart the deployment or `flux suspend helmrelease <name> -n <ns>` followed by `flux resume` if reconciliation is stuck.
- Outline admin is stored in Postgres (`users.role = admin`); there is no `ADMIN_EMAIL` env var. Map OIDC logins with `OIDC_USERNAME_CLAIM: email` when matching an existing admin user.
