# Roma host metrics

Node Exporter serves CPU, memory, filesystem, and network metrics at `http://10.0.0.79:9100/metrics`. It binds to the board's private IPv4 address on Wi-Fi. Keep the board's DHCP reservation and the Prometheus target in sync if its address moves.

Deploy or update the exporter from the repository root using the board's existing SSH account and Docker Compose:

```bash
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes arduino@10.0.0.79 \
  'docker compose --project-name roma-monitoring -f - up -d' \
  < infrastructure/docker/roma/compose.yaml
```

Docker restarts the exporter after a reboot. Flux reconciles the managed Prometheus scrape target from the cluster configuration in Git. After reconciliation, query `up{job="roma-node"}` in Prometheus. A value of `1` confirms Prometheus can reach the board.

Run these checks from a machine on the same LAN:

```bash
bash infrastructure/docker/roma/check-metrics.sh lan
bash infrastructure/docker/roma/check-metrics.sh gitops
```
