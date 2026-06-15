# NetAlertX (Sentinel)

GitOps config is rendered to `app.conf` by Ansible and bind-mounted into the container.

**Scan target:** `10.0.0.0/24` via NMAP (`NMAPDEV`) on `net0`. WiFi is L3-routed from this wmnet LXC, so ARP-based discovery is disabled.

**Excluded from inventory:**

- `10.0.0.1` — Xfinity gateway (Prometheus blackbox ping only)
- `10.0.0.10` — Proxmox WiFi address
- `172.16.%`, `172.17.%`, `172.18.%` — wmnet and Docker bridge ranges

UI: `https://sentinel.trusted.nirmalhk7.com`

Ansible purges `172.16/17/18.*` devices from the NetAlertX database on each deploy. Stale wmnet entries from the pre-WiFi ARP config are not re-discovered.
