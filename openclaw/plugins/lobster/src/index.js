import { spawn } from "node:child_process";
import path from "node:path";
import { Type } from "typebox";
import { jsonResult } from "openclaw/plugin-sdk/core";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

const LOBSTER_TOOL_SCHEMA = Type.Object({
  action: Type.Literal("run", { description: "Only the run action is supported in this wrapper." }),
  pipeline: Type.Optional(Type.String({ description: "Path to the Lobster workflow file." })),
  cwd: Type.Optional(Type.String({ description: "Working directory relative to the invoking agent workspace." })),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum runtime in milliseconds." })),
  maxStdoutBytes: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum stdout bytes to capture before aborting." }))
}, { additionalProperties: false });

function resolveBaseWorkspace(toolContext) {
  return toolContext?.workspaceDir || toolContext?.agentDir || process.cwd();
}

function normalizeRunParameters(params, toolContext) {
  const input = params && typeof params === "object" ? params : {};
  const baseWorkspace = resolveBaseWorkspace(toolContext);
  const cwd = typeof input.cwd === "string" && input.cwd.trim() ? input.cwd : ".";
  const resolvedCwd = path.resolve(baseWorkspace, cwd);
  const rawPipeline = typeof input.pipeline === "string" && input.pipeline.trim()
    ? input.pipeline.trim()
    : path.resolve(baseWorkspace, "..", "mountainvalue.lobster");
  const normalizedPipeline = rawPipeline.startsWith("$WORKSPACE_DIR/")
    ? path.resolve(path.resolve(baseWorkspace, ".."), rawPipeline.slice("$WORKSPACE_DIR/".length))
    : rawPipeline;
  const resolvedPipeline = path.isAbsolute(normalizedPipeline) ? normalizedPipeline : path.resolve(resolvedCwd, normalizedPipeline);
  const timeoutMs = Number.isInteger(input.timeoutMs) && input.timeoutMs > 0 ? input.timeoutMs : 1_800_000;
  const maxStdoutBytes = Number.isInteger(input.maxStdoutBytes) && input.maxStdoutBytes > 0 ? input.maxStdoutBytes : 1_048_576;
  return { resolvedCwd, resolvedPipeline, timeoutMs, maxStdoutBytes };
}

function runLobsterBinary({ resolvedCwd, resolvedPipeline, timeoutMs, maxStdoutBytes, signal }) {
  return new Promise((resolve) => {
    const child = spawn("lobster", ["run", "--mode", "tool", "--file", resolvedPipeline], {
      cwd: resolvedCwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    const appendChunk = (chunks, chunk, limit, stateKey) => {
      if (limit <= 0) {
        return false;
      }
      const nextBytes = chunk.length + (stateKey.bytes ?? 0);
      stateKey.bytes = nextBytes;
      if (nextBytes > limit) {
        stateKey.exceeded = true;
        return false;
      }
      chunks.push(chunk);
      return true;
    };

    const stdoutState = { bytes: 0, exceeded: false };
    const stderrState = { bytes: 0, exceeded: false };

    child.stdout.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (!appendChunk(stdoutChunks, buffer, maxStdoutBytes, stdoutState)) {
        child.kill("SIGTERM");
      }
    });

    child.stderr.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (!appendChunk(stderrChunks, buffer, maxStdoutBytes, stderrState)) {
        child.kill("SIGTERM");
      }
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref?.();
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
    };

    if (signal) {
      const abort = () => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5_000).unref?.();
      };
      if (signal.aborted) {
        abort();
      } else {
        signal.addEventListener("abort", abort, { once: true });
      }
    }

    child.once("error", (error) => {
      cleanup();
      finish({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        resolvedCwd,
        resolvedPipeline,
        timedOut,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8")
      });
    });

    child.once("close", (exitCode, signalName) => {
      cleanup();
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      finish({
        ok: exitCode === 0 && !timedOut,
        exitCode,
        signal: signalName ?? undefined,
        timedOut,
        resolvedCwd,
        resolvedPipeline,
        stdout,
        stderr
      });
    });
  });
}

export default defineToolPlugin({
  id: "lobster",
  name: "Lobster",
  description: "Add Lobster tools to OpenClaw.",
  tools: (tool) => [
    tool({
      name: "lobster",
      label: "Lobster",
      description: "Run a Lobster workflow and return its JSON result.",
      parameters: LOBSTER_TOOL_SCHEMA,
      factory: ({ toolContext }) => ({
        name: "lobster",
        label: "Lobster",
        description: "Run a Lobster workflow and return its JSON result.",
        parameters: LOBSTER_TOOL_SCHEMA,
        execute: async (_toolCallId, params, signal) => {
          const normalized = normalizeRunParameters(params, toolContext);
          const result = await runLobsterBinary({
            ...normalized,
            signal
          });

          if (result.ok) {
            const text = result.stdout.trim();
            if (text) {
              try {
                const parsed = JSON.parse(text);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                  return jsonResult({
                    ...parsed,
                    lobster: {
                      ok: true,
                      exitCode: result.exitCode ?? 0,
                      resolvedCwd: result.resolvedCwd,
                      resolvedPipeline: result.resolvedPipeline
                    }
                  });
                }
                return jsonResult({
                  result: parsed,
                  lobster: {
                    ok: true,
                    exitCode: result.exitCode ?? 0,
                    resolvedCwd: result.resolvedCwd,
                    resolvedPipeline: result.resolvedPipeline
                  }
                });
              } catch {
                return jsonResult({
                  ok: true,
                  exitCode: result.exitCode ?? 0,
                  resolvedCwd: result.resolvedCwd,
                  resolvedPipeline: result.resolvedPipeline,
                  stdout: text,
                  stderr: result.stderr.trim()
                });
              }
            }
          }

          return jsonResult({
            ...result,
            stdout: result.stdout.trim(),
            stderr: result.stderr.trim()
          });
        }
      })
    })
  ]
});
