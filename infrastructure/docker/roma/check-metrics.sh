#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  lan)
    if ! metrics=$(curl --noproxy '*' --fail --silent --show-error --max-time 8 http://10.0.0.79:9100/metrics); then
      echo 'Roma metrics endpoint is unreachable' >&2
      exit 1
    fi
    for metric in 'node_cpu_seconds_total{' 'node_memory_MemTotal_bytes ' \
      'node_filesystem_size_bytes{' 'node_network_receive_bytes_total{device="wlan0"'; do
      if ! grep -qF "$metric" <<< "$metrics"; then
        echo "Missing host metric: $metric" >&2
        exit 1
      fi
    done
    echo 'Roma CPU, memory, filesystem, and wlan0 metrics are reachable over the LAN'
    ;;
  gitops)
    repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
    if ! kubectl kustomize "$repo/clusters/managed/monitoring" |
      yq -e 'select(.kind == "ScrapeConfig" and .metadata.name == "roma-node") |
        .metadata.namespace == "mgd-monitoring" and
        .metadata.labels.prometheus == "prometheus_scraper" and
        .spec.metricsPath == "/metrics" and
        .spec.staticConfigs[0].labels.job == "roma-node" and
        .spec.staticConfigs[0].targets[0] == "10.0.0.79:9100"' >/dev/null; then
      echo 'Managed monitoring does not render the Roma scrape target' >&2
      exit 1
    fi
    echo 'Managed monitoring renders the Roma scrape target'
    ;;
  *)
    echo "Usage: $0 {lan|gitops}" >&2
    exit 2
    ;;
esac
