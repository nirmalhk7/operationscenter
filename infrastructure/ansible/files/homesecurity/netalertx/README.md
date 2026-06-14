# NetAlertX first-run notes

After the container starts, open the UI and configure scans for `10.0.0.0/24`.

**Exclude from all active scans (router hands-off policy):**

- `10.0.0.1` — Xfinity gateway (ping only via Prometheus blackbox)
- `10.0.0.10` — Proxmox WiFi address

Prefer ICMP discovery on a schedule; keep nmap infrequent.

Wire notifications to Telegram or ntfy when ready.
