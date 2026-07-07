# Project: Operations Center — Repository Agent Instructions

Instructions for AI agents editing this repository. This file does **not** define OpenClaw runtime personas; see [OpenClaw boundary](#openclaw-boundary) below.

---

## Agent orientation

### Read this first

| If the task involves… | Start here |
|---|---|
| Adding or changing a managed-cluster app | [Managed cluster layout](#managed-cluster-layout), [Adding a Kubernetes service](#adding-a-kubernetes-service), [Renovate upgradeability](#renovate-upgradeability) |
| Ingress, Homepage tiles, Traefik routing | [Traefik IngressRoutes and Homepage](#traefik-ingressroutes-and-homepage) |
| SSO / OIDC for an app | [Authelia OIDC](#authelia-oidc) |
| Secrets in Git | [Sealed Secrets](#sealed-secrets) |
| VMs, LXCs, host packages | [Infrastructure](#infrastructure), `infrastructure/ansible/vars/versions.yaml` |
| External HTTPS entry (before Traefik) | [Nginx](#nginx), `nginx/conf.d/mgd.conf` |
| Proxmox disk health / Scrutiny | [Proxmox host disk telemetry](#proxmox-host-disk-telemetry-proxbridge-and-scrutiny) |
| OpenClaw bots, prompts, skills | `openclaw/` — treat as deployable runtime config, not repo-dev defaults |

### Hard rules for agents

1. **Every Docker image declared under `clusters/managed/` must be Renovate-upgradeable.** See [Renovate upgradeability](#renovate-upgradeability) before adding or changing workloads.
2. **Do not run live operational Makefile targets** (`terraform-apply*`, `ansible-run*`, `flux-bootstrap`, `nginx-build`, `sync`, etc.) unless the user explicitly asked and the target environment is understood.
3. **Prefer non-mutating validation:** `kubectl kustomize clusters/managed/<path>`, `terraform fmt`, Ansible syntax-check, Nginx config test. Say which checks were local vs need the live environment.
4. **Never commit plaintext secrets.** Use the Sealed Secrets workflow.
5. **Do not edit** `clusters/managed/flux-system/fluxcd/gotk-*.yaml` by hand (`DO NOT EDIT` — regenerate via Flux bootstrap workflow only).

---

## Documentation map

Use the closest doc for the area you are changing; do not duplicate long runbooks into `AGENTS.md`.

| Document | Audience | Contents |
|---|---|---|
| [`README.md`](README.md) | Humans | Architecture overview, tiers, getting started |
| **`AGENTS.md`** (this file) | AI agents | Conventions, workflows, troubleshooting, Renovate policy |
| [`renovate.json`](renovate.json) | Renovate bot | Manager file patterns and package rules |
| [`nginx/README.md`](nginx/README.md) | Operators | Nginx layout (note: paths in that file may lag `nginx/` — trust the tree) |
| [`clusters/managed/devbench/gitea/README.md`](clusters/managed/devbench/gitea/README.md) | Operators | Gitea Actions runner + SonarQube onboarding |
| [`infrastructure/terra/proxmox/README.md`](infrastructure/terra/proxmox/README.md) | Operators | Proxmox Terraform |
| [`openclaw/README.md`](openclaw/README.md) | OpenClaw runtime | Separate agent fleet; not repo-development defaults |

Feature-local READMEs explain operator procedures; **`AGENTS.md` holds cross-cutting rules** agents must follow everywhere.

---

## Repository map

| Path | Role |
|---|---|
| `clusters/managed/` | Flux GitOps tree for the production managed K3s cluster |
| `clusters/dev/`, `clusters/live/` | Other tiers (lower priority than `managed`) |
| `infrastructure/terra/` | Terraform — Proxmox, Discord, etc. |
| `infrastructure/ansible/` | Inventory, vars, roles, `*.ansible.yaml` playbooks |
| `nginx/` | Reverse-proxy source of truth (`make nginx-build` syncs to Nginx LXC) |
| `charts/` | Local Helm charts referenced by Flux `HelmRelease` |
| `renovate.json` | Automated dependency updates (Flux, Kubernetes, Ansible versions) |
| `Makefile` | Operational entry points — treat as privileged |

**Traffic path (managed apps):** Client → Nginx LXC (`172.16.0.101`) → K8s node Traefik (`172.16.0.105:443`) → Traefik `IngressRoute` → Service.

---

## Managed cluster layout

### Namespace tiers

Each tier under `clusters/managed/` has a top-level kustomization wired from [`clusters/managed/kustomization.yaml`](clusters/managed/kustomization.yaml):

| Directory | K8s namespace | Apps (representative) |
|---|---|---|
| `default/` | `mgd-default` | homepage, n8n, outline, nfsprovisioner |
| `devbench/` | `mgd-devbench` | gitea, loki, sonarqube, appwrite, bugsink, tools, locust |
| `security/` | `mgd-security` | authelia, hashivault |
| `multimedia/` | `mgd-multimedia` | immich, nextcloud |
| `monitoring/` | `mgd-monitoring` | prometheus (incl. Grafana), scrutiny, kasa |
| `llm/` | `mgd-llm` | ollama, open-webui, searxng |
| `gaming/` | `mgd-gaming` | pterodactyl-panel, pterodactyl-wings |
| `kube-system/` | `kube-system` | traefik, coredns, sealed-secrets, bot-openclaw RBAC |
| `flux-system/` | `flux-system` | Flux controllers, Telegram notifications |
| `_storageclasses/` | cluster-scoped | `milano-v2` StorageClass |

Most app namespaces use the **`mgd-*` prefix**. `kube-system` and `flux-system` are exceptions.

### Feature directory pattern

```
clusters/managed/<tier>/<feature>/
  kustomization.yaml      # required
  helmrelease.yaml        # third-party apps (preferred)
  ingressroute.yaml       # external HTTP (Traefik CRD)
  deployment.yaml         # raw workloads when Helm is not used
  sealed secret *.yaml      # committed sealed output only
```

Namespace tiers aggregate:

- `_repositories/` — `HelmRepository` CRs with explicit `metadata.namespace`
- `namespace.yaml`, `flux-ks.yaml`, shared `../_middlewares`
- feature subdirectories

**Labeling:** the root managed kustomization applies `milano.level: managed`. Preserve it on resources, templates, or generated output when an explicit label is needed.

### Workload types

| Type | When to use | Renovate manager |
|---|---|---|
| Flux `HelmRelease` + in-repo `HelmRepository` | Third-party charts (default for new apps) | `flux` |
| Raw `Deployment` / `StatefulSet` | Simple single-image apps, sidecars, agents | `kubernetes` |
| Local chart via `GitRepository` | Custom packaging — images must still be in scanned YAML | `flux` (values images) + chart discipline |
| K3s `HelmChartConfig` | **Avoid for new work** — not Renovate-upgradeable | — |

---

## Renovate upgradeability

**Policy:** Any container image referenced by a deployed manifest in `clusters/managed/` must be discoverable by Renovate. Chart versions for Helm apps must be pinned and linked to an in-repo `HelmRepository` (or `registryAliases` in `renovate.json`).

Configuration: [`renovate.json`](renovate.json). Docs: [Flux manager](https://docs.renovatebot.com/modules/manager/flux/), [Kubernetes manager](https://docs.renovatebot.com/modules/manager/kubernetes/).

### Managers in this repo

| Manager | Scope | Notes |
|---|---|---|
| **`flux`** | `clusters/**/*.yaml` | `HelmRelease` chart versions; Docker images in `values` (`repository`/`tag`) |
| **`kubernetes`** | See `kubernetes.fileMatch` in `renovate.json` | Container images in matched manifest files |
| **`regex`** | `infrastructure/ansible/vars/versions.yaml` | Host packages, k3s, npm tools — `# renovate: datasource=… depName=…` comments |

Non-Kubernetes regex updates are **major-only** (minor/patch/pin/digest disabled for `regex` manager). Kubernetes `:latest` / floating tags get **pin** PRs enabled.

### HelmRelease (flux) checklist

1. **Pin** `spec.chart.spec.version` (not open ranges like `>=1.0.0 <2.0.0`).
2. Define **`HelmRepository`** in the tier's `_repositories/` with **`metadata.namespace`** set (Kustomize `namespace:` on the parent does **not** substitute for Renovate linking).
3. Set **`metadata.namespace`** on the `HelmRelease` **or** `spec.chart.spec.sourceRef.namespace`.
4. Put overridable app images in **`values`** using standard keys:

   ```yaml
   values:
     image:
       repository: org/app
       tag: "1.2.3"
   ```

   Reference: [`clusters/managed/devbench/locust/helmrelease.yaml`](clusters/managed/devbench/locust/helmrelease.yaml), [`clusters/managed/multimedia/immich/helmrelease.yaml`](clusters/managed/multimedia/immich/helmrelease.yaml).

5. If `HelmRepository` lives outside Git, add `flux.registryAliases` in `renovate.json`.

**GitRepository + local chart:** Flux does not bump a chart version field. Pin **all images in `HelmRelease` values**; chart templates must read from values — never hardcode `image:` strings in `charts/*/templates/`.

### Raw Kubernetes (kubernetes) checklist

Manifests must match a pattern in `renovate.json` → `kubernetes.fileMatch`:

| Pattern | Examples |
|---|---|
| `clusters/.+/.*deployment\.yaml$` | Most app Deployments |
| `clusters/.+/.*statefulset\.yaml$` | StatefulSets |
| `clusters/.+/.*cronjob\.yaml$` | Outline backup |
| `clusters/managed/kube-system/sealedsecrets/controller\.yaml$` | Sealed Secrets controller |
| `clusters/managed/security/authelia/oidc-proxy\.yaml$` | Authelia OIDC proxy (multi-doc file) |
| `clusters/managed/flux-system/fluxcd/gotk-components.yaml` | Flux controllers |

**Filename conventions matter.** A Deployment in `oidc-proxy.yaml` or `agent-deploy.yaml` is invisible to Renovate unless the path is listed above or the file is renamed to `*deployment.yaml`.

Optional `# renovate: depName=…` comments help non-standard image names; Renovate still extracts many images without them.

### Traefik (kube-system)

Traefik is a **Flux `HelmRelease`**, not K3s-bundled Helm:

- [`clusters/managed/kube-system/traefik/helmrelease.yaml`](clusters/managed/kube-system/traefik/helmrelease.yaml) — pinned chart `40.1.3`, image `rancher/mirrored-library-traefik:3.7.4`, hostPort 80/443
- [`clusters/managed/kube-system/traefik/helmrepository.yaml`](clusters/managed/kube-system/traefik/helmrepository.yaml)
- K3s bundled Traefik is **disabled** in [`infrastructure/ansible/vm-k8mgd.ansible.yaml`](infrastructure/ansible/vm-k8mgd.ansible.yaml) (`disable: traefik`)

Changing Traefik requires both Git (Flux) and, on first migration, Ansible on the K8s node so bundled Traefik does not conflict with the Flux release.

### Before merging a new managed app

- [ ] Every container image is in a Renovate-scanned file (flux values or kubernetes fileMatch).
- [ ] Helm chart version is pinned and `HelmRepository` has `metadata.namespace`.
- [ ] No hardcoded image strings in local chart templates without a values override in `HelmRelease`.
- [ ] `kubectl kustomize clusters/managed/<tier>` renders cleanly.
- [ ] Feature is listed in the tier's `kustomization.yaml` (unwired dirs are dead code).

---

## Coding standards

### Kubernetes and Flux

- Use Kustomize for managed manifests and Flux `HelmRelease` for third-party charts.
- Keep resources in `clusters/managed/<tier>/<feature>/` with a local `kustomization.yaml`.
- Keep the tree reachable from [`clusters/managed/kustomization.yaml`](clusters/managed/kustomization.yaml).
- Prefer persistent storage via CSI (e.g. Longhorn `milano-v2`) for stateful services.
- Add `ServiceMonitor` when the service exposes Prometheus metrics and nearby features already use that pattern.

### Traefik IngressRoutes and Homepage

- External HTTP uses Traefik **`IngressRoute`** (`apiVersion: traefik.io/v1alpha1`) in the feature directory — not chart-managed `Ingress`. Disable chart ingress in `HelmRelease` values when a local `ingressroute.yaml` exists.
- **Homepage** ([`clusters/managed/default/homepage/`](clusters/managed/default/homepage/)) discovers services from annotated IngressRoutes when `kubernetes.yaml` sets `mode: cluster`, `traefik: true`, `ingress: false`.
- **Required annotations:** `gethomepage.dev/enabled: "true"`, `gethomepage.dev/href`. Common optional: `group`, `name`, `description`, `icon`, `weight`, `app`, `pod-selector`, `widget.*`. Use `gethomepage.dev/app` when the IngressRoute name ≠ `app.kubernetes.io/name`. Reference: [`clusters/managed/devbench/gitea/ingressroute.yaml`](clusters/managed/devbench/gitea/ingressroute.yaml).
- **One IngressRoute per public URL per namespace.** Homepage does not dedupe by `href`; stale copies in wrong namespaces cause duplicate tiles.
- Flux `prune: true` only removes reconciled resources. Orphan IngressRoutes without `kustomize.toolkit.fluxcd.io/name` labels must be deleted manually.
- Homepage RBAC: `ingressroutes` on `traefik.io` only (not legacy `traefik.containo.us`).

### Shared NFS storage

- `vm-mgdnfs1.ansible.yaml` exports `/mnt/2tbhdd`. Apps use static NFS PVs pointing at subdirs (`nextcloud`, `immich`, `gitea`, …).
- PVCs are namespace-scoped — no cross-namespace PVC mounts.
- Immich and Gitea NFS roots are **application-owned**; do not expose via Nextcloud external storage without explicit authorization review.
- Read-only cross-mounts prevent writes but not source-app ACL semantics.

### Infrastructure

- New VM/LXC names should reflect tier where patterns support it (`vm-mgd-*`, `lxc-dev-*`).
- Do not rename Terraform resource addresses or inventory IDs for cosmetic normalization (state moves / host churn).
- Ansible playbooks use the `.ansible.yaml` suffix.
- Keep sensitive data in vars or env lookups; keep playbooks reusable.
- **Proxmox disk telemetry:** privileged LXC CT 102 (`proxbridge`, `172.16.0.102`). Terraform only provisions the container; collectors require [`infrastructure/ansible/lxc-proxbridge.ansible.yaml`](infrastructure/ansible/lxc-proxbridge.ansible.yaml) (runnable alone via `make ansible-run-one NOTEBOOK=lxc-proxbridge.ansible.yaml`).

### Nginx

- `nginx/` is the reverse-proxy source of truth. Managed HTTPS vhosts proxy to `172.16.0.105:443` ([`nginx/conf.d/mgd.conf`](nginx/conf.d/mgd.conf)).
- Test config against the Nginx version that will receive the files before deploy.

### OpenClaw boundary

- `openclaw/` holds deployment assets for the OpenClaw instance. Subdirs (`mainAgent/`, `subAgents/*/`, `customAgents/*/`) may contain their own `AGENTS.md`, `SOUL.md`, `TOOLS.md`, or skills — **deployable prompt artifacts**, not overrides for repo-development agents unless the task is explicitly to change runtime behavior.
- Follow the OpenClaw JSON schema; do not invent keys.
- Do not remove security-critical settings (e.g. `allowFrom`) without schema verification or explicit user direction.

### Authelia OIDC

- SSO provider: `secure.trusted.nirmalhk7.com`. Clients in [`clusters/managed/security/authelia/helmrelease.yaml`](clusters/managed/security/authelia/helmrelease.yaml); hashed secrets in `authelia-app-secrets` (`app-secret.px.yaml` → `make encrypt`).
- [`clusters/managed/security/authelia/oidc-proxy.yaml`](clusters/managed/security/authelia/oidc-proxy.yaml) — in-cluster OIDC proxy rewrites discovery so backends use internal HTTP token/userinfo endpoints.
- **Split URL pattern (most apps):** browser → public `https://secure.trusted.nirmalhk7.com/api/oidc/authorization`; server-side token/userinfo → `http://authelia-oidc.mgd-security.svc/api/oidc/{token,userinfo}`. Reference: Gitea [`helmrelease.yaml`](clusters/managed/devbench/gitea/helmrelease.yaml), Outline env vars.
- **Secret pairing:** Authelia stores pbkdf2 **hashes**; apps need matching **plaintext** in their sealed secrets. Generate with `authelia crypto hash generate pbkdf2 --variant sha512 --random` inside the Authelia pod.
- **Immich exception:** public discovery + `NODE_TLS_REJECT_UNAUTHORIZED: "0"`. Prefer the in-cluster proxy pattern for new integrations.

---

## Workflows

### Sealed Secrets

1. Never commit plaintext secret payloads.
2. Create/update local `<name>.px.yaml` (gitignored). Run `make encrypt FILE=<path>`.
3. Commit sealed `.yaml` + kustomization references only.
4. Set `metadata.namespace` on the `.px.yaml` **and** `spec.template.metadata.namespace` in the sealed output to the **consuming workload namespace**. Parent Kustomize `namespace:` does not rewrite SealedSecret template namespace.
5. If `no key could decrypt secret`, re-encrypt (`make encrypt` or rotation workflow). Until `Synced: True`, pods may lack env vars.

### Adding a Kubernetes service

1. Create `clusters/managed/<tier>/<feature>/` with `kustomization.yaml`.
2. Choose workload type (HelmRelease preferred). Wire `_repositories` if new chart source.
3. **Verify Renovate upgradeability** ([checklist above](#before-merging-a-new-managed-app)).
4. Add feature to `clusters/managed/<tier>/kustomization.yaml`; add new tier to root `kustomization.yaml` only when the namespace is new.
5. Public URL → `ingressroute.yaml` + Homepage annotations in the same feature dir.
6. Validate: `kubectl kustomize clusters/managed/<tier>`.

### Provisioning infrastructure

1. Terraform under `infrastructure/terra/`.
2. Ansible inventory + playbook/vars.
3. `nginx/` if external proxying changes.
4. Apply commands are explicit ops — not routine agent validation.
5. After (re)creating proxbridge CT 102, run `lxc-proxbridge.ansible.yaml` for SMART collectors.

---

## Validation and safety

- Non-mutating first: Kustomize render, `terraform fmt`, Ansible syntax-check, Nginx `-t`.
- Do not assume live access to Proxmox, K8s, Nginx, or OpenClaw from files alone.
- State which validation ran locally vs what still needs the target environment.

---

## Operational notes

### Homepage duplicate tiles

- Usually duplicate `gethomepage.dev/href` on IngressRoutes in **different namespaces**.
- List: `kubectl get ingressroutes.traefik.io -A -o custom-columns='NS:.metadata.namespace,NAME:.metadata.name,HREF:.metadata.annotations.gethomepage\.dev/href,FLUX:.metadata.labels.kustomize\.toolkit\.fluxcd\.io/name'`.
- Confirm: `kubectl exec -n mgd-default deploy/homepage -- wget -qO- http://127.0.0.1:3000/api/services`.
- Delete stale copies; reconcile with `kubectl kustomize clusters/managed/<tier>`.

### OIDC and auth troubleshooting

- Outline `401` on `POST /api/auth.info` before login is expected.
- Login loops after Authelia consent → failed server-side token exchange (TLS to public issuer, or `OIDC_CLIENT_SECRET` mismatch).
- Verify decrypted secret keys and pod env after rollout.
- `HelmRelease` `Stalled` may still serve traffic from an old ReplicaSet — restart deployment or `flux suspend` / `flux resume`.
- Outline admin = Postgres `users.role = admin`; use `OIDC_USERNAME_CLAIM: email` to match existing users.

### Proxmox host disk telemetry (proxbridge and Scrutiny)

- **Architecture:** Proxmox block devices are not visible inside K8s. CT 102 (`proxbridge`, `172.16.0.102`) runs on the Proxmox host with disk passthrough and `/host/*` mounts for `smartctl`, Scrutiny collector, `node_exporter`, `smartctl_exporter`.
- **Ansible:** [`lxc-proxbridge.ansible.yaml`](infrastructure/ansible/lxc-proxbridge.ansible.yaml) — (1) Proxmox device/mp setup + reboot, (2) collector install on CT, (3) remove legacy host collector.
- **CT 102** must stay **privileged** (`unprivileged: 1` must not appear in `pct config 102`).
- **Scrutiny hub:** [`clusters/managed/monitoring/scrutiny/`](clusters/managed/monitoring/scrutiny/) — in-cluster collector disabled; host SMART data from proxbridge only.
- **Collector path:** proxbridge → `https://scrutiny.trusted.nirmalhk7.com` via `/etc/hosts` → nginx → Traefik → Scrutiny Service.
- **Prometheus:** [`proxbridge_scrapeconfigs.yaml`](clusters/managed/monitoring/prometheus/proxbridge_scrapeconfigs.yaml) — `172.16.0.102:9100`, `:9633`.
- **SSH host key rotation:** passthrough changes reboot CT 102. Clear stale keys in `infrastructure/ansible/.ansible_known_hosts` if needed.
- **Empty Scrutiny dashboard:** verify `pct config 102` devices/mounts, then `systemctl status scrutiny-collector.timer node_exporter smartctl_exporter` and `/var/log/scrutiny-collector.log` on proxbridge.

---

## Reference implementations

| Pattern | Reference path |
|---|---|
| IngressRoute + Homepage annotations | `clusters/managed/devbench/gitea/ingressroute.yaml` |
| OIDC split URLs | `clusters/managed/devbench/gitea/helmrelease.yaml`, `clusters/managed/default/outline/` |
| HelmRelease + `_repositories` | `clusters/managed/default/n8n/helmrelease.yaml` + `default/_repositories/` |
| Helm values image overrides | `clusters/managed/devbench/locust/helmrelease.yaml`, `clusters/managed/multimedia/immich/helmrelease.yaml` |
| Raw Deployment + `# renovate: depName` | `clusters/managed/devbench/tools/deployment.yaml` |
| Flux-managed Traefik | `clusters/managed/kube-system/traefik/` |
| Gitea Actions + SonarQube | `clusters/managed/devbench/gitea/README.md` |
