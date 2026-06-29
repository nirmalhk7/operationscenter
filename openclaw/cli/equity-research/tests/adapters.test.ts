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
  parseFinvizCandidates,
  parseFinvizTickers,
} from "../src/adapters.js";
import { narrowReviewPool, parseAgentJson, publishFinalReport } from "../src/agent-turns.js";
import { ContractError, blankCandidate } from "../src/contracts.js";
import {
  scoreOwnerEarningsQuality,
  scoreBalanceSheetSafety,
  scoreEarningsYield,
  rankOpportunities,
} from "../src/value-engine.js";

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
  assert.equal(candidate.metrics.return_on_equity, 0.1);
  assert.equal(candidate.metrics.liabilities_to_equity, 0.6667);
  assert.equal(candidate.metrics.owner_earnings_proxy, 130);
  assert.equal(candidate.metrics.shares_outstanding, 25);
  assert.equal(candidate.metrics.stock_repurchases, 20);
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

test("Finviz stock links and boxover tickers become seed tickers", () => {
  assert.deepEqual(
    parseFinvizTickers(
      "<a href=\"stock?t=abcb&ty=c&p=d&b=1\">ABCB</a><td data-boxover-ticker=\"ADUS\">",
    ),
    ["ABCB", "ADUS"],
  );
});

test("Finviz screener rows add discovery market metrics", () => {
  const html = `
    <tr>
      <td>1</td><td><a href="quote.ashx?t=opp">OPP</a></td><td>Opportunity Corp</td>
      <td>Industrials</td><td>Tools</td><td>USA</td><td>1.25B</td><td>9.8</td><td>14.20</td>
      <td>1.1%</td><td>350K</td>
    </tr>`;

  const [candidate] = parseFinvizCandidates(html, "finviz", "value seed");

  assert.equal(candidate.ticker, "OPP");
  assert.equal(candidate.company, "Opportunity Corp");
  assert.equal(candidate.metrics.market_cap, 1_250_000_000);
  assert.equal(candidate.metrics.pe_ratio, 9.8);
  assert.equal(candidate.metrics.price, 14.2);
});

test("Finviz redesigned screener rows add discovery market metrics", () => {
  const html = `
    <tr class="styled-row">
      <td>2</td>
      <td data-boxover-ticker="ABCB" data-boxover-company="Ameris Bancorp" data-boxover-value="5.88B">
        <a href="stock?t=ABCB&ty=c&p=d&b=1" class="tab-link">ABCB</a>
      </td>
      <td><a href="stock?t=ABCB&ty=c&p=d&b=1">Ameris Bancorp</a></td>
      <td>Financial</td><td>Banks - Regional</td><td>USA</td>
      <td>5.88B</td><td>13.74</td><td>87.36</td><td>-0.26%</td><td>461,482</td>
    </tr>`;

  const [candidate] = parseFinvizCandidates(html, "finviz", "value seed");

  assert.equal(candidate.ticker, "ABCB");
  assert.equal(candidate.company, "Ameris Bancorp");
  assert.equal(candidate.metrics.market_cap, 5_880_000_000);
  assert.equal(candidate.metrics.pe_ratio, 13.74);
  assert.equal(candidate.metrics.price, 87.36);
});

test("Finviz technical seed stays a separate discovery source", async () => {
  const result = await new FinvizTechnicalProvider(async () => (
    "<a href=\"stock?t=TREND&ty=c&p=d&b=1\">TREND</a>"
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
  const result = narrowReviewPool(
    { ...mergeSeedPayloads({ candidates: [] }), first_pass_reviews: [] },
    3,
  );

  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.excluded_after_narrowing, []);
});

test("value engine computes explicit earnings-yield balance-sheet-safety owner-earnings-quality scorecards", () => {
  const candidate = blankCandidate("VAL", "Value Corp");
  candidate.metrics = {
    market_cap: 1_000_000_000,
    operating_income: 120_000_000,
    current_assets: 700_000_000,
    current_liabilities: 250_000_000,
    liabilities: 500_000_000,
    stockholders_equity: 800_000_000,
    cash_and_equivalents: 100_000_000,
    short_term_debt: 25_000_000,
    long_term_debt: 125_000_000,
    property_plant_equipment_net: 300_000_000,
    pe_ratio: 12,
    price_to_book: 1.2,
    return_on_equity: 0.18,
    net_margin: 0.14,
    owner_earnings_proxy: 90_000_000,
    net_income: 100_000_000,
    liabilities_to_equity: 0.625,
    stock_repurchases: 10_000_000,
  };
  candidate.filing_refs = [
    { form: "10-K", filed: "2026-02-10", accession: "1" },
    { form: "10-Q", filed: "2026-05-10", accession: "2" },
    { form: "8-K", filed: "2026-05-20", accession: "3" },
  ];

  const result = scoreOwnerEarningsQuality(scoreBalanceSheetSafety(scoreEarningsYield({ candidates: [candidate] })));
  const metrics = result.candidates[0].metrics;

  assert.equal((metrics.earnings_yield_scorecard as Record<string, unknown>).earnings_yield, 0.1143);
  assert.equal((metrics.balance_sheet_safety as Record<string, unknown>).current_ratio, 2.8);
  assert.equal((metrics.owner_earnings_quality as Record<string, unknown>).owner_earnings_conversion, 0.9);
  assert.equal((metrics.opportunity_scorecard as Record<string, unknown>).status, "pass");
  assert.equal((metrics.value_composite as Record<string, unknown>).status, "pass");
});

test("rank opportunities uses scorecards and review rejects", () => {
  const strong = blankCandidate("AAA");
  strong.metrics = {
    market_cap: 1_000_000_000,
    operating_income: 120_000_000,
    current_assets: 700_000_000,
    current_liabilities: 250_000_000,
    liabilities: 500_000_000,
    stockholders_equity: 800_000_000,
    cash_and_equivalents: 100_000_000,
    long_term_debt: 125_000_000,
    property_plant_equipment_net: 300_000_000,
    pe_ratio: 12,
    price_to_book: 1.2,
    return_on_equity: 0.18,
    net_margin: 0.14,
    owner_earnings_proxy: 90_000_000,
    net_income: 100_000_000,
    liabilities_to_equity: 0.625,
  };
  strong.filing_refs = [
    { form: "10-K", filed: "2026-02-10", accession: "1" },
    { form: "10-Q", filed: "2026-05-10", accession: "2" },
    { form: "8-K", filed: "2026-05-20", accession: "3" },
  ];
  const rejected = blankCandidate("BBB");
  rejected.metrics = { ...strong.metrics, operating_income: 180 };
  rejected.filing_refs = strong.filing_refs;

  const result = rankOpportunities({
    candidates: [rejected, strong],
    first_pass_reviews: [{
      ticker: "BBB",
      verdict: "reject",
      bull_case: [],
      bear_case: [],
      disqualifiers: ["Rejected in first-pass review."],
      required_checks: [],
      confidence: "high",
    }],
  }, 2);

  assert.deepEqual(result.candidates.map((candidate) => candidate.ticker), ["AAA"]);
});

test("large caps are not excluded when a real opportunity signal exists", () => {
  const candidate = blankCandidate("BIG");
  candidate.metrics = {
    market_cap: 200_000_000_000,
    operating_income: 30_000_000_000,
    current_assets: 80_000_000_000,
    current_liabilities: 30_000_000_000,
    liabilities: 90_000_000_000,
    stockholders_equity: 150_000_000_000,
    cash_and_equivalents: 20_000_000_000,
    long_term_debt: 10_000_000_000,
    property_plant_equipment_net: 40_000_000_000,
    pe_ratio: 8,
    price_to_book: 1.1,
    return_on_equity: 0.2,
    net_margin: 0.18,
    owner_earnings_proxy: 24_000_000_000,
    net_income: 25_000_000_000,
    liabilities_to_equity: 0.6,
  };
  candidate.filing_refs = [
    { form: "10-K", filed: "2026-02-10", accession: "1" },
    { form: "10-Q", filed: "2026-05-10", accession: "2" },
    { form: "8-K", filed: "2026-05-20", accession: "3" },
  ];

  const result = rankOpportunities({ candidates: [candidate] }, 1);
  const opportunity = result.candidates[0].metrics.opportunity_scorecard as Record<string, unknown>;

  assert.equal(opportunity.status, "pass");
  assert.equal(opportunity.crowding_penalty, true);
  assert.deepEqual(opportunity.opportunity_type, [
    "cheap_earnings",
    "asset_value",
    "owner_earnings",
    "special_situation",
  ]);
});

test("Victor finalizer fails closed when required gates are missing", () => {
  const candidate = blankCandidate("HALF");
  candidate.metrics = {
    earnings_yield_scorecard: { status: "pass" },
    balance_sheet_safety: { status: "pass" },
  };

  const result = publishFinalReport({
    candidates: [candidate],
    provider_errors: [],
    generated_at: "2026-05-25T00:00:00.000Z",
  });

  assert.equal(result.mode, "docket");
  assert.equal(result.selected_ticker, null);
  assert.match(result.body_markdown, /Pipeline Incomplete|did not complete all required gates/);
  assert.ok(result.missing_evidence.some((item) => String(item).includes("first_pass_reviews missing")));
  assert.ok(result.missing_evidence.some((item) => String(item).includes("Missing deterministic")));
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
