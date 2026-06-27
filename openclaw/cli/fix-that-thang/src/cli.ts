import { stdin } from "node:process";

import {
  analyze,
  ContractError,
  draftPullRequest,
  validateAnalysis,
  validateDraft,
} from "./contracts.js";

interface ParsedArgs {
  command: string;
  positionals: string[];
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  try {
    const output = await commandOutput(args);
    process.stdout.write(`${JSON.stringify(output)}\n`);
    return 0;
  } catch (error) {
    if (error instanceof ContractError || error instanceof SyntaxError || error instanceof Error) {
      process.stderr.write(`fix-that-thang: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

async function commandOutput(args: ParsedArgs): Promise<unknown> {
  switch (args.command) {
    case "analyze":
      return analyze(await readRequiredJson());
    case "draft-pr":
      return draftPullRequest(await readRequiredJson());
    case "validate-contract":
      return validateContract(args.positionals[0], await readRequiredJson());
    default:
      throw new ContractError("usage: fix-that-thang analyze|draft-pr|validate-contract analyze|pr");
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "", ...positionals] = argv;
  return { command, positionals };
}

async function readRequiredJson(): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    throw new ContractError("expected JSON on stdin");
  }
  const parsed = JSON.parse(text) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ContractError("expected JSON object on stdin");
  }
  return parsed as Record<string, unknown>;
}

function validateContract(contract: string | undefined, document: Record<string, unknown>): unknown {
  if (contract === "analyze") {
    return validateAnalysis(document);
  }
  if (contract === "pr") {
    return validateDraft(document);
  }
  throw new ContractError("usage: fix-that-thang validate-contract analyze|pr");
}

main().then((code) => {
  process.exitCode = code;
});
