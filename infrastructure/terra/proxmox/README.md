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
  Nginx["private nginx<br/>172.16.0.101"]
  LiveNginx["live-nginx<br/>172.16.0.108"]
  K8s["k8mgd<br/>172.16.0.105"]
  OpenClaw["OpenClaw<br/>172.16.0.104"]
  ProxmoxUI["Proxmox UI<br/>172.16.0.1:8006"]
  ManagedNet["Managed tier<br/>172.16.0.100-199"]
  DevNet["Dev tier<br/>172.16.0.200-255"]
  Proxbridge["proxbridge<br/>172.16.0.102"]

  Local -->|direct Proxmox UI 8006| ProxmoxUI
  Local -->|trusted web entry 80/443| Nginx
  VPN -->|trusted web entry 443| Nginx
  LiveNginx -->|livepublic 8443| K8s

  Nginx -->|mgd.conf: HTTPS 443| K8s
  Nginx -->|proxmox.conf: HTTPS 8006| ProxmoxUI
  Nginx -->|robot.conf: HTTP 18789| OpenClaw
  Proxbridge -->|Scrutiny collector HTTPS| Nginx

  ManagedNet -->|TCP 53/80/443 + UDP 53| Internet
  DevNet -->|all outbound allowed| Internet
  DevNet -.->|blocked by sg-dev| ManagedNet

  OpenClaw -->|allow to Nginx any port| Nginx
  OpenClaw -->|allow to K8s any port| K8s
  OpenClaw -->|HTTP/HTTPS/DNS + Discord UDP| Internet
```

## Rule Summary

### `config.tf`
- Datacenter firewall is enabled.
- Datacenter input policy is `DROP`.
- Datacenter output policy is `ACCEPT`.
- Datacenter forward policy is `ACCEPT` so bridged guest traffic can leave the host.
- Node firewall is enabled with inbound allows for local LAN, managed bridge, and Tailscale ranges.
- Node firewall drop logging is set to `info` for inbound, outbound, and forwarded traffic.

### `sg-managed`
- Inbound: allow SSH on `22/tcp`.
- Inbound ICMP follows every permitted TCP ingress source; managed-to-managed rules allow ICMP as part of their all-protocol service access.
- Inbound and outbound: allow all traffic within `+dc/ipset-mgd`.
- Outbound: block `8.8.8.8` and private/CGNAT destinations, then allow TCP `53,80,443` and UDP `53` to the public Internet.

### `sg-homesecurity-lan`
- Attached only to HomeSecurity.
- Inbound and outbound: allow every protocol and port for `10.0.0.0/24`.

### `lxc-nginx`
- Inbound: allow SSH on `22/tcp` through `sg-managed`.
- Inbound: allow public proxy ports `80/tcp`, `443/tcp`, robot stream proxy `6901/tcp`, and database stream proxy `3306/tcp`, `5432/tcp`, `27017/tcp`.
- Nginx network device has `firewall = true` so its guest firewall rules are enforced.
- Outbound policy is `DROP`; the managed group allows TCP `53,80,443` and UDP `53`, preserving certbot DNS-01 renewal, package repository access, and GitHub downloads used by the private Nginx Ansible workflow.
- Runtime proxy traffic goes to private backends: `172.16.0.105:443`, `172.16.0.105:31216`, `172.16.0.106:3306`, `172.16.0.106:5432`, `172.16.0.106:27017`, `172.16.0.1:8006`, and `172.16.0.104:18789`.

### `lxc-live-nginx`
- CT 108 at `172.16.0.108` is a smaller dedicated public Appwrite ingress LXC.
- It runs only `cloudflared`, a loopback-only Nginx listener, and the Nginx Prometheus exporter.
- Inbound: allow TCP `22,53,80,443`, UDP `53`, and TCP `9113` only from k8mgd; ICMP follows those same permitted sources.
- Outbound policy is `DROP`: only `172.16.0.105:8443`, public TCP `53,80,443`, DNS, and Cloudflare Tunnel `7844/tcp+udp` are allowed. `8.8.8.8`, RFC1918, link-local, and CGNAT/Tailscale destinations are explicitly dropped.

### `sg-dev`
- Inbound: allow SSH on `22/tcp`.
- Inbound: allow traffic to dev-tier members.
- Outbound: drop traffic from `+dc/ipset-dev` to `+dc/ipset-mgd` and log it at `info`.
- Outbound: allow all other traffic.

### `lxc-openclaw`
- Inbound: allow SSH on `22/tcp`.
- Inbound: allow `tcp/18789` from `172.16.0.101`.
- Inbound: allow UDP from any source on every port, ICMP from the same sources as permitted TCP ingress, and TCP `9100` from k8mgd for Prometheus.
- OpenClaw network device has `firewall = true` so its guest firewall rules are enforced.
- Outbound policy is `DROP`.
- Outbound: allow SSH reply traffic with `tcp/sport 22` so inbound SSH can complete the banner and session after the initial connection.
- Outbound: allow `172.16.0.105:6443` and ICMP to the same destination, drop `8.8.8.8` including ICMP, drop RFC1918 and CGNAT/Tailscale ranges with `info` logging, then allow public `53/tcp`, `80/tcp`, `443/tcp`, UDP `53`, and UDP `1024:65535` for Discord voice RTP media.

### Guest Attachments
- All managed guest network devices have `firewall = true`.
- Managed guest firewall option resources have `enabled = true`, input policy set to `DROP`, and drop logging set to `info`.
- Managed inbound access is explicit: SSH through `sg-managed`, Nginx `80/tcp`, `443/tcp`, `6901/tcp`, `3306/tcp`, `5432/tcp`, `27017/tcp`, k8mgd `6443/tcp`, Nginx to k8mgd `443/tcp`, and mgdnfs `2049/tcp`, `111/tcp`, `111/udp`, plus ICMP from `172.16.0.105` for reachability checks. The NFS rules are now scoped to `172.16.0.105`.
- `vm-mgdk8.tf` has one extra inbound allow for `172.16.0.101:443` so Nginx can reach the backend used by `nginx/conf.d/mgd.conf`.
- `vm-mgddocker.tf` allows `3306/tcp`, `5432/tcp`, and `27017/tcp` from `172.16.0.101` (nginx stream proxy) and `172.16.0.105` (in-cluster apps) only.
- All managed guest firewall options resources use `output_policy = "DROP"` with explicit outbound allows.

## Notes

- For operator setup and platform-specific client instructions, see [TAILSCALE.md](../../../TAILSCALE.md).
- The managed tier uses `172.16.0.100-199`.
- The dev tier uses `172.16.0.200-255`.
- `ipset-mgd.tf` and `ipset-dev.tf` define the IP sets referenced by the `+dc/ipset-*` rules.
- `nginx/conf.d/mgd.conf` is the wildcard `*.trusted.nirmalhk7.com` route and proxies to `172.16.0.105:443`.
- `nginx/conf.d/proxmox.conf` proxies `proxmox.trusted.nirmalhk7.com` to `172.16.0.1:8006`.
- `nginx/conf.d/robot.conf` proxies `robot.trusted.nirmalhk7.com` to `172.16.0.104:18789`.
- `home.trusted.nirmalhk7.com` uses the wildcard `*.trusted` route in `mgd.conf`, not `local.conf`.
- `nginx/conf.d/local.conf` is a separate local default server on `80`; it is not part of the `*.trusted` routes.
- `lxc-proxbridge` (CT 102, `172.16.0.102`) bridges Proxmox host disk SMART telemetry into the cluster. Terraform creates the container only; `infrastructure/ansible/lxc-proxbridge.ansible.yaml` configures disk passthrough and external Scrutiny/Prometheus collectors. The collector resolves `scrutiny.trusted.nirmalhk7.com` to nginx via `/etc/hosts` and posts through `mgd.conf`.
- SSH on `22/tcp` is allowed inbound on every security group shown here.
