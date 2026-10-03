// Turns a Monte Carlo result into the counts and notes shown beside it, so a
// probability is never displayed without the sample it was measured on.
const count = (value) => Number(value).toLocaleString('en-US');
const known = (value) => Number.isFinite(value);

export const scenarioDisclosure = (scenario, summary, metricLabel) => {
  const completed = scenario.iterations_completed;
  const requested = known(scenario.iterations_requested) ? scenario.iterations_requested : null;
  const excluded = known(scenario.failed_iterations) ? scenario.failed_iterations : null;
  const sample = known(summary?.sample_size) ? summary.sample_size : null;

  const counts = [];
  if (requested !== null) counts.push(`Requested ${count(requested)}`);
  counts.push(`Completed ${count(completed)}`);
  if (excluded !== null) counts.push(`Excluded ${count(excluded)}`);
  counts.push(sample === null
    ? `Valid for ${metricLabel} not reported`
    : `Valid for ${metricLabel} ${count(sample)}`);

  const notes = [];
  if (requested !== null && requested > completed + (excluded || 0)) {
    notes.push(`Only ${count(completed + (excluded || 0))} of the ${count(requested)} requested iterations were run.`);
  }
  if (excluded) notes.push(`${count(excluded)} iterations were excluded because the sampled inputs produced invalid economics.`);
  const lossesWithoutIrr = known(summary?.loss_without_irr_count) ? summary.loss_without_irr_count : 0;
  if (lossesWithoutIrr > 0) {
    notes.push(`${count(lossesWithoutIrr)} losing iterations had no solvable ${metricLabel}. They are counted as losses, using the annual return implied by cash returned over cash invested (-100% when nothing came back).`);
  }
  if (sample !== null && sample < completed) {
    notes.push(`${count(completed - sample)} completed iterations had no defined ${metricLabel} and are left out of the figures above.`);
  }

  const denominator = sample === null
    ? 'valid sample size not reported'
    : sample === 0
      ? `no valid ${metricLabel} results`
      : `${count(Math.round(summary.probability_above_zero * sample))} of ${count(sample)} valid results`;

  return { counts, notes, denominator, sample };
};

// The counts above already state caps and exclusions, so the engine's own
// sentence about them is dropped only when that count is present to replace it.
const coveredByCounts = (scenario) => (warning) => (
  (known(scenario.failed_iterations) && /iterations were excluded because/i.test(warning))
  || (known(scenario.iterations_requested) && /simulation capped at/i.test(warning))
);

// Warnings repeated in every case are shown once; the rest stay with their case.
export const splitWarnings = (scenarios) => {
  const lists = scenarios.map((scenario) => (Array.isArray(scenario.warnings) ? scenario.warnings : [])
    .filter((warning) => !coveredByCounts(scenario)(warning)));
  const common = lists.length ? lists[0].filter((warning) => lists.every((list) => list.includes(warning))) : [];
  return { common, perScenario: lists.map((list) => list.filter((warning) => !common.includes(warning))) };
};
