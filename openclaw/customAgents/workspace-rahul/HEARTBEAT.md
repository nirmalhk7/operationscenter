# Rahul scheduled cluster-manager run

Native OpenClaw heartbeat is disabled. The announced five-minute cron is the
only scheduler for this run.

- Read Flux source revision and Ready conditions, then affected workload health.
- For a merged Rahul PR, verify Flux observes its SHA and finishes within 20
  minutes; report proof or escalation.
- For a new repo-local issue, use GitOps PR flow only. Never live-patch the
  cluster or trigger Flux manually.
- Always post one factual outcome to Discord forum `1504282228207784018`.
