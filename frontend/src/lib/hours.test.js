import { isBusinessHours } from './hours';
import { HOURS } from './contact';

// Each case gives the moment in UTC and what the office clock in Eastern reads.
const cases = [
  ['2026-10-06T15:00:00Z', true, 'Tuesday 11:00 AM EDT'],
  ['2026-10-05T12:59:59Z', false, 'Monday 8:59 AM EDT, a minute before opening'],
  ['2026-10-05T13:00:00Z', true, 'Monday 9:00 AM EDT, opening'],
  ['2026-10-10T20:59:59Z', true, 'Saturday 4:59 PM EDT, the last minute'],
  ['2026-10-10T21:00:00Z', false, 'Saturday 5:00 PM EDT, closing'],
  ['2026-10-11T16:00:00Z', false, 'Sunday noon EDT'],
  ['2026-10-06T02:00:00Z', false, 'Monday 10:00 PM EDT, though already Tuesday in UTC'],
  ['2026-10-12T03:30:00Z', false, 'Sunday 11:30 PM EDT, though already Monday in UTC'],
  ['2026-12-01T13:59:59Z', false, 'Tuesday 8:59 AM EST, winter'],
  ['2026-12-01T14:00:00Z', true, 'Tuesday 9:00 AM EST, winter'],
  ['2026-12-01T22:00:00Z', false, 'Tuesday 5:00 PM EST, winter'],
];

test.each(cases)('%s is open=%s (%s)', (moment, expected) => {
  expect(isBusinessHours(moment)).toBe(expected);
  expect(isBusinessHours(new Date(moment))).toBe(expected);
});

test('a time that cannot be read counts as closed', () => {
  expect(isBusinessHours('not-a-time')).toBe(false);
  expect(isBusinessHours(undefined)).toBe(false);
  expect(isBusinessHours(null)).toBe(false);
});

test('the hours are the ones Gbenga set on 2026-10-05', () => {
  expect(HOURS).toEqual({
    timeZone: 'America/New_York', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    open: 9, close: 17, label: 'Monday to Saturday, 9:00 AM to 5:00 PM Eastern',
  });
});
