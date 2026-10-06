import React, { useState } from 'react';
import { percent, usd } from './fields';

// One colour per part of the payment, always the same part. The order and the
// steps were checked with the chart palette validator against this page's
// background: every pair of parts that can sit side by side stays apart for
// colour-blind readers except taxes beside HOA or beside mortgage insurance,
// which only meet when insurance is zero. The table beside the ring names
// every part, so colour is never the only cue.
export const PART_COLORS = {
  principalInterest: '#3987e5',
  propertyTax: '#e66767',
  insurance: '#008300',
  hoa: '#c98500',
  pmi: '#d55181',
};

const SIZE = 200;
const CENTER = SIZE / 2;
const RADIUS = 78;
const THICKNESS = 20;
// Two pixels of background between neighbouring parts, measured along the ring.
const GAP_DEGREES = (2 / RADIUS) * (180 / Math.PI);

const point = (degrees) => {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return [CENTER + RADIUS * Math.cos(radians), CENTER + RADIUS * Math.sin(radians)];
};
const arc = (from, to) => {
  const [x1, y1] = point(from);
  const [x2, y2] = point(to);
  return `M ${x1.toFixed(3)} ${y1.toFixed(3)} A ${RADIUS} ${RADIUS} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(3)} ${y2.toFixed(3)}`;
};

// Turns the parts into ring segments. Parts worth nothing are left out.
export const donutSegments = (parts) => {
  const shown = parts.filter((part) => part.value > 0);
  const total = shown.reduce((sum, part) => sum + part.value, 0);
  let cursor = 0;
  return shown.map((part) => {
    const sweep = (part.value / total) * 360;
    const from = cursor;
    cursor += sweep;
    const gap = shown.length > 1 ? Math.min(GAP_DEGREES, sweep * 0.5) : 0;
    return { ...part, share: (part.value / total) * 100, from: from + gap / 2, to: cursor - gap / 2, whole: shown.length === 1 };
  });
};

const PaymentDonut = ({ parts, total }) => {
  const [active, setActive] = useState(null);
  const segments = donutSegments(parts);
  const current = segments.find((segment) => segment.key === active);
  const summary = segments.map((segment) => `${segment.label} ${usd.format(segment.value)}, ${percent(Math.round(segment.share))}`).join('; ');

  return (
    <div className="calc-donut">
      <div className="calc-donut__figure">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`Monthly payment of ${usd.format(total)} by part. ${summary}.`}>
          <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke="var(--line)" strokeWidth={THICKNESS} />
          {segments.map((segment) => (segment.whole
            ? <circle key={segment.key} cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke={PART_COLORS[segment.key]} strokeWidth={THICKNESS} onPointerEnter={() => setActive(segment.key)} onPointerLeave={() => setActive(null)} />
            : (
              <path
                key={segment.key} d={arc(segment.from, segment.to)} fill="none" stroke={PART_COLORS[segment.key]}
                strokeWidth={active === segment.key ? THICKNESS + 6 : THICKNESS} opacity={active && active !== segment.key ? 0.45 : 1}
                onPointerEnter={() => setActive(segment.key)} onPointerLeave={() => setActive(null)}
              />
            )))}
        </svg>
        <div className="calc-donut__center" aria-hidden="true">
          <strong>{usd.format(current ? current.value : total)}</strong>
          <span>{current ? `${current.label} · ${percent(Math.round(current.share))}` : 'per month'}</span>
        </div>
      </div>
      <table className="calc-legend">
        <caption>Payment breakdown</caption>
        <thead><tr><th scope="col">Part</th><th scope="col">Per month</th><th scope="col">Share</th></tr></thead>
        <tbody>
          {/* Every figure the ring shows on hover is already in these rows, so they are not extra keyboard stops. */}
          {segments.map((segment) => (
            <tr
              key={segment.key} className={active === segment.key ? 'is-active' : undefined}
              onPointerEnter={() => setActive(segment.key)} onPointerLeave={() => setActive(null)}
            >
              <th scope="row"><i style={{ background: PART_COLORS[segment.key] }} />{segment.label}</th>
              <td>{usd.format(segment.value)}</td>
              <td>{percent(Math.round(segment.share))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><th scope="row">Total</th><td>{usd.format(total)}</td><td>100%</td></tr></tfoot>
      </table>
    </div>
  );
};

export default PaymentDonut;
