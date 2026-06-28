# Pterodactyl Wings

## Minecraft allocations

| Game | Client port | Protocol | Kubernetes NodePort |
| --- | --- | --- | --- |
| Minecraft Java | 6901 | TCP | 30901 |
| Minecraft Bedrock | 6901 | UDP | 30902 |

Bedrock is managed by Pterodactyl Panel as the `Milano Bedrock` server. Git manages the Kubernetes service, Nginx stream proxy, and host forwarding rules that expose the Panel allocation.
