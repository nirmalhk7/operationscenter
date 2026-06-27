# Pterodactyl Wings

## Minecraft allocations

| Game | Client port | Protocol | Kubernetes NodePort |
| --- | --- | --- | --- |
| Minecraft Java | 6901 | TCP | 30901 |
| Minecraft Bedrock | 6901 | UDP | 30902 |

Bedrock currently runs as a managed sidecar in the Wings pod and stores data under `minecraft-bedrock` on the Wings PVC. Git manages the Bedrock container, Wings pod port, Kubernetes service, Nginx stream proxy, and host forwarding rules.
