// Contact details supplied by Gbenga for publication (DE-17). Change them here
// only; every page that shows a phone number or inbox reads this file.
export const OFFICE = Object.freeze({
  name: 'Georgia office',
  addressLines: ['8735 Dunwoody Place', 'GA 30350, USA'],
  phone: '(678) 516-9717',
  phoneHref: 'tel:+16785169717',
  email: 'realtor@diamondecho.com',
  emailHref: 'mailto:realtor@diamondecho.com',
});

// The firm DiamondEcho operates under, confirmed by Gbenga on 2026-10-04 (DE-17).
// Georgia Real Estate Commission Rule 520-1-.09 asks that the firm's name and
// the firm's telephone number appear on every page, at least as prominently as
// the licensee's own. Wherever OFFICE.phone is shown, show these first.
export const BROKERAGE = Object.freeze({
  name: 'Virtual Properties Realty.com',
  phone: '(770) 495-5050',
  phoneHref: 'tel:+17704955050',
});

// Business hours set by Gbenga on 2026-10-05 (DE-31). Requests are accepted at
// any hour; replies are sent inside these hours. They are Eastern time whatever
// clock the visitor's device keeps. Change them here only.
export const HOURS = Object.freeze({
  timeZone: 'America/New_York',
  days: Object.freeze(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']),
  open: 9,
  close: 17,
  label: 'Monday to Saturday, 9:00 AM to 5:00 PM Eastern',
});
