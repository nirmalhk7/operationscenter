# Proxmox Firewall Reintroduction Plan

## Summary

Reintroduce Proxmox firewall enforcement one layer at a time while preserving the now-working Nginx outbound path. Each phase should be applied, followed by a Proxmox firewall restart and the same connectivity checks before moving forward.

Known-good recovery baseline:

- Host NAT and forwarding are handled by `infrastructure/assets/iptables-up.sh`.
- Nginx at `172.16.0.101` can reach the internet when Proxmox guest firewall enforcement is disabled.
- Datacenter and node firewall layers can be tested independently from guest firewall layers.

## Phase Plan

### Phase 1: Datacenter Firewall

- Enable only the datacenter firewall in `infrastructure/terra/proxmox/config.tf`.
- Keep `forward_policy = "ACCEPT"` and `output_policy = "ACCEPT"`.
- Keep node firewall and all guest firewall options disabled.
- Gate: Nginx can still run `curl --max-time 10 -kv https://1.1.1.1`.

### Phase 2: Node Firewall

- Add node-level inbound ACCEPT rules before enabling the node firewall.
- Allow trusted management sources:
  - `10.0.0.0/24`
  - `172.16.0.0/24`
  - `100.64.0.0/10`
- Enable `proxmox_virtual_environment_node_firewall.options`.
- Keep all guest firewall options and guest NIC firewall flags disabled.
- Gate: Proxmox UI/SSH remain reachable and Nginx outbound still works.

### Phase 3: Managed Guest Firewalls, Permissive

- Re-enable NIC firewall flags for managed guests only:
  - Nginx
  - proxbridge
  - k8mgd
  - k8docker
  - mgdnfs
- Re-enable their guest firewall options with `input_policy = "ACCEPT"` and `output_policy = "ACCEPT"`.
- Keep OpenClaw disabled for the final lock-down phase.
- Gate: Nginx outbound works and trusted Nginx routes still resolve.

### Phase 4: Managed Guest Inbound Tightening

- Change managed guest input policy from `ACCEPT` to `DROP` only after required inbound rules are explicit.
- Keep managed outbound unrestricted.
- Preserve required paths:
  - SSH to managed guests.
  - Nginx inbound `80/tcp`, `443/tcp`, and `6901/tcp`.
  - Nginx to k8mgd `443/tcp`.
  - Required NFS and Kubernetes management paths if still used.
- Gate: Nginx outbound and trusted routes still work.

### Phase 5: Dev Isolation

- Restore dev-to-managed isolation in `sg-dev`.
- Reintroduce the outbound DROP from `+dc/ipset-dev` to `+dc/ipset-mgd`.
- Keep general dev internet egress open.
- Gate: representative dev guest can reach the internet but cannot reach managed-tier destinations.

### Phase 6: OpenClaw Lockdown

- Re-enable OpenClaw NIC firewall and guest firewall options.
- Set OpenClaw input policy to `DROP`.
- Set OpenClaw output policy to `DROP`.
- Preserve explicit allows:
  - SSH inbound.
  - Nginx to OpenClaw robot service on `18789/tcp`.
  - OpenClaw egress to Nginx.
  - OpenClaw egress to k8mgd.
- Gate: `https://robot.trusted.nirmalhk7.com` works and OpenClaw has no general internet egress.

## Validation After Every Phase

Run local checks before applying:

```bash
cd infrastructure/terra/proxmox
terraform fmt -check
```

Apply only the intended phase:

```bash
make terraform-apply
```

Refresh Proxmox firewall state on `milano`:

```bash
pve-firewall restart
pve-firewall status
```

Test from `nginx`:

```bash
curl --max-time 10 -kv https://1.1.1.1
```

Test trusted routes:

```bash
curl --max-time 10 -kv https://home.trusted.nirmalhk7.com
curl --max-time 10 -kv https://robot.trusted.nirmalhk7.com
curl --max-time 10 -kv https://proxmox.trusted.nirmalhk7.com
```

## Rollback Rule

If a phase breaks Nginx outbound or trusted route access:

- Revert only that phase's Terraform changes.
- Run `make terraform-apply`.
- Run `pve-firewall restart` on `milano`.
- Re-test Nginx outbound before attempting the next phase.

Do not restart the Nginx guest as a first response. Guest outbound failures in this recovery path have been tied to Proxmox firewall state or host routing/NAT state, not the Nginx process.
