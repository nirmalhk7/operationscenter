import { basename, resolve, sep } from "node:path";

export type Decision = "fix-now" | "propose-improvement" | "escalate" | "all-clear";

export interface RunContext {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface MaintenanceInput {
  signals?: unknown;
  change_set?: unknown;
  validation?: unknown;
  requires_human?: boolean;
  needs_credentials?: boolean;
  cluster_scoped?: boolean;
  fix_now?: boolean;
  propose_improvement?: boolean;
  all_clear?: boolean;
  next_action?: unknown;
}

export interface MaintenanceResult {
  decision: Decision;
  signal_summary: string[];
  change_set: string[];
  validation: string[];
  next_action: string;
}

export interface DraftPullRequest {
  title: string;
  branch: string;
  body_markdown: string;
  labels: string[];
  decision: Decision;
}

export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractError";
  }
}

const callerEnvKeys = [
  "OPENCLAW_AGENT_ID",
  "OPENCLAW_CURRENT_AGENT",
  "OPENCLAW_ACCOUNT_ID",
  "OPENCLAW_DISCORD_ACCOUNT_ID",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const items = value
    .flatMap((item) => typeof item === "string" ? [item.trim()] : [])
    .filter((item) => item.length > 0);
  return Array.from(new Set(items)).sort((left, right) => left.localeCompare(right));
}

function summarize(value: unknown, fallback: string): string[] {
  const items = asStringList(value);
  return items.length > 0 ? items : [fallback];
}

export function resolveRahulCaller(context: RunContext = {}): string | null {
  const env = context.env ?? process.env;
  for (const key of callerEnvKeys) {
    const value = env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim().toLowerCase();
    }
  }

  const cwd = resolve(context.cwd ?? process.cwd());
  const segments = cwd.split(sep).filter(Boolean);
  if (basename(cwd) === "workspace-rahul" || segments.includes("workspace-rahul")) {
    return "rahul";
  }

  return null;
}

export function assertRahulCaller(context: RunContext = {}): void {
  const caller = resolveRahulCaller(context);
  if (caller !== "rahul") {
    throw new ContractError("fix-that-thang may only run for Rahul");
  }
}

export function decide(input: MaintenanceInput): Decision {
  if (input.requires_human || input.needs_credentials || input.cluster_scoped) {
    return "escalate";
  }
  if (input.fix_now) {
    return "fix-now";
  }
  if (input.propose_improvement) {
    return "propose-improvement";
  }
  if (input.all_clear) {
    return "all-clear";
  }
  return "all-clear";
}

export function analyze(input: unknown, context: RunContext = {}): MaintenanceResult {
  assertRahulCaller(context);
  const payload = isRecord(input) ? input as MaintenanceInput : {};
  const decision = decide(payload);
  const signal_summary = summarize(payload.signals, "No explicit signal supplied.");
  const change_set = asStringList(payload.change_set);
  const validation = asStringList(payload.validation);
  const next_action = typeof payload.next_action === "string" && payload.next_action.trim().length > 0
    ? payload.next_action.trim()
    : decision === "fix-now"
      ? "Validate the bounded fix, then draft the PR."
      : decision === "propose-improvement"
        ? "Validate the improvement candidate before broadening scope."
        : decision === "escalate"
          ? "Stop and ask a human for approval or credentials."
          : "";

  return {
    decision,
    signal_summary,
    change_set,
    validation,
    next_action,
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function draftPullRequest(input: unknown, context: RunContext = {}): DraftPullRequest {
  const result = analyze(input, context);
  const headline = result.decision === "fix-now"
    ? "bounded fix"
    : result.decision === "propose-improvement"
      ? "bounded improvement"
      : result.decision === "escalate"
        ? "human escalation"
        : "all clear";
  const branch = `rahul/${slugify(`${result.decision}-${result.signal_summary[0] ?? "maintenance"}`)}`;
  const body = [
    "## Summary",
    `Decision: ${result.decision}`,
    "",
    "## Signals",
    ...result.signal_summary.map((signal) => `- ${signal}`),
    "",
    "## Change Set",
    ...(result.change_set.length > 0 ? result.change_set.map((item) => `- ${item}`) : ["- No bounded change set needed."]),
    "",
    "## Validation",
    ...(result.validation.length > 0 ? result.validation.map((item) => `- ${item}`) : ["- No validation steps recorded."]),
    "",
    "## Next Action",
    result.next_action || "-",
  ].join("\n");

  return {
    title: `Rahul: ${headline}`,
    branch,
    body_markdown: body,
    labels: ["rahul", "maintenance"],
    decision: result.decision,
  };
}

export function validateAnalysis(document: unknown): MaintenanceResult {
  if (!isRecord(document)) {
    throw new ContractError("expected analysis JSON object");
  }
  const decision = document.decision;
  if (decision !== "fix-now" && decision !== "propose-improvement" && decision !== "escalate" && decision !== "all-clear") {
    throw new ContractError("invalid decision");
  }
  return {
    decision,
    signal_summary: asStringList(document.signal_summary),
    change_set: asStringList(document.change_set),
    validation: asStringList(document.validation),
    next_action: typeof document.next_action === "string" ? document.next_action : "",
  };
}

export function validateDraft(document: unknown): DraftPullRequest {
  if (!isRecord(document)) {
    throw new ContractError("expected draft JSON object");
  }
  const decision = document.decision;
  if (decision !== "fix-now" && decision !== "propose-improvement" && decision !== "escalate" && decision !== "all-clear") {
    throw new ContractError("invalid decision");
  }
  return {
    title: typeof document.title === "string" ? document.title : "",
    branch: typeof document.branch === "string" ? document.branch : "",
    body_markdown: typeof document.body_markdown === "string" ? document.body_markdown : "",
    labels: asStringList(document.labels),
    decision,
  };
}
