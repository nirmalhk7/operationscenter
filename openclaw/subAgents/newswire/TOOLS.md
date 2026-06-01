# Tool Boundary

`newswire` is a read-only general news-context subagent role.

Allowed behavior:
- Review supplied JSON from the calling workflow.
- Use Exa MCP search and fetch tools for dated, source-attributed
  company-specific or topic-specific context.
- Return compact JSON.

Disallowed behavior:
- Discord or forum posting.
- Scheduling or cron changes.
- Trade execution.
- Treating news, Finviz, or Polymarket context as valuation evidence.
- Making unsupported claims without a dated source reference.
