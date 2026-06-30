#!/usr/bin/env node

import {
  FinvizProvider,
  FinvizTechnicalProvider,
  SECFilingSearchProvider,
  SECProvider,
  appendSeed,
  mergeSeedPayloads,
} from "./adapters.js";
import {
  ReviewedPayload,
  reviewThesisDepth,
  scanCatalysts,
  scanNews,
  narrowReviewPool,
  firstPassReview,
  reviewRisks,
  publishFinalReport,
} from "./agent-turns.js";
import {
  ContractError,
  recordValue,
  validateEventBatch,
  validateFinalReport,
  validateReviewBatch,
} from "./contracts.js";
import {
  scoreOwnerEarningsQuality,
  scoreBalanceSheetSafety,
  scoreEarningsYield,
  rankOpportunities,
} from "./value-engine.js";
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
      "equity-research-cli",
      {
        command: args.command,
        options: Object.fromEntries(args.options.entries()),
        positionals: args.positionals,
      },
      () => commandOutput(args),
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

async function commandOutput(args: ParsedArgs): Promise<unknown> {
  switch (args.command) {
    case "seed-configured-universe":
      return new SECProvider().seed(
        tickerList(option(args, "tickers") ?? process.env.OPENCLAW_SEC_SEED_TICKERS ?? ""),
        intOption(args, "limit", process.env.OPENCLAW_SEC_SEED_LIMIT ?? "40"),
      );
    case "discover-value-candidates": {
      const upstream = await readStdinPayload(false);
      const disabled = args.options.has("disabled") || process.env.OPENCLAW_FINVIZ_DISABLED === "1";
      const addition = disabled
        ? { candidates: [], provider_errors: [{ provider: "finviz", message: "disabled" }] }
        : await new FinvizProvider().seed(
          intOption(args, "limit", process.env.OPENCLAW_FINVIZ_SEED_LIMIT ?? "40"),
      );
      return appendSeed(upstream ?? { candidates: [] }, addition);
    }
    case "discover-technical-candidates": {
      const upstream = await readRequiredStdinPayload();
      const disabled = args.options.has("disabled")
        || process.env.OPENCLAW_FINVIZ_TECHNICAL_DISABLED === "1";
      const addition = disabled
        ? { candidates: [], provider_errors: [{ provider: "finviz_technical", message: "disabled" }] }
        : await new FinvizTechnicalProvider().seed(
          intOption(args, "limit", process.env.OPENCLAW_FINVIZ_TECHNICAL_SEED_LIMIT ?? "40"),
      );
      return appendSeed(upstream, addition);
    }
    case "merge-candidates":
      return mergeSeedPayloads(await readRequiredStdinPayload());
    case "enrich-primary-filings":
      return new SECFilingSearchProvider().enrich(
        await readRequiredStdinPayload(),
        intOption(args, "limit", process.env.OPENCLAW_SEC_FILING_SEARCH_LIMIT ?? "6"),
      );
    case "score-earnings-yield":
      return scoreEarningsYield(await reviewedPayload());
    case "score-balance-sheet-safety":
      return scoreBalanceSheetSafety(await reviewedPayload());
    case "score-owner-earnings-quality":
      return scoreOwnerEarningsQuality(await reviewedPayload());
    case "first-pass-review":
      return firstPassReview(await reviewedPayload());
    case "scan-news":
      return scanNews(await reviewedPayload());
    case "scan-catalysts":
      return scanCatalysts(await reviewedPayload());
    case "rank-opportunities":
      return rankOpportunities(
        await reviewedPayload(),
        intOption(args, "limit", process.env.OPENCLAW_EQUITY_DEEP_REVIEW_LIMIT ?? "8"),
      );
    case "narrow-review-pool":
      return narrowReviewPool(
        await reviewedPayload(),
        intOption(args, "limit", process.env.OPENCLAW_EQUITY_DEEP_REVIEW_LIMIT ?? "8"),
      );
    case "review-thesis-depth":
      return reviewThesisDepth(await reviewedPayload());
    case "review-risks":
      return reviewRisks(await reviewedPayload());
    case "publish-final-report":
      return publishFinalReport(await reviewedPayload());
    case "validate-contract":
      return validateContract(args.positionals[0], await readRequiredStdinPayload());
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

function intOption(args: ParsedArgs, name: string, fallback: string): number {
  const value = Number.parseInt(option(args, name) ?? fallback, 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new ContractError(`${name} must be a non-negative integer`);
  }
  return value;
}

async function readStdinPayload(required = true): Promise<Record<string, unknown> | null> {
  const text = (await stdinText()).trim();
  if (!text) {
    if (required) {
      throw new ContractError("expected JSON on stdin");
    }
    return null;
  }
  return recordValue(JSON.parse(text) as unknown);
}

async function readRequiredStdinPayload(): Promise<Record<string, unknown>> {
  const payload = await readStdinPayload();
  if (payload === null) {
    throw new ContractError("expected JSON on stdin");
  }
  return payload;
}

async function reviewedPayload(): Promise<ReviewedPayload> {
  return await readRequiredStdinPayload() as unknown as ReviewedPayload;
}

async function stdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function tickerList(raw: string): string[] {
  return raw.split(",").map((ticker) => ticker.trim().toUpperCase()).filter(Boolean);
}

function validateContract(contract: string | undefined, document: Record<string, unknown>): unknown {
  if (contract === "reviews") {
    return { reviews: validateReviewBatch(document) };
  }
  if (contract === "event") {
    const event = validateEventBatch(document);
    return { reviews: event.reviews, event_candidates: event.eventCandidates };
  }
  if (contract === "final") {
    return validateFinalReport(document);
  }
  throw new ContractError("validate-contract requires reviews, event, or final");
}

function usage(command: string): string {
  const suffix = command ? `unknown command ${command}` : "command required";
  return `${suffix}; use seed-configured-universe, discover-value-candidates, discover-technical-candidates, merge-candidates, enrich-primary-filings, score-earnings-yield, score-balance-sheet-safety, score-owner-earnings-quality, first-pass-review, scan-news, scan-catalysts, rank-opportunities, narrow-review-pool, review-thesis-depth, review-risks, publish-final-report, or validate-contract`;
}

main().then((code) => {
  process.exitCode = code;
}).catch((error: unknown) => {
  process.stderr.write(`equity-research: ${String(error)}\n`);
  process.exitCode = 2;
});
