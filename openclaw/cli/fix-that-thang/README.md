# `@nirmalhk7/fix-that-thang`

Rahul-only OpenClaw maintenance planner and PR draft helper.

The package codifies the same learnings that made Rahul more predictable:
single bounded change sets, a deterministic decision order, canonicalized
signals, and a stable handoff shape for PR drafting.

## Package Boundary

`fix-that-thang` is for Rahul's cluster maintenance workflow. It is not a
general-purpose shell tool and it is not meant for other agents.

The package refuses to run unless the caller resolves to Rahul. In practice,
that means either the runtime identifies Rahul explicitly or the command is
being executed from Rahul's workspace. If the caller cannot be tied back to
Rahul, the package exits closed.

## Release

Changes on `main` run `semantic-release` with Conventional Commits:

- `fix:` produces a patch version.
- `feat:` produces a minor version.
- a `BREAKING CHANGE:` footer produces a major version.

The release tag format is `fix-that-thang-v<version>`.

## Commands

```text
fix-that-thang analyze
fix-that-thang draft-pr
fix-that-thang validate-contract analyze|pr
```

Each command reads JSON from stdin and writes JSON to stdout.

## Local checks

```sh
npm test
```
