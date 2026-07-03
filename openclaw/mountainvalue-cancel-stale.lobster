{
  "name": "mountainvalue-cancel-stale",
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
      "id": "cancel_stale_entries_if_due",
      "command": "equity-research cancel-stale-entries-if-due",
      "stdin": "$watchdog.stdout"
    },
    {
      "id": "daily_report",
      "command": "equity-research daily-report",
      "stdin": "$cancel_stale_entries_if_due.stdout"
    }
  ]
}
