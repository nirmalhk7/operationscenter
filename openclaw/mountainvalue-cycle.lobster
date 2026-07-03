{
  "name": "mountainvalue-cycle",
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
      "id": "cycle_if_due",
      "command": "equity-research cycle-if-due",
      "stdin": "$watchdog.stdout"
    },
    {
      "id": "daily_report",
      "command": "equity-research daily-report",
      "stdin": "$cycle_if_due.stdout"
    }
  ]
}
