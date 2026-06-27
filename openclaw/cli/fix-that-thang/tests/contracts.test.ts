import assert from "node:assert/strict";
import test from "node:test";

import {
  analyze,
  assertRahulCaller,
  ContractError,
  draftPullRequest,
  resolveRahulCaller,
  validateAnalysis,
  validateDraft,
} from "../src/contracts.js";

test("resolveRahulCaller prefers Rahul identity and workspace", () => {
  assert.equal(resolveRahulCaller({ env: { OPENCLAW_AGENT_ID: "rahul" } }), "rahul");
  assert.equal(resolveRahulCaller({ cwd: "/root/.openclaw/workspace-rahul" }), "rahul");
  assert.equal(resolveRahulCaller({ cwd: "/tmp/not-rahul" }), null);
});

test("Rahul caller guard fails closed", () => {
  assert.throws(() => assertRahulCaller({ cwd: "/tmp/not-rahul" }), ContractError);
  assert.throws(() => assertRahulCaller({ env: { OPENCLAW_AGENT_ID: "not-rahul" } }), ContractError);
});

test("analyze is deterministic and canonicalizes arrays", () => {
  const input = {
    signals: ["  crash loop  ", "crash loop", "failed reconciliation"],
    change_set: ["patch yaml", "patch yaml", "add guard"],
    validation: ["kubectl kustomize", "kubectl kustomize", "npm test"],
    fix_now: true,
    propose_improvement: true,
    next_action: "Run the bounded fix once.",
  };

  const resultA = analyze(input, { env: { OPENCLAW_AGENT_ID: "rahul" } });
  const resultB = analyze(input, { env: { OPENCLAW_AGENT_ID: "rahul" } });

  assert.deepEqual(resultA, resultB);
  assert.equal(resultA.decision, "fix-now");
  assert.deepEqual(resultA.signal_summary, ["crash loop", "failed reconciliation"]);
  assert.deepEqual(resultA.change_set, ["add guard", "patch yaml"]);
  assert.deepEqual(resultA.validation, ["kubectl kustomize", "npm test"]);
});

test("escalate wins before fix-now", () => {
  const result = analyze(
    {
      signals: ["needs credentials"],
      requires_human: true,
      fix_now: true,
    },
    { env: { OPENCLAW_AGENT_ID: "rahul" } },
  );

  assert.equal(result.decision, "escalate");
});

test("draftPullRequest produces a stable handoff", () => {
  const draft = draftPullRequest(
    {
      signals: ["failed reconciliation", "crash loop"],
      change_set: ["update manifest", "tighten guard"],
      validation: ["kubectl kustomize", "npm test"],
      fix_now: true,
    },
    { env: { OPENCLAW_AGENT_ID: "rahul" } },
  );

  assert.equal(draft.decision, "fix-now");
  assert.equal(draft.branch, "rahul/fix-now-crash-loop");
  assert.match(draft.body_markdown, /## Signals/u);
  assert.deepEqual(draft.labels, ["rahul", "maintenance"]);
});

test("validation helpers reject malformed documents", () => {
  assert.throws(() => validateAnalysis({ decision: "maybe" }), ContractError);
  assert.throws(() => validateDraft({ decision: "maybe" }), ContractError);
});
