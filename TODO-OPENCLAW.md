
  # OpenClaw Config Gap Plan

  ## Summary

  - Current wiring is mostly coherent: OpenClaw LXC is 172.16.0.104, Nginx proxies robot.trusted.nirmalhk7.com to :18789, Ansible
    installs pinned OpenClaw and validates openclaw/openclaw.json before replacing live config.

  - Main gaps to fix: blocked local Ollama fallback, incomplete deploy-time secret checks, non-reproducible openai-codex OAuth
    state, stale Proxmox firewall docs, and broad Kubernetes RBAC.

  - Current local checks passed: jq . openclaw/openclaw.json, terraform fmt -check infrastructure/terra/proxmox/lxc-openclaw.tf,
    Ansible syntax check, and node --test dist/tests/*.test.js with 22 passing tests.

  ## Key Changes

  - Keep local-ollama enabled and add an explicit OpenClaw firewall egress allow to 172.16.0.105:32363 before the RFC1918 drops in
    infrastructure/terra/proxmox/lxc-openclaw.tf:97, because openclaw/openclaw.json:35 references it and the Ollama service exposes
    nodePort: 32363.

  - Expand Ansible assertions in infrastructure/ansible/lxc-openclaw.ansible.yaml:284 for every enabled runtime dependency:
    OPENCLAW_CLUSTER_CA, gateway token/password, Discord main/Rahul/Victor tokens, Telegram main token, and model provider keys
    needed by enabled models.

  - Quote all scalar values in infrastructure/ansible/templates/openclaw.env.j2:7 to avoid malformed systemd env files when secrets
    contain shell-sensitive characters.

  - Add a deployment guard for openai-codex auth state or document the required manual bootstrap, because main, rahul, and victor
    use openai-codex/* primaries but Ansible does not currently provision OAuth state.

  - Add EXA_API_KEY support for the exa MCP server in openclaw/openclaw.json:698, using an x-api-key header when configured.
    Official Exa docs say no key is required, but an API key is recommended for production/rate-limit headroom:
    https://exa.ai/docs/reference/exa-mcp

  - Update infrastructure/terra/proxmox/README.md:34 so the traffic diagram matches actual OpenClaw egress policy instead of saying
    OpenClaw can reach Nginx/K8s broadly.

  - TODO: recreate or migrate `lxc-homesecurity` before shrinking the root disk from 20 GiB to 10 GiB; Proxmox does not support
    shrinking the existing container rootfs in place.

  - Review clusters/managed/kube-system/bot-openclaw/clusterrole.yaml:7: keep bounded write permissions for managed workloads only;
    isolate any future secrets or cluster-scoped mutation into a separate role.

  ## Test Plan

  - Before deploy: rerun jq, Terraform fmt -check, Ansible syntax check, and the existing equity workflow contract tests.
  - For firewall changes: run terraform plan only, confirm the new allow rule appears before RFC1918 drops, and do not apply unless
  - On the OpenClaw host after deploy: run pinned openclaw config validate --json, openclaw doctor, selected openclaw mcp show ...
    --json, kubectl auth can-i, and connectivity checks to 172.16.0.105:6443, 172.16.0.105:32363, public HTTPS, DNS, and NTP.

  - Verify Nginx path separately with the existing Nginx config test before any proxy deployment.

  ## Assumptions

  - Keep Nginx as the only inbound gateway to OpenClaw 18789.
  - Keep Discord and Telegram enabled as configured.
  - Keep local-ollama as a real fallback rather than removing it from the model list.
  - Do not invent OpenClaw config keys; every runtime config edit must pass the pinned OpenClaw CLI validator on the target host.
