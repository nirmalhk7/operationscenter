# Paperclip AI Orchestration

## Overview
Paperclip is an AI-native agent orchestration framework that acts as the "Company Layer" for managing autonomous AI workflows. It organizes agents into a hierarchical structure and manages tasks via a ticket-based system.

## Deployment Details
- **Namespace**: `mgd-llm`
- **URL**: `https://paperclip.trusted.nirmalhk7.com`
- **Port**: `3100`
- **Storage**: 10Gi PVC mounted at `/paperclip`

## GitOps company package

Bootstrap in the UI creates the admin account and initial company row on the PVC. Agent definitions are GitOps-managed from:

`clusters/managed/llm/paperclip/company/operations-center/`

- `paperclip.manifest.json` — company metadata and OpenClaw agent adapters
- `COMPANY.md` — company goal and description
- `agents/*/AGENT.md` — per-agent instructions

A `paperclip-company-import` CronJob reconciles that package into the live company every 6 hours (and on the next scheduled run after Flux applies changes). To import immediately after editing the package:

```bash
kubectl -n mgd-llm create job --from=cronjob/paperclip-company-import paperclip-company-import-$(date +%s)
```

### One-time setup after bootstrap

1. In Paperclip, open **Settings -> API keys** and create a board API key.
2. Put it in `secret.px.yaml` as `PAPERCLIP_API_KEY`.
3. Re-encrypt: `make encrypt FILE=clusters/managed/llm/paperclip/secret.px.yaml`
4. Commit and let Flux reconcile, or trigger the import job manually.

`PAPERCLIP_COMPANY_ID` in `configmap.yaml` must match the company UUID from the Paperclip URL after bootstrap (`e0043b96-f425-425d-8fcf-b1d72a020994` for the current instance).

The admin account and embedded Postgres state remain on the PVC; GitOps covers company/agent configuration, not auth users.

## Integration with OpenClaw
Paperclip runs on `k8mgd` (`172.16.0.105`) and reaches the OpenClaw gateway on the OpenClaw LXC host at `ws://172.16.0.104:18789`.

The Proxmox firewall must allow `k8mgd -> openclaw:18789` (`infrastructure/terra/proxmox/lxc-openclaw.tf`). Apply that Terraform change before expecting Paperclip agents to connect. Routing through Nginx is not viable for server-side WebSocket clients because `robot.trusted.nirmalhk7.com` bot filtering blocks non-browser traffic.

The gateway token must match `OPENCLAW_GATEWAY_AUTH_TOKEN` on both sides:
- OpenClaw host: `infrastructure/ansible/.env` → deployed to `/root/.openclaw/.env`
- Paperclip: `clusters/managed/llm/paperclip/secret.px.yaml` → sealed as `paperclip-secrets`

After changing either token, re-encrypt Paperclip secrets with `make encrypt FILE=clusters/managed/llm/paperclip/secret.px.yaml` and redeploy OpenClaw with Ansible so the gateway picks up the new value.

### Hire OpenClaw agents
1. Open `https://paperclip.trusted.nirmalhk7.com` and complete admin onboarding if prompted.
2. Create or open a company, then add an agent through the OpenClaw invite flow (the UI may label `openclaw_gateway` as "Coming soon"; the invite path is the supported entry point).
3. Use this adapter configuration when wiring agents manually or via API:

```json
{
  "adapterType": "openclaw_gateway",
  "adapterConfig": {
    "url": "ws://172.16.0.104:18789",
    "headers": {
      "x-openclaw-token": {
        "type": "secret_ref",
        "secretId": "openclaw-gateway-token",
        "version": "latest"
      }
    },
    "autoPairOnFirstConnect": true,
    "sessionKeyStrategy": "issue",
    "timeoutSec": 300,
    "waitTimeoutMs": 60000
  }
}
```

4. Map each Paperclip agent role to an OpenClaw agent ID from `openclaw/openclaw.json`, for example:
   - `main` — operations coordinator
   - `rahul` — infrastructure / Flux
   - `victor` — MountainValue research lead
   - `eq_quantsieve`, `eq_eventhound`, `eq_riskskeptic`, `eq_thesis_depth_reviewer` — equity subagents

5. On first connect, approve device pairing inside OpenClaw if `autoPairOnFirstConnect` cannot complete automatically:
   ```bash
   openclaw devices list --json --url ws://127.0.0.1:18789
   openclaw devices approve --latest --json --url ws://127.0.0.1:18789
   ```

6. Assign a smoke task (for example, "post comment OK and mark done") and confirm the issue reaches `done`.

## Secrets Management
Managed via `secret.px.yaml`:
- `BETTER_AUTH_SECRET`: Signs Paperclip session tokens.
- `JWT_SECRET`: Agent JWT signing material read from instance storage.
- `OPENCLAW_GATEWAY_AUTH_TOKEN`: Must match the OpenClaw gateway token.
- `POSTGRES_PASSWORD`: Embedded PostgreSQL password.

To update secrets:
1. Edit `clusters/managed/llm/paperclip/secret.px.yaml`.
2. Run `make encrypt FILE=clusters/managed/llm/paperclip/secret.px.yaml`.
3. Commit the sealed `secret.yaml` output and let Flux reconcile.

## Troubleshooting
- **CrashLoop `EACCES` on `/paperclip/instances/default/.env`**: stale root-owned files on the PVC. The deployment init container re-chowns `/paperclip` to UID `1000` on every start.
- **Readiness probe 403**: Paperclip runs in authenticated mode. The probe must call `/api/health` with `Host: paperclip.trusted.nirmalhk7.com`.
- **Better Auth redirect warnings**: ensure `BETTER_AUTH_BASE_URL` and `PAPERCLIP_PUBLIC_URL` point at `https://paperclip.trusted.nirmalhk7.com`.
- **OpenClaw pairing loops**: token mismatch or pending device approval. Verify decrypted `paperclip-secrets` contains a 48-character gateway token, not the placeholder `your-openclaw-token-here`.
- **Gateway unreachable from the pod**: confirm the `k8mgd -> openclaw:18789` firewall rule is applied, then test from a pod with `nc -zvw3 172.16.0.104 18789`.
- **Bootstrap pending**: health reports `bootstrapStatus: bootstrap_pending` until the first admin completes onboarding in the UI.
