# Proxmox Firewall Rules

This directory defines the current Proxmox firewall policy for the managed and dev tiers, plus the OpenClaw and Nginx exceptions needed for the public-facing subdomains.

[`config.tf`](./config.tf) enables the datacenter firewall and explicitly sets the cluster policies that shape guest forwarding.

## Traffic Model

```mermaid
flowchart LR
  Local[(Local 10.0.0.10)]
  VPN[(VPN 100.87.0.43)]
  DNS[(DNS resolvers)]
  Internet[(Internet)]
  Nginx["nginx<br/>172.16.0.101"]
  K8s["k8mgd<br/>172.16.0.105"]
  OpenClaw["OpenClaw<br/>172.16.0.104"]
  ProxmoxUI["Proxmox UI<br/>172.16.0.1:8006"]
  ManagedNet["Managed tier<br/>172.16.0.100-199"]
  DevNet["Dev tier<br/>172.16.0.200-255"]

  Local -->|direct Proxmox UI 8006| ProxmoxUI
  Local -->|trusted web entry 80/443| Nginx
  VPN -->|trusted web entry 443| Nginx

  Nginx -->|mgd.conf: HTTPS 443| K8s
  Nginx -->|proxmox.conf: HTTPS 8006| ProxmoxUI
  Nginx -->|robot.conf: HTTP 18789| OpenClaw

  ManagedNet -->|DNS 53/udp + 53/tcp| DNS
  ManagedNet -->|HTTP 80/tcp| Nginx
  ManagedNet -->|HTTPS 443/tcp| Nginx
  ManagedNet -->|all other outbound allowed| Internet

  DevNet -->|DNS 53/udp + 53/tcp| DNS
  DevNet -->|HTTP 80/tcp| Nginx
  DevNet -->|HTTPS 443/tcp| Nginx
  DevNet -->|drop traffic to managed tier| ManagedNet

  OpenClaw -->|allow to Nginx any port| Nginx
  OpenClaw -->|allow to K8s any port| K8s
  OpenClaw -->|drop all other outbound| Internet
```

## Rule Summary

### `config.tf`
- Datacenter firewall is enabled.
- Datacenter input policy is `DROP`.
- Datacenter output policy is `ACCEPT`.
- Datacenter forward policy is `ACCEPT` so bridged guest traffic can leave the host.
- The node-level `inbound` firewall rule resource exists but is empty.

### `sg-managed`
- Inbound: allow SSH on `22/tcp`.
- Outbound: allow all traffic.
- Managed guests keep unrestricted egress; the Nginx backend paths now work because they are not blocked by a managed-subnet drop rule.

### `sg-dev`
- Inbound: allow SSH on `22/tcp`.
- Inbound: allow traffic to dev-tier members.
- Outbound: allow `53/udp`, `53/tcp`, `80/tcp`, and `443/tcp`.
- Outbound: drop traffic to managed-tier IPs.

### `lxc-openclaw`
- Inbound: allow SSH on `22/tcp`.
- Inbound: allow `tcp/18789` from `172.16.0.101`.
- Outbound policy is `DROP`.
- Outbound: allow any port to `172.16.0.101` and `172.16.0.105`.
- Outbound: drop everything else.

### Guest Attachments
- `lxc-nginx.tf`, `lxc-proxbridge.tf`, `vm-mgdk8.tf`, `vm-mgddocker.tf`, and `vm-mgdnfs.tf` all have `firewall = true` on the network device and attach `sg-managed`.
- `vm-mgdk8.tf` has one extra inbound allow for `172.16.0.101:443` so Nginx can reach the backend used by `nginx/conf.d/mgd.conf`.
- `lxc-openclaw.tf` enables its own firewall rules directly and uses a stricter outbound policy than the managed tier.

## Notes

- The managed tier uses `172.16.0.100-199`.
- The dev tier uses `172.16.0.200-255`.
- `ipset-mgd.tf` and `ipset-dev.tf` define the IP sets referenced by the `+dc/ipset-*` rules.
- `nginx/conf.d/mgd.conf` is the wildcard `*.trusted.nirmalhk7.com` route and proxies to `172.16.0.105:443`.
- `nginx/conf.d/proxmox.conf` proxies `proxmox.trusted.nirmalhk7.com` to `172.16.0.1:8006`.
- `nginx/conf.d/robot.conf` proxies `robot.trusted.nirmalhk7.com` to `172.16.0.104:18789`.
- `home.trusted.nirmalhk7.com` uses the wildcard `*.trusted` route in `mgd.conf`, not `local.conf`.
- `nginx/conf.d/local.conf` is a separate local default server on `80`; it is not part of the `*.trusted` routes.
- SSH on `22/tcp` is allowed inbound on every security group shown here.
