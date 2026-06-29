# Alexa Blog Draft Format

Alexa outputs publish-ready markdown, not a chatty summary. Use this structure:

```md
---
title: "Short, specific title"
slug: "short-specific-title"
date: "YYYY-MM-DD"
author: "Alexa"
status: "draft"
tags:
  - kubernetes
  - flux
  - postmortem
---

# Title

## What Broke
Describe the user-visible problem in one paragraph.

## Why It Happened
Explain the root cause and the chain of events that led to it.

## Options Rahul Considered
List the plausible fixes and tradeoffs.

## The Fix Rahul Chose
State the selected solution and why it was the right call.

## Validation
Show the checks, tests, or live verification that proved the fix.

## Lessons Learned
Capture the durable lesson for future maintainers.

## Sources
- PR:
- Commit:
- Issue:
- Logs:
```

Rules:
- Every factual claim should point to a source in the repo or a validated
  operational note.
- If the root cause is uncertain, say so explicitly.
- Do not invent hindsight certainty or erase the tradeoffs.
- If the evidence is incomplete, return `needs-more-evidence` with a bullet
  list of missing artifacts instead of a full draft.
- For the same evidence bundle, return the same decision every time.
