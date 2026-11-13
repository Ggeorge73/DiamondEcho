// The Intelligence calculators: the three pages (Deal Studio, mortgage
// simulator, seller net sheet) and the analysis service behind Deal Studio.
//
// This module makes the ONE POST the monitor is allowed to make:
// POST /api/v1/deals/analyze. It is a pure calculation: it stores nothing,
// calls no paid provider and is not rate limited (backend/tests/
// test_route_limits.py, "the everyday analysis route is not limited"). The
// heavy routes beside it (/scenarios, /sensitivity, /monte-carlo) are limited
// per sender and are never called from here.
import { request, toCheck, firstProblem, expectStatus, expectType, jsonOrNull } from "../lib/http.mjs";
import { pagesFor, checkPage } from "./pages.mjs";

export const suites = ["fast", "post-deploy"];

// A small fix-and-flip with no loan: the request of
// test_flip_profit_includes_all_equity_costs in
// backend/tests/deal_intelligence/test_engine.py, which asserts the profit
// below. Fixed figures in, one known figure out:
//   320,000 sale - 19,200 selling costs (6%)
//   - 200,000 price - 5,000 closing - 44,000 rehab with 10% contingency
//   - 6,000 holding (6 months) - 1,000 other = 44,800
// If a formula change moves this figure on purpose, that test changes with it:
// change the figure here in the same pull request.
export const ANALYZE_REQUEST = Object.freeze({
  strategy: "flip",
  property: { property_type: "single_family" },
  acquisition: { purchase_price: 200_000, closing_costs: 5_000, hold_months: 6 },
  flip: { after_repair_value: 320_000, rehab_cost: 40_000, rehab_contingency_rate: 0.1, monthly_holding_costs: 1_000, other_project_costs: 1_000 },
  exit: { selling_cost_rate: 0.06 },
});
export const EXPECTED_FLIP_PROFIT = 44_800;
const FORMULA = /^diamond-underwriting-\d+\.\d+\.\d+$/;

export function analysisProblem(body) {
  if (!body || typeof body !== "object") return "The answer is not JSON.";
  if (typeof body.formula_version !== "string" || !FORMULA.test(body.formula_version)) return "The answer carries no formula version.";
  const profit = body.metrics?.flip_profit?.value;
  if (typeof profit !== "number" || Math.abs(profit - EXPECTED_FLIP_PROFIT) > 0.005) {
    return `The reference deal's profit came back as ${typeof profit === "number" ? profit.toFixed(2) : "nothing"}, expected ${EXPECTED_FLIP_PROFIT.toFixed(2)} (formula ${body.formula_version.slice(0, 40)}).`;
  }
  return "";
}

export async function run(ctx) {
  const checks = [];
  for (const page of pagesFor("calculators")) checks.push((await checkPage(ctx, page)).check());

  // sev3, not sev2: when the service is down or wrong, Deal Studio calculates
  // in the browser and says so. The visitor still gets figures.
  const analysis = await request(ctx, `${ctx.targets.apiOrigin}/api/v1/deals/analyze`, {
    method: "POST", retries: 1,
    headers: { "Content-Type": "application/json", Origin: ctx.targets.publicOrigin },
    body: JSON.stringify(ANALYZE_REQUEST),
  });
  checks.push(toCheck(
    { id: "calculators-api-analyze", name: "Deal analysis service returns the reference figures", component: "calculators", severity: "sev3", slis: ["api-availability"] },
    analysis, firstProblem(analysis, [
      expectStatus(200),
      expectType("application/json"),
      (result) => analysisProblem(jsonOrNull(result.body)),
    ])));
  return checks;
}
