{
  "name": "mountainvalue-signals",
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
      "id": "signals_if_due",
      "command": "equity-research signals-if-due",
      "stdin": "$watchdog.stdout"
    },
    {
      "id": "daily_report",
      "command": "equity-research daily-report",
      "stdin": "$signals_if_due.stdout"
    }
  ]
}
