# Devbench Builder Platform

Devbench is the repo-centered toolchain for building products in the managed
cluster. Gitea is the hub: use repositories for code, issues for work, project
boards for flow, milestones for releases or sprints, labels for status and
component ownership, and wikis for lightweight product notes.

## Product lifecycle

1. Plan work in Gitea issues, project boards, and milestones.
2. Create or update the product repository in Gitea.
3. Add a Gitea Actions workflow for build and test.
4. Add a SonarQube project and wire a quality-gate workflow.
5. Use Appwrite for backend services when the product benefits from it.
6. Add Bugsink DSN wiring so runtime errors are reported.
7. Use Loki for central application and service log inspection.
8. Run Locust smoke or load tests against the deployed endpoint.
9. Let Renovate keep dependencies current through Gitea pull requests.

## Repository conventions

Each product repository should use these Gitea surfaces consistently:

- Issues: product work, bugs, operational tasks, and follow-ups.
- Projects: Kanban-style boards for active execution.
- Milestones: releases, sprints, or larger delivery checkpoints.
- Labels: priority, status, component, and risk.
- Wiki: short product notes, setup steps, and operating context.
- Pull requests: implementation review and merge history.
- Actions: CI, quality gates, release wiring, and test automation.

## Repository secrets and variables

Use Gitea repository secrets for sensitive values and repository variables for
non-sensitive configuration.

| Name | Type | Purpose |
|---|---|---|
| `SONAR_TOKEN` | Secret | SonarQube project-analysis token |
| `SONAR_PROJECT_KEY` | Variable | SonarQube project key |
| `BUGSINK_DSN` | Secret | Bugsink project DSN for Sentry-compatible SDKs |
| `LOCUST_HOST` | Variable | Target URL for smoke or load tests |
| Appwrite endpoint/project values | Variable or Secret | Product-owned Appwrite configuration |

Cluster-level secrets remain in the Sealed Secrets workflow. Do not commit
plaintext secrets.

## Tool roles

| Tool | Role |
|---|---|
| Gitea | Source, planning, pull requests, wikis, packages, and Actions |
| SonarQube | Static analysis and quality gates |
| Appwrite | Backend platform for products that need managed APIs or services |
| Bugsink | Sentry-style application error tracking |
| Loki | Log aggregation API for runtime and service logs |
| Locust | Smoke and load testing |
| Renovate | Dependency update pull requests |

Renovate has no public dashboard in this deployment. Check the `renovate`
CronJob logs and Gitea pull requests from the Renovate bot account.

## Deferred apps

OpenProject and Umami are intentionally not part of Devbench V1. Gitea covers
the planning niche for now, and product analytics is deferred. Do not create
`projects.trusted.nirmalhk7.com` or `analytics.trusted.nirmalhk7.com` for this
version of the platform.

## Onboarding checklist

1. Create the Gitea repository and initial project board.
2. Add labels for `priority/*`, `status/*`, and `component/*`.
3. Add a first milestone for the next release or sprint.
4. Copy workflow examples from `gitea/examples/` into `.gitea/workflows/`.
5. Create the SonarQube project and add `SONAR_TOKEN` plus
   `SONAR_PROJECT_KEY`.
6. Create the Bugsink project and add `BUGSINK_DSN`.
7. Set `LOCUST_HOST` when the product has a reachable environment.
8. Add Appwrite repository configuration only for products using Appwrite.
