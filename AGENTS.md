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

### Traefik IngressRoutes and Homepage
- External HTTP routing for managed apps uses Traefik `IngressRoute` resources (`apiVersion: traefik.io/v1alpha1`) in the feature directory, not chart-managed `Ingress` objects. Disable chart ingress in `HelmRelease` values when a local `ingressroute.yaml` exists.
- The cluster dashboard is Homepage (`clusters/managed/default/homepage/`). It discovers services cluster-wide from annotated IngressRoutes when `kubernetes.yaml` sets `mode: cluster`, `traefik: true`, and `ingress: false` (this repo uses Traefik CRDs only; leave standard `Ingress` discovery off).
- Annotate each IngressRoute with `gethomepage.dev/*` keys so tiles appear on the dashboard. Required: `gethomepage.dev/enabled: "true"` and `gethomepage.dev/href`. Common optional keys: `group`, `name`, `description`, `icon`, `weight`, `app`, `pod-selector`, and `widget.*` for widgets. Use `gethomepage.dev/app` when the IngressRoute name does not match the workload's `app.kubernetes.io/name`. Gitea (`clusters/managed/devbench/gitea/ingressroute.yaml`) is the reference pattern.
- Homepage lists every cluster IngressRoute that has `gethomepage.dev/enabled: "true"` and does not deduplicate by `href`. An IngressRoute must exist in exactly one namespace—the feature's `mgd-*` namespace from the parent Kustomization. Copies left in other namespaces after a migration produce duplicate dashboard tiles.
- Flux `prune: true` removes only resources it reconciled. Orphaned IngressRoutes without `kustomize.toolkit.fluxcd.io/name` labels are not pruned automatically; delete them manually or they will keep showing on Homepage even when Git is correct.
- Homepage RBAC should grant `ingressroutes` on `traefik.io` only. The legacy `traefik.containo.us` API group is not installed on this cluster.

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
- **Proxmox host disk telemetry** uses privileged LXC CT 102 (`proxbridge`, `172.16.0.102`). Terraform (`infrastructure/terra/proxmox/lxc-proxbridge.tf`) only provisions the container; SMART collection and Prometheus disk exporters require `infrastructure/ansible/lxc-proxbridge.ansible.yaml`. That playbook is imported from `main.ansible.yaml` but is safe to run alone with `make ansible-run-one NOTEBOOK=lxc-proxbridge.ansible.yaml`.

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
6. If the service has a public URL, add `ingressroute.yaml` with Traefik routing and Homepage annotations (see **Traefik IngressRoutes and Homepage**). Keep the IngressRoute in the same feature directory so Kustomize assigns the correct `mgd-*` namespace.

### Provisioning Infrastructure
1. Update the relevant Terraform directory under `infrastructure/terra/`.
2. Update `infrastructure/ansible/inventory.ini` and the matching playbook or vars under `infrastructure/ansible/`.
3. Update `nginx/` if external proxying is required.
4. Treat apply and deployment commands as explicit operational steps, not routine validation.
5. For Proxmox host disk SMART data in Scrutiny, run `lxc-proxbridge.ansible.yaml` after Terraform creates or recreates CT 102. Terraform alone does not pass through host block devices or install collectors.

## Validation and Safety
- Prefer non-mutating validation first: render affected Kustomize paths, run `terraform fmt` and validation for Terraform changes where provider setup permits it, run Ansible syntax checks for changed playbooks, and run an Nginx config test on the Nginx version that will receive the files.
- The `Makefile` contains live operational targets. Do not run `make init`, `make terraform-apply*`, `make terraform-clear`, `make terraform-reset`, `make ansible-run*`, `make kubernetes-init`, `make kubernetes-clean`, `make nginx-build`, or `make sync` unless the user asked for that operation and the target environment is understood.
- Do not assume local access to Proxmox, Kubernetes, Nginx, or the OpenClaw host from repository files alone. State which validation was local and which live validation still requires the target environment.

## Operational Notes
### Homepage duplicate tiles
- Duplicate dashboard entries usually mean multiple annotated IngressRoutes share the same `gethomepage.dev/href` in different namespaces—not a Homepage config bug.
- List candidates: `kubectl get ingressroutes.traefik.io -A -o custom-columns='NS:.metadata.namespace,NAME:.metadata.name,HREF:.metadata.annotations.gethomepage\.dev/href,FLUX:.metadata.labels.kustomize\.toolkit\.fluxcd\.io/name'`.
- Confirm from Homepage: `kubectl exec -n mgd-default deploy/homepage -- wget -qO- http://127.0.0.1:3000/api/services` and look for repeated `href` values.
- Delete stale copies from wrong namespaces; keep the IngressRoute in the namespace where the app actually runs. Reconcile with `kubectl kustomize clusters/managed/<namespace>` to see which routes Git expects in each tier.

### OIDC and auth troubleshooting
- A `401` on Outline `POST /api/auth.info` before login is expected; it is not by itself evidence of misconfiguration.
- OIDC login loops after Authelia consent usually mean the app failed the server-side token exchange. Check app logs for TLS errors against `secure.trusted.nirmalhk7.com` or missing/mismatched `OIDC_CLIENT_SECRET`.
- Verify the decrypted secret in the app namespace contains every expected key (`kubectl get secret <name> -n <ns> -o jsonpath='{.data}'`) and that the pod env includes them after rollout.
- A `HelmRelease` can show `Stalled` / `UpgradeFailed` while an older ReplicaSet pod still serves traffic. After fixing the underlying issue, restart the deployment or `flux suspend helmrelease <name> -n <ns>` followed by `flux resume` if reconciliation is stuck.
- Outline admin is stored in Postgres (`users.role = admin`); there is no `ADMIN_EMAIL` env var. Map OIDC logins with `OIDC_USERNAME_CLAIM: email` when matching an existing admin user.

### Proxmox host disk telemetry (proxbridge and Scrutiny)
- **Architecture:** Proxmox block devices are not visible inside the Kubernetes cluster. CT 102 (`proxbridge`, inventory group `lxc_proxbridge`) runs on the Proxmox host with raw disk passthrough and read-only host filesystem mounts so `smartctl`, `scrutiny-collector-metrics`, `node_exporter`, and `smartctl_exporter` can read the physical drives.
- **Ansible playbook:** `infrastructure/ansible/lxc-proxbridge.ansible.yaml` has three plays:
  1. `proxmox` — pass through `/dev/sda`, `/dev/sdb`, `/dev/nvme0`; mount `/proc`, `/sys`, `/`, and `/run/udev` under `/host/*`; clear `lxc.cap.drop` so `CAP_SYS_RAWIO` is available; reboot CT 102 when those change.
  2. `lxc_proxbridge` — install collectors and a daily `scrutiny-collector.timer`.
  3. `proxmox` — remove any legacy Scrutiny collector that ran directly on the Proxmox host.
- **CT requirements:** CT 102 must stay privileged (`unprivileged: 1` must not appear in `pct config 102`). Device list and `scrutiny_host_id` (`milano`) live in the playbook vars; keep them aligned with the host hardware.
- **Scrutiny hub:** `clusters/managed/monitoring/scrutiny/` runs the Scrutiny web UI and API at `scrutiny.trusted.nirmalhk7.com`. The in-cluster embedded collector is intentionally disabled (`collector-configmap.yaml` replaces `scrutiny-collector-metrics` with a no-op). Host-disk SMART data comes only from proxbridge.
- **Collector API path:** proxbridge posts to `https://scrutiny.trusted.nirmalhk7.com` with a managed `/etc/hosts` entry pointing that hostname at nginx (`172.16.0.101`). Traffic follows `nginx/conf.d/mgd.conf` to Traefik on k8mgd, then the Scrutiny service. Do not point the collector at the in-cluster Service DNS unless nginx routing is replaced.
- **Prometheus:** `clusters/managed/monitoring/prometheus/proxbridge_scrapeconfigs.yaml` defines `ScrapeConfig` targets for `172.16.0.102:9100` (`node_exporter` disk/filesystem via `/host/*`) and `:9633` (`smartctl_exporter`).
- **SSH host key rotation:** passthrough changes reboot CT 102 and replace its SSH host key. The playbook drops the stale key from `infrastructure/ansible/.ansible_known_hosts` before reconnecting. If a run still fails with `REMOTE HOST IDENTIFICATION HAS CHANGED`, run `ssh-keygen -R 172.16.0.102 -f infrastructure/ansible/.ansible_known_hosts` and re-run the playbook.
- **Troubleshooting empty Scrutiny:** check `pct config 102` for `dev0`–`dev2` and `mp0`–`mp3`, then on proxbridge verify `systemctl status scrutiny-collector.timer node_exporter smartctl_exporter` and `/var/log/scrutiny-collector.log`. An empty dashboard with a healthy Scrutiny pod usually means the proxbridge playbook was never applied. `smartctl` checksum warnings (exit code 4) on SATA drives can still publish usable data.
