import { LangfuseSpanProcessor } from "@langfuse/otel";
import { startActiveObservation } from "@langfuse/tracing";
import { NodeSDK } from "@opentelemetry/sdk-node";

type ObservationSpan = {
  update(data: Record<string, unknown>): void;
};

type ObservationInput = Record<string, unknown>;

const langfusePublicKey = process.env.OPENCLAW_LANGFUSE_PUBLIC_KEY?.trim();
const langfuseSecretKey = process.env.OPENCLAW_LANGFUSE_SECRET_KEY?.trim();
const langfuseBaseUrl = process.env.OPENCLAW_LANGFUSE_BASE_URL?.trim()
  || "https://langfuse.trusted.nirmalhk7.com";

const hasLangfuseCredentials = Boolean(langfusePublicKey && langfuseSecretKey);

const sdk = hasLangfuseCredentials
  ? new NodeSDK({
      spanProcessors: [new LangfuseSpanProcessor({
        publicKey: langfusePublicKey!,
        secretKey: langfuseSecretKey!,
        baseUrl: langfuseBaseUrl,
        exportMode: "immediate",
      })],
    })
  : null;

if (sdk) {
  void sdk.start();
}

const noopSpan: ObservationSpan = {
  update() {},
};

export function observeLangfuse<T>(
  name: string,
  input: ObservationInput,
  fn: (span: ObservationSpan) => T,
): T {
  if (!sdk) {
    return fn(noopSpan);
  }

  return startActiveObservation(name, (span) => {
    span.update({ input });
    try {
      const result = fn(span as ObservationSpan);
      if (isPromiseLike(result)) {
        return result.then(
          (value) => {
            span.update({ output: summarizeObservationValue(value) });
            return value;
          },
          (error: unknown) => {
            span.update({ output: { error: summarizeError(error) } });
            throw error;
          },
        );
      }
      span.update({ output: summarizeObservationValue(result) });
      return result;
    } catch (error) {
      span.update({ output: { error: summarizeError(error) } });
      throw error;
    }
  }) as T;
}

export async function shutdownLangfuse(): Promise<void> {
  if (!sdk) {
    return;
  }
  await sdk.shutdown();
}

function isPromiseLike<T>(value: unknown): value is Promise<T> {
  return typeof value === "object" && value !== null && typeof (value as Promise<T>).then === "function";
}

function summarizeObservationValue(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) {
    return { value };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return { value };
  }
  const record = value as Record<string, unknown>;
  const summary: Record<string, unknown> = {
    keys: Object.keys(record).slice(0, 12),
  };
  if (typeof record.mode === "string") {
    summary.mode = record.mode;
  }
  if (typeof record.selected_ticker === "string" || record.selected_ticker === null) {
    summary.selected_ticker = record.selected_ticker;
  }
  if (Array.isArray(record.candidates)) {
    summary.candidate_count = record.candidates.length;
  }
  if (Array.isArray(record.reviews)) {
    summary.review_count = record.reviews.length;
  }
  if (Array.isArray(record.missing_evidence)) {
    summary.missing_evidence_count = record.missing_evidence.length;
  }
  return summary;
}

function summarizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
