import { HOURS } from './contact';

const clock = new Intl.DateTimeFormat('en-US', {
  timeZone: HOURS.timeZone, weekday: 'short', hour: 'numeric', hourCycle: 'h23',
});

// Whether the office is open at this moment, by the office's own clock. A time
// that cannot be read counts as closed, so that a visitor is never told a reply
// is nearer than it is. Public holidays are not known here.
export const isBusinessHours = (when) => {
  const date = when instanceof Date ? when : new Date(when);
  if (!Number.isFinite(date.getTime())) return false;
  const parts = Object.fromEntries(clock.formatToParts(date).map((part) => [part.type, part.value]));
  const hour = Number(parts.hour);
  return HOURS.days.includes(parts.weekday) && hour >= HOURS.open && hour < HOURS.close;
};
