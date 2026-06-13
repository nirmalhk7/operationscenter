# Paperclip AI Orchestration

## Overview
Paperclip is an AI-native agent orchestration framework that acts as the "Company Layer" for managing autonomous AI workflows. It organizes agents into a hierarchical structure and manages tasks via a ticket-based system.

## Deployment Details
- **Namespace**: `mgd-llm`
- **URL**: `https://paperclip.trusted.nirmalhk7.com`
- **Port**: `3100`
- **Storage**: 10Gi PVC mounted at `/paperclip`

The admin account and embedded Postgres state live on the PVC. Company and agent configuration is managed through the Paperclip UI.

## Secrets Management
Managed via `secret.px.yaml`:
- `BETTER_AUTH_SECRET`: Signs Paperclip session tokens.
- `JWT_SECRET`: Agent JWT signing material read from instance storage.
- `POSTGRES_PASSWORD`: Embedded PostgreSQL password.

To update secrets:
1. Edit `clusters/managed/llm/paperclip/secret.px.yaml`.
2. Run `make encrypt FILE=clusters/managed/llm/paperclip/secret.px.yaml`.
3. Commit the sealed `secret.yaml` output and let Flux reconcile.

## Troubleshooting
- **CrashLoop `EACCES` on `/paperclip/instances/default/.env`**: stale root-owned files on the PVC. The deployment init container re-chowns `/paperclip` to UID `1000` on every start.
- **Readiness probe 403**: Paperclip runs in authenticated mode. The probe must call `/api/health` with `Host: paperclip.trusted.nirmalhk7.com`.
- **Better Auth redirect warnings**: ensure `BETTER_AUTH_BASE_URL` and `PAPERCLIP_PUBLIC_URL` point at `https://paperclip.trusted.nirmalhk7.com`.
- **Bootstrap pending**: health reports `bootstrapStatus: bootstrap_pending` until the first admin completes onboarding in the UI.
