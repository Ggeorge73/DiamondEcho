import React, { useState } from 'react';
import { usd } from './fields';

// Blue for the two totals, orange for what comes off, green for what comes
// back. These three steps stay apart for colour-blind readers in any pairing
// (checked with the chart palette validator against this page's background),
// and every row is also named and signed in text.
const KIND_LABELS = { total: 'Totals', deduction: 'Deductions', credit: 'Credits to you' };

// Where each bar sits on a scale that runs from the lowest figure reached
// (zero, or a shortfall below it) to the highest.
export const waterfallLayout = (steps) => {
  const edges = steps.flatMap((step) => [step.start, step.end]);
  const low = Math.min(0, ...edges);
  const high = Math.max(0, ...edges);
  const span = high - low || 1;
  return {
    zero: ((0 - low) / span) * 100,
    rows: steps.map((step) => ({
      ...step,
      left: ((Math.min(step.start, step.end) - low) / span) * 100,
      width: (Math.abs(step.end - step.start) / span) * 100,
      runningTotal: step.end,
    })),
  };
};

const signed = (row) => {
  if (row.kind === 'total') return row.end < 0 ? `−${usd.format(Math.abs(row.end))}` : usd.format(row.end);
  return `${row.kind === 'credit' ? '+' : '−'}${usd.format(row.amount)}`;
};

const ProceedsWaterfall = ({ steps }) => {
  const [active, setActive] = useState(null);
  const { rows, zero } = waterfallLayout(steps);
  const kinds = ['total', 'deduction', 'credit'].filter((kind) => rows.some((row) => row.kind === kind));
  const current = rows.find((row) => row.key === active);

  return (
    <div className="calc-waterfall">
      <ul className="calc-waterfall__key" aria-label="What the bar colours mean">
        {kinds.map((kind) => <li key={kind}><i className={`calc-bar--${kind}`} />{KIND_LABELS[kind]}</li>)}
      </ul>
      <ol className="calc-waterfall__rows" aria-label="From the sale price to your net proceeds, step by step">
        {rows.map((row) => (
          <li
            key={row.key} tabIndex={0}
            className={[`calc-waterfall__row calc-waterfall__row--${row.kind}`, row.key === 'net' && row.end < 0 ? 'is-shortfall' : '', active === row.key ? 'is-active' : ''].filter(Boolean).join(' ')}
            onPointerEnter={() => setActive(row.key)} onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(row.key)} onBlur={() => setActive(null)}
          >
            <span className="calc-waterfall__label">{row.label}</span>
            <span className="calc-waterfall__track" aria-hidden="true">
              <i className="calc-waterfall__zero" style={{ left: `${zero}%` }} />
              <i className={`calc-waterfall__bar calc-bar--${row.key === 'net' && row.end < 0 ? 'shortfall' : row.kind}`} style={{ left: `${row.left}%`, width: `max(2px, ${row.width}%)` }} />
            </span>
            <span className="calc-waterfall__amount">{signed(row)}</span>
          </li>
        ))}
      </ol>
      <p className="calc-waterfall__detail" role="status">
        {current && current.kind !== 'total'
          ? `After ${current.label.toLowerCase()}: ${current.runningTotal < 0 ? `−${usd.format(Math.abs(current.runningTotal))}` : usd.format(current.runningTotal)} left.`
          : 'Select a row to see what is left after that line.'}
      </p>
    </div>
  );
};

export default ProceedsWaterfall;
