#!/usr/bin/env node

import { createAlpacaClient } from "./adapters.js";
import { ContractError, assertRecord, assertString } from "./contracts.js";
import { TradingLedger, ensureLedger } from "./ledger.js";
import { createTradingCoreService, loadTradingConfig, validateConfig } from "./agent-turns.js";
import { observeLangfuse, shutdownLangfuse } from "./langfuse.js";

interface ParsedArgs {
  command: string;
  options: Map<string, string | true>;
  positionals: string[];
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  try {
    const output = await observeLangfuse(
      "mountainvalue-cli",
      {
        command: args.command,
        options: Object.fromEntries(args.options.entries()),
        positionals: args.positionals,
      },
      async () => {
        if (args.command === "validate-contract") {
          return validateContract(args.positionals[0], await readRequiredStdinPayload());
        }
        const config = loadTradingConfig();
        validateConfig(config);
        const ledger = ensureLedger(config.ledger_path, config.execution_mode);
        const broker = createAlpacaClient(config);
        const service = createTradingCoreService({ config, ledger, broker });
        return await commandOutput(service, args);
      },
    );
    process.stdout.write(`${JSON.stringify(output)}\n`);
    return 0;
  } catch (error) {
    if (error instanceof ContractError || error instanceof SyntaxError || error instanceof Error) {
      process.stderr.write(`equity-research: ${error.message}\n`);
      return 2;
    }
    throw error;
  } finally {
    await shutdownLangfuse();
  }
}

async function commandOutput(service: ReturnType<typeof createTradingCoreService>, args: ParsedArgs): Promise<unknown> {
  switch (args.command) {
    case "preflight":
      return await service.preflight();
    case "reconcile":
      return await service.reconcile();
    case "watchdog":
      return await service.watchdog();
    case "signals-if-due":
      return await service.signalsIfDue();
    case "cycle-if-due":
      return await service.cycleIfDue();
    case "cancel-stale-entries-if-due":
      return await service.cancelStaleEntriesIfDue();
    case "daily-report":
      return await service.dailyReport();
    case "status":
      return await service.status();
    case "pause":
      return service.pause(option(args, "reason") ?? args.positionals.join(" ") ?? "manual pause");
    case "request-resume":
      return await service.requestResume(option(args, "actor") ?? args.positionals[0] ?? "operator");
    case "audit-log":
      return { audits: service.auditLog(intOption(args, "limit", 25)) };
    default:
      throw new ContractError(usage(args.command));
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "", ...rest] = argv;
  const options = new Map<string, string | true>();
  const positionals: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      options.set(name, true);
    } else {
      options.set(name, next);
      index += 1;
    }
  }
  return { command, options, positionals };
}

function option(args: ParsedArgs, name: string): string | undefined {
  const value = args.options.get(name);
  return typeof value === "string" ? value : undefined;
}

function intOption(args: ParsedArgs, name: string, fallback: number): number {
  const value = option(args, name);
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ContractError(`${name} must be a non-negative integer`);
  }
  return parsed;
}

async function readRequiredStdinPayload(): Promise<unknown> {
  const text = await readStdinText();
  if (!text.trim()) {
    throw new ContractError("expected JSON on stdin");
  }
  return JSON.parse(text);
}

async function readStdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function validateContract(contract: string | undefined, document: unknown): unknown {
  const record = assertRecord(document);
  switch (contract) {
    case "decision":
      return {
        status: assertString(record.status, "decision status is required"),
        trade_date: assertString(record.trade_date, "decision trade_date is required"),
      };
    case "report":
      return {
        trade_date: assertString(record.trade_date, "report trade_date is required"),
        strategy_equity: record.strategy_equity,
        open_positions: Array.isArray(record.open_positions) ? record.open_positions : [],
        open_orders: Array.isArray(record.open_orders) ? record.open_orders : [],
        signals: Array.isArray(record.signals) ? record.signals : [],
        skipped_trades: Array.isArray(record.skipped_trades) ? record.skipped_trades : [],
      };
    case "audit":
      return {
        step: assertString(record.step, "audit step is required"),
        message: assertString(record.message, "audit message is required"),
      };
    default:
      throw new ContractError("validate-contract requires decision, report, or audit");
  }
}

function usage(command: string): string {
  const suffix = command ? `unknown command ${command}` : "command required";
  return `${suffix}; use preflight, reconcile, watchdog, signals-if-due, cycle-if-due, cancel-stale-entries-if-due, daily-report, status, pause, request-resume, audit-log, or validate-contract`;
}

main().then((code) => {
  process.exitCode = code;
}).catch((error: unknown) => {
  process.stderr.write(`equity-research: ${String(error)}\n`);
  process.exitCode = 2;
});
