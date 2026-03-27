# Project: Operations Center - Agent Instructions

## ✍️ Coding Standards & Conventions
- **Kubernetes (K8s) Standards**:
    - **Labels**: Every managed resource must include `milano.level: managed`.
    - **Tooling**: Use **Kustomize** for manifests and **HelmRelease** for 3rd party charts.
    - **Structure**: Always organize resources into sub-directories by namespace/feature within `clusters/managed/`.
- **Infrastructure (Terraform/Ansible)**:
    - **Resource Naming**: LXCs and VMs must be prefixed by their tier (`vm-mgd-...`, `lxc-dev-...`).
    - **Ansible Files**: Playbooks should follow the `.ansible.yaml` suffix.
    - **Variables**: Reference sensitive host data via `vars/` and ensure base configurations are generic and reusable.
- **Nginx Configs**:
    - The `/nginx` directory is the source of truth.
    - Configurations must be tested against the existing Nginx version when updating proxy rules.

## 🚀 Workflows & Procedures
### Secret Protocol (SealedSecrets)
1. **NEVER** commit plaintext secrets.
2. Create a `<name>.px.yaml` file with the raw K8s Secret.
3. Run `make encrypt FILE=<path/to/file.px.yaml>`.
4. Commit both the `.px.yaml` (ensure it's gitignored if required, though here they are treated as source for encryption) and the resulting `.yaml` (SealedSecret).
   *Note: In this repository, `.px.yaml` files are encrypted via kubeseal to produce safe `.yaml` files.*

### Adding a New Kubernetes Service
1. Create a workspace in `/clusters/managed/<namespace>/<servicename>`.
2. Define a `kustomization.yaml` referencing all local manifests.
3. If secrets are needed, follow the **Secret Protocol** above.
4. Add the service path to the root `clusters/managed/kustomization.yaml`.
5. FluxCD will reconcile on the next sync interval.

### Provisioning New Infrastructure
1. Update `infrastructure/terra/` with the new VM/LXC definition.
2. Run `make terraform-apply`.
3. Update `infrastructure/ansible/inventory.ini` with the new IP/Hostname.
4. Apply the configuration using `make ansible-run-one NOTEBOOK=<path>`.
5. Update `/nginx` if external access is required and run `make nginx-build`.

## 🛠️ General Guidelines
1. **Resiliency**: Prefer persistent storage via CSI drivers (e.g., Longhorn) for stateful applications.
2. **Observability**: New services should include `ServiceMonitor` resources for Prometheus discovery.

## 🤖 AI Workforce
The Operations Center is managed by a specialized team of AI agents, coordinated by **Nestor (Chief of Staff)**.

### 📈 Core Trading Agents
- **David (US Equity Trader)**: Simulates live trades (Alpaca/Finnhub); intraday specialist.
- **Motabhai (Indian Equity Trader)**: Simulates NSE/BSE trades (Zerodha/nse-api); Indian market expert.
- **Victor (Trading Orchestrator)**: Routes tasks and aggregates PnL reports via A2A protocol.

### 🏗️ Infrastructure Agents
- **Rahul (Cluster Manager)**: Monitors K8s/Proxmox and proactively fixes YAML manifests via PRs.
- **Alexa (Obsidian Manager)**: Archivist; reads/writes vault data via Obsidian CLI and logs trades.
- **Taylor (Writer Agent)**: Content creator; drafts blogs based on technical hurdles from Rahul.

### 💡 Idea Refinement Agents
- **Max (Idea Suggestor)**: Generates trend-aware tech startup ideas.
- **Riley (Flaw Finder)**: Performs rigorous critiques and iterates ideas until bulletproof.

### 🏛️ Coordination
### 🏛️ Coordination
- **Nestor (Chief of Staff)**: The primary bot identity and overarching authority.
    - **Persona**: Executive, refined, and authoritative. 
    - **Role**: Coordinates all other agents, manages strategic alignment, and acts as the final arbiter for all system-wide decisions.
    - **Protocol**: Regularly audits agent logs, delegates complex tasks to leads (Victor/Rahul), and ensures all changes comply with project standards.
