{
  "name": "mountainvalue-watchdog",
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
      "id": "daily_report",
      "command": "equity-research daily-report",
      "stdin": "$watchdog.stdout"
    }
  ]
}
