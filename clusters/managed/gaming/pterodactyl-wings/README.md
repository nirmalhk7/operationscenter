# Pterodactyl Wings

## Minecraft allocations

| Game | Client port | Protocol | Kubernetes NodePort |
| --- | --- | --- | --- |
| Minecraft Java | 6901 | TCP | 30901 |
| Minecraft Bedrock | 6901 | UDP | 30902 |

Bedrock is managed by Pterodactyl Panel as the `Milano Bedrock` server. Git manages the Kubernetes service, Nginx stream proxy, and host forwarding rules that expose the Panel allocation.

## Minecraft settings

`minecraft-server.properties` contains GitOps-managed `server.properties` overrides for the `Milano Bedrock` server. `minecraft-permissions.json` contains GitOps-managed Bedrock operator permissions. The Wings pod applies those settings to the server PVC before Wings starts, so changes to the generated ConfigMap roll the pod and are loaded before the server comes back online.
