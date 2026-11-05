// Why the Monte Carlo median usually sits below the base analysis (item 5 of
// the 2026-11-05 review). Each band is a triangular distribution whose mean is
// (low + mode + high) / 3. Where that mean is worse than the figure the base
// analysis uses, the band leans to the downside; where it is better, to the
// upside. The page says which, in the band's own figures, instead of leaving a
// visitor to wonder why "typical" looks so much worse than "base".
const n = (value) => (value === '' || value == null || !Number.isFinite(Number(value)) ? 0 : Number(value));
const mean = (low, mode, high) => (n(low) + n(mode) + n(high)) / 3;
const fixed = (value) => Number(value.toFixed(2)).toLocaleString('en-US', { maximumFractionDigits: 2 });
const points = (value) => `${fixed(Math.abs(value))} point${Math.abs(value) === 1 ? '' : 's'}`;
const months = (value) => `${fixed(Math.abs(value))} month${Math.abs(value) === 1 ? '' : 's'}`;
// Differences smaller than this are centred, not a lean.
const TOLERANCE = 0.005;

export const simulationLean = (form) => {
  const downside = [];
  const upside = [];
  const lean = (delta, worseWhenHigher, worse, better) => {
    if (Math.abs(delta) < TOLERANCE) return;
    if ((delta > 0) === worseWhenHigher) downside.push(worse(Math.abs(delta)));
    else upside.push(better(Math.abs(delta)));
  };
  const interest = mean(form.mcInterestMin, form.mcInterestMode, form.mcInterestMax) - n(form.interestRate);
  if (form.strategy === 'rental') {
    lean(mean(form.mcRentMin, form.mcRentMode, form.mcRentMax), false,
      (d) => `rent averages ${fixed(d)}% below the rent you entered`, (d) => `rent averages ${fixed(d)}% above the rent you entered`);
    lean(mean(form.mcVacancyMin, form.mcVacancyMode, form.mcVacancyMax) - n(form.vacancy), true,
      (d) => `vacancy averages ${points(d)} above the ${fixed(n(form.vacancy))}% you entered`, (d) => `vacancy averages ${points(d)} below the ${fixed(n(form.vacancy))}% you entered`);
    lean(mean(form.mcExpenseMin, form.mcExpenseMode, form.mcExpenseMax), true,
      (d) => `operating expenses average ${fixed(d)}% above those you entered`, (d) => `operating expenses average ${fixed(d)}% below those you entered`);
    if (!(n(form.explicitSalePrice) > 0)) {
      lean(mean(form.mcExitCapMin, form.mcExitCapMode, form.mcExitCapMax) - n(form.exitCap), true,
        (d) => `the exit cap rate averages ${points(d)} above the ${fixed(n(form.exitCap))}% you entered`, (d) => `the exit cap rate averages ${points(d)} below the ${fixed(n(form.exitCap))}% you entered`);
    }
  } else {
    const thing = form.strategy === 'land' ? 'the exit value' : 'the after-repair value';
    const costs = form.strategy === 'land' ? 'development costs' : 'the rehab';
    const contingency = n(form.strategy === 'land' ? form.landContingency : form.rehabContingency);
    lean(mean(form.mcArvMin, form.mcArvMode, form.mcArvMax), false,
      (d) => `${thing} averages ${fixed(d)}% below the figure you entered`, (d) => `${thing} averages ${fixed(d)}% above the figure you entered`);
    // The draw replaces the contingency, so the base analysis is a draw equal to it.
    lean(mean(form.mcRehabMin, form.mcRehabMode, form.mcRehabMax) - contingency, true,
      (d) => `${costs} average ${fixed(d)} points over budget beyond the ${fixed(contingency)}% contingency the base analysis spends`, (d) => `${costs} average ${fixed(d)} points under the ${fixed(contingency)}% contingency the base analysis spends`);
    lean(mean(form.mcHoldMin, form.mcHoldMode, form.mcHoldMax), true,
      (d) => `the hold averages ${months(d)} longer than the one you entered`, (d) => `the hold averages ${months(d)} shorter than the one you entered`);
  }
  lean(interest, true,
    (d) => `the interest rate averages ${points(d)} above the ${fixed(n(form.interestRate))}% you entered`, (d) => `the interest rate averages ${points(d)} below the ${fixed(n(form.interestRate))}% you entered`);
  return { downside, upside };
};
