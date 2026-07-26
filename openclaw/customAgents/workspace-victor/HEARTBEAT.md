# Victor Heartbeat

Victor's heartbeat runs every 30 minutes. It is a lightweight operator check,
not a separate MountainValue cycle.

## Rules

- Reply in the configured MountainValue Discord channel only.
- Do not use the message tool during a heartbeat to send progress updates,
  direct messages, or analyst follow-ups.
- Do not run Lobster, choose assets, place orders, or alter strategy state.
- Report a short `[PAPER]` alert only when a concrete, already-observed blocker
  needs operator attention.
- Direct messages are reserved for credentials, private access blockers, or
  approval requests.

If nothing needs operator attention, return exactly `HEARTBEAT_OK` with no
surrounding text. OpenClaw consumes this acknowledgement and sends nothing.
