import React, { useId } from 'react';
import { ChevronDown } from 'lucide-react';

export const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export const usdCents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percentFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
export const percent = (value) => `${percentFormat.format(value)}%`;

// A typed figure with its label, an optional hint, and optionally a pair of
// unit buttons (dollars or percent, a year or a month) inside the same box.
export const CalcField = ({
  label, name, value, onChange, prefix, suffix, hint, type = 'number', placeholder,
  units, unit, onUnitChange, unitsLabel, readOnly = false,
}) => {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="studio-field calc-field">
      <label htmlFor={id}>{label}</label>
      <div className={readOnly ? 'is-read-only' : undefined}>
        {prefix && <i>{prefix}</i>}
        <input
          id={id} name={name} value={value} onChange={onChange} type={type} placeholder={placeholder} readOnly={readOnly}
          {...(type === 'number' ? { min: '0', step: 'any', inputMode: 'decimal' } : {})}
          aria-describedby={hint ? hintId : undefined}
        />
        {suffix && <i>{suffix}</i>}
        {units && (
          <span className="calc-units" role="group" aria-label={unitsLabel}>
            {units.map((option) => (
              <button
                type="button" key={option.value} aria-pressed={unit === option.value} aria-label={option.name}
                className={unit === option.value ? 'is-active' : undefined} onClick={() => onUnitChange(option.value)}
              >{option.label}</button>
            ))}
          </span>
        )}
      </div>
      {hint && <small className="studio-field__hint" id={hintId}>{hint}</small>}
    </div>
  );
};

export const CalcSelect = ({ label, name, value, onChange, children, hint }) => {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="studio-field calc-field">
      <label htmlFor={id}>{label}</label>
      <div><select id={id} name={name} value={value} onChange={onChange} aria-describedby={hint ? hintId : undefined}>{children}</select><ChevronDown /></div>
      {hint && <small className="studio-field__hint" id={hintId}>{hint}</small>}
    </div>
  );
};

// Two buttons that switch a view or a way of entering a figure.
export const Segmented = ({ label, value, onChange, options }) => (
  <div className="calc-segmented" role="group" aria-label={label}>
    {options.map((option) => (
      <button type="button" key={option.value} aria-pressed={value === option.value} className={value === option.value ? 'is-active' : undefined} onClick={() => onChange(option.value)}>{option.label}</button>
    ))}
  </div>
);

// Keeps a typed figure tidy when it is converted between units.
export const tidy = (value, digits = 2) => {
  if (!Number.isFinite(value)) return '';
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits;
  return String(rounded);
};

// On a narrow screen the results sit below the form. This strip keeps the
// headline figure in view while the visitor types, with a way down to the rest.
export const StickyTotal = ({ label, value, negative = false, targetRef }) => (
  <div className="calc-sticky-total">
    <span>{label}<strong className={negative ? 'is-negative' : undefined}>{value}</strong></span>
    <button
      type="button"
      onClick={() => {
        const panel = targetRef.current;
        if (!panel) return;
        const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        if (typeof panel.scrollIntoView === 'function') panel.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
        if (typeof panel.focus === 'function') panel.focus({ preventScroll: true });
      }}
    >See breakdown</button>
  </div>
);
