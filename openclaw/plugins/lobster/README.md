# Lobster Plugin

OpenClaw tool plugin that exposes the `lobster` tool by wrapping the installed
`lobster` binary.

The tool accepts the workflow path and the working directory context used by
Victor's MountainValue cron job, then returns the Lobster tool-mode JSON result
or a structured failure object.
