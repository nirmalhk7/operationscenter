import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  FinvizProvider,
  FinvizTechnicalProvider,
  SEC_SUBMISSIONS_URL,
  SEC_COMPANY_FACTS_URL,
  SEC_TICKER_INDEX_URL,
  SECFilingSearchProvider,
  SECProvider,
  appendSeed,
  extractSecFilingRefs,
  mergeSeedPayloads,
  parseFinvizTickers,
} from "../src/adapters.js";
import { narrowPool, parseAgentJson } from "../src/agent-turns.js";
import { ContractError, blankCandidate } from "../src/contracts.js";

const fixtures = join(process.cwd(), "tests", "fixtures");

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8")) as unknown;
}

test("SEC seed builds filing-derived metrics", async () => {
  const factsUrl = SEC_COMPANY_FACTS_URL.replace("{cik}", "0000001234");
  const documents = new Map<string, unknown>([
    [SEC_TICKER_INDEX_URL, fixture("sec_tickers.json")],
    [factsUrl, fixture("sec_companyfacts.json")],
  ]);
  const result = await new SECProvider(async (url) => documents.get(url)).seed(["ABC"]);
  const candidate = result.candidates[0];

  assert.deepEqual(result.provider_errors, []);
  assert.equal(candidate.ticker, "ABC");
  assert.deepEqual(candidate.sources, ["sec_xbrl"]);
  assert.equal(candidate.metrics.net_margin, 0.12);
  assert.equal(candidate.metrics.liabilities_to_assets, 0.4);
  assert.deepEqual(candidate.filing_refs[0], {
    concept: "Revenues",
    form: "10-K",
    filed: "2026-02-10",
    accession: "0000001234-26-000001",
  });
});

test("malformed SEC facts fail one provider candidate", async () => {
  const factsUrl = SEC_COMPANY_FACTS_URL.replace("{cik}", "0000001234");
  const documents = new Map<string, unknown>([
    [SEC_TICKER_INDEX_URL, fixture("sec_tickers.json")],
    [factsUrl, { facts: {} }],
  ]);
  const result = await new SECProvider(async (url) => documents.get(url)).seed(["ABC"]);

  assert.deepEqual(result.candidates, []);
  assert.equal(result.provider_errors[0].provider, "sec_xbrl");
});

test("Finviz failure preserves upstream seed", async () => {
  const secCandidate = blankCandidate("ABC", "Example");
  secCandidate.sources = ["sec_xbrl"];
  const failed = await new FinvizProvider(async () => {
    throw new Error("provider unavailable");
  }).seed();
  const result = appendSeed({ candidates: [secCandidate] }, failed);

  assert.deepEqual(result.candidates.map((candidate) => candidate.ticker), ["ABC"]);
  assert.equal(result.provider_errors[0].provider, "finviz");
});

test("Finviz quote links become seed tickers", () => {
  assert.deepEqual(
    parseFinvizTickers("<a href=\"quote.ashx?t=abc\">ABC</a><a href=\"quote.ashx?t=XYZ\">XYZ</a>"),
    ["ABC", "XYZ"],
  );
});

test("Finviz technical seed stays a separate discovery source", async () => {
  const result = await new FinvizTechnicalProvider(async () => (
    "<a href=\"quote.ashx?t=TREND\">TREND</a>"
  )).seed();

  assert.deepEqual(result.candidates[0].sources, ["finviz_technical"]);
  assert.match(String(result.candidates[0].screen_reasons[0]), /technical trend/);
});

test("SEC filing search adds recent research document refs", async () => {
  const secCandidate = blankCandidate("ABC", "Example");
  const submissionsUrl = SEC_SUBMISSIONS_URL.replace("{cik}", "0000001234");
  const documents = new Map<string, unknown>([
    [SEC_TICKER_INDEX_URL, fixture("sec_tickers.json")],
    [submissionsUrl, fixture("sec_submissions.json")],
  ]);
  const result = await new SECFilingSearchProvider(async (url) => documents.get(url)).enrich({
    candidates: [secCandidate],
  });

  assert.deepEqual(result.provider_errors, []);
  assert.equal(result.candidates[0].filing_refs.length, 2);
  assert.deepEqual(result.candidates[0].filing_refs[0], {
    source: "sec_submissions",
    form: "8-K",
    filed: "2026-05-10",
    report_date: "2026-05-10",
    accession: "0000001234-26-000003",
    primary_document: "abc-20260510x8k.htm",
    primary_document_description: "Current report",
    document_url: "https://www.sec.gov/Archives/edgar/data/1234/000000123426000003/abc-20260510x8k.htm",
  });
});

test("SEC filing forms can be bounded for document search", () => {
  const refs = extractSecFilingRefs(
    fixture("sec_submissions.json"),
    "0000001234",
    1,
    new Set(["10-K"]),
  );

  assert.deepEqual(refs.map((ref) => ref.form), ["10-K"]);
});

test("duplicate candidates preserve sources and conflicting metrics", () => {
  const secCandidate = blankCandidate("ABC", "Example");
  secCandidate.sources = ["sec_xbrl"];
  secCandidate.metrics = { market_cap: 10 };
  const finvizCandidate = blankCandidate("abc");
  finvizCandidate.sources = ["finviz"];
  finvizCandidate.metrics = { market_cap: 12 };
  const result = mergeSeedPayloads(
    { candidates: [secCandidate] },
    { candidates: [finvizCandidate] },
  );
  const candidate = result.candidates[0];

  assert.deepEqual(candidate.sources, ["sec_xbrl", "finviz"]);
  assert.deepEqual(candidate.metrics._conflicts, { market_cap: [10, 12] });
});

test("empty pool narrows cleanly", () => {
  const result = narrowPool(
    { ...mergeSeedPayloads({ candidates: [] }), quantsieve_reviews: [] },
    3,
  );

  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.excluded_after_narrowing, []);
});

test("agent JSON can be read from markdown wrapper", () => {
  assert.deepEqual(
    parseAgentJson({ result: { content: "```json\n{\"reviews\": []}\n```" } }),
    { reviews: [] },
  );
});

test("invalid seed payload is rejected", () => {
  assert.throws(
    () => mergeSeedPayloads({ candidates: [{ company: "Missing ticker" }] }),
    ContractError,
  );
});
