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
3. **GitOps Integration**: Do not use `kubectl apply` for persistent changes; always use Git commits targeting the `clusters/` directory.
