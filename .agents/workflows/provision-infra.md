---
description: Provision new Proxmox infrastructure with Terraform and configure with Ansible.
---
# Workflow: Provisioning New Infrastructure

1. Define the VM or LXC resource in the relevant `.tf` file within `infrastructure/terra/`.
// turbo
2. Run `make terraform-apply` to provision the resource on Proxmox.
3. Add the resulting IP address and hostname to `infrastructure/ansible/inventory.ini`.
4. Create or update an Ansible playbook in `infrastructure/ansible/*.ansible.yaml`.
// turbo
5. Apply the configuration using `make ansible-run-one NOTEBOOK=infrastructure/ansible/<playbook>.ansible.yaml`.
6. If the service requires a reverse proxy, update the configuration in `/nginx/` on the local machine.
// turbo
7. Apply the Nginx changes to the LXC by running `make nginx-build`.
