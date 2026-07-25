{
  "name": "mountainvalue-paper-trading",
  "steps": [
    {
      "id": "preflight",
      "command": "equity-research preflight"
    },
    {
      "id": "reconcile",
      "command": "equity-research reconcile",
      "stdin": "$preflight.stdout"
    },
    {
      "id": "watchdog",
      "command": "equity-research watchdog",
      "stdin": "$reconcile.stdout"
    },
    {
      "id": "data_sync",
      "command": "equity-research data-sync",
      "stdin": "$watchdog.stdout"
    },
    {
      "id": "research_etfs",
      "command": "equity-research research-etfs",
      "stdin": "$data_sync.stdout"
    },
    {
      "id": "build_targets",
      "command": "equity-research build-targets",
      "stdin": "$research_etfs.stdout"
    },
    {
      "id": "signals_if_due",
      "command": "equity-research signals-if-due",
      "stdin": "$build_targets.stdout"
    },
    {
      "id": "cycle_if_due",
      "command": "equity-research cycle-if-due",
      "stdin": "$signals_if_due.stdout"
    },
    {
      "id": "cancel_stale_entries_if_due",
      "command": "equity-research cancel-stale-entries-if-due",
      "stdin": "$cycle_if_due.stdout"
    },
    {
      "id": "daily_report",
      "command": "equity-research daily-report",
      "stdin": "$cancel_stale_entries_if_due.stdout"
    }
  ]
}
