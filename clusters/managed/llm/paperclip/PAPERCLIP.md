# Paperclip AI Orchestration

## Overview
Paperclip is an AI-native agent orchestration framework that acts as the "Company Layer" for managing autonomous AI workflows. It organizes agents into a hierarchical structure and manages tasks via a ticket-based system.

## Deployment Details
- **Namespace**: `mgd-llm`
- **URL**: `https://paperclip.trusted.nirmalhk7.com`
- **Port**: `3100`
- **Storage**: 10Gi PVC mounted at `/paperclip`

## Integration with OpenClaw
Paperclip is configured to communicate with the OpenClaw Gateway at `http://172.16.0.104:18789`.

### To "Hire" OpenClaw Agents:
1. Access the Paperclip UI at `https://paperclip.trusted.nirmalhk7.com`.
2. Navigate to the **Agents** or **Hiring** section.
3. Add a new agent and select the **OpenClaw Adapter** (or use the Generic HTTP Adapter).
4. **Gateway URL**: `http://172.16.0.104:18789`
5. **Auth Token**: Use the `OPENCLAW_GATEWAY_AUTH_TOKEN` (ensure it matches the one in `paperclip-secrets`).
6. Assign a role (e.g., "Nestor", "Victor", "Rahul") and a mission.

## Secrets Management
The following secrets are managed via `secret.px.yaml`:
- `JWT_SECRET`: Used for Paperclip session authentication.
- `OPENCLAW_GATEWAY_AUTH_TOKEN`: Used to authenticate with the OpenClaw gateway.
- `POSTGRES_PASSWORD`: Password for the internal database.

To update secrets:
1. Edit `clusters/managed/llm/paperclip/secret.px.yaml`.
2. Run `make encrypt FILE=clusters/managed/llm/paperclip/secret.px.yaml`.
3. Commit and push the changes.
