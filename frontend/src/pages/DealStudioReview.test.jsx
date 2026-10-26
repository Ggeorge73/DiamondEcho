import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';
import InvestmentCalculator, { exampleFactsToClear, exitCapBand, followingBands, rentalServiceFormulaIsCurrent, STRATEGY_EXAMPLE_FACTS, vacancyBand } from './InvestmentCalculator';

// The 2026-10-26 end-to-end review of Deal Studio: the loan amount buried at
// the foot of the results, example figures carried beside a typed price, bands
// left at the example's values, a rental hold typed in years, DSCR before the
// reserves lenders deduct, undisclosed rental cases, and message polish. The
// real calculation and decision code runs here; only the network and the
// Excel download are faked.
vi.mock('react-router-dom', () => ({
  MemoryRouter: ({ children }) => children,
  Link: ({ to, children, ...rest }) => require('react').createElement('a', { href: to, ...rest }, children),
  useLocation: () => ({ pathname: '/investment-calculator', search: '' }),
  useNavigate: () => vi.fn(),
}));
vi.mock('axios', () => { const axios = { get: vi.fn(), post: vi.fn() }; return { default: axios, ...axios }; });
vi.mock('../lib/dealWorkbook', () => ({ downloadDealWorkbook: vi.fn() }));

let container;
let root;

const text = () => container.textContent;
const field = (name) => container.querySelector(`[name="${name}"]`);
const button = (label) => [...container.querElementsAll?.('button') || container.querySelectorAll('button')].find((item) => item.textContent.includes(label));
const click = async (label) => { await act(async () => { button(label).click(); }); };
const setControl = async (name, value) => {
  const control = field(name);
  const proto = control.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setValue = Object.getOwnPropertyDescriptor(proto, 'value').set;
  await act(async () => {
    setValue.call(control, value);
    control.dispatchEvent(new Event(control.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
};
const runBase = async () => {
  await act(async () => { button('Run base analysis').click(); });
  await act(async () => { await Promise.resolve(); });
};
const tile = (label) => [...container.querySelectorAll('.studio-metrics article')].find((item) => item.querySelector('small').textContent === label);
const financing = () => [...container.querySelectorAll('.studio-financing article')].map((item) => item.textContent);
const bandState = () => [...container.querySelectorAll('.studio-band-state li')].map((item) => item.textContent);

// The rural fixer from the flip review: 90% of the price plus the whole rehab
// budget on a hard-money loan at 11% with 2 points, interest only.
const fixer = {
  purchasePrice: '93000', closingCosts: '3000', dueDiligenceCosts: '2000', initialCapex: '0', holdMonths: '7',
  ltv: '90', interestRate: '11', interestOnlyMonths: '7', loanTermYears: '1', originationFee: '2', rehabFinanced: '100',
  arv: '250000', rehabCost: '85000', rehabContingency: '15', monthlyHolding: '450', otherProjectCosts: '4000', sellingCosts: '7',
};

beforeEach(async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  axios.get.mockResolvedValue({ data: { suggestions: [], provider: 'curated' } });
  container = document.createElement('div');
  document.body.appendChild(container);
  process.env.REACT_APP_BACKEND_URL = '';
  root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><InvestmentCalculator /></MemoryRouter>); });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.clearAllMocks();
});

describe('the financing card on the fix and flip decision', () => {
  test('loan, cash required, points and monthly interest sit under the headline cards, not only in the model output', async () => {
    await click('Fix & flip');
    for (const [name, value] of Object.entries(fixer)) await setControl(name, value);
    await runBase();
    const cards = financing();
    expect(cards).toHaveLength(4);
    // $168,700 = 90% of $93,000 plus 100% of the $85,000 budget.
    const loan = 93000 * 0.9 + 85000;
    expect(cards[0]).toBe('LOAN AMOUNT$168,70090% of the purchase price plus 100% of the rehab budget');
    // Price + closing + due diligence + rehab with contingency + other costs + points, less the loan.
    const cost = 93000 + 3000 + 2000 + 85000 * 1.15 + 4000;
    const cash = cost + loan * 0.02 - loan;
    expect(cards[1]).toContain(`CASH REQUIRED AT CLOSING$${Math.round(cash).toLocaleString('en-US')}`);
    expect(cards[2]).toBe('ORIGINATION FEE$3,3742 points on the loan');
    const monthly = loan * 0.11 / 12;
    expect(cards[3]).toBe(`MONTHLY INTEREST$${Math.round(monthly).toLocaleString('en-US')}Interest only at 11%; $${Math.round(monthly * 7).toLocaleString('en-US')} of interest over the 7-month hold`);
    // The financing row comes right after the four headline cards.
    const rows = [...container.querySelectorAll('.studio-decision-kpis')];
    expect(rows[1].classList.contains('studio-financing')).toBe(true);
    expect(rows[0].textContent).toContain('MAXIMUM OFFER');
    // The loan amount is still in the transparent model output as well.
    expect(tile('Loan amount').textContent).toContain('$168,700');
  });

  test('an amortizing loan shows a payment, and no loan says so', async () => {
    await click('Fix & flip');
    await setControl('interestOnlyMonths', '0');
    await runBase();
    expect(financing()[3]).toContain('MONTHLY PAYMENT');
    expect(financing()[3]).toContain('Principal and interest at 6.75%');
    await setControl('ltv', '0');
    await runBase();
    expect(financing()[0]).toBe('LOAN AMOUNTNoneNo loan: the deal is all cash');
    expect(financing()[2]).toBe('ORIGINATION FEE$0No loan');
    expect(financing()[3]).toBe('MONTHLY INTEREST$0No loan');
  });
});

describe('the Monte Carlo bands follow the boxes they are about', () => {
  test('the vacancy and exit-cap bands follow typed figures, and the state is shown', async () => {
    expect(bandState()).toEqual([
      'Interest-rate band: follows the interest rate you entered (6.75%).',
      'Vacancy band: follows the vacancy you entered (5%).',
      'Exit-cap band: follows the exit cap rate you entered (6.5%).',
    ]);
    await setControl('vacancy', '8');
    expect([field('mcVacancyMin').value, field('mcVacancyMode').value, field('mcVacancyMax').value]).toEqual(['6', '9', '17']);
    await setControl('exitCap', '7');
    expect([field('mcExitCapMin').value, field('mcExitCapMode').value, field('mcExitCapMax').value]).toEqual(['6.25', '7.25', '8.5']);
    await setControl('interestRate', '7');
    expect([field('mcInterestMin').value, field('mcInterestMode').value, field('mcInterestMax').value]).toEqual(['6', '7', '8.75']);
    // A band the visitor sets stops following, says so, and can follow again.
    await setControl('mcVacancyMode', '12');
    await setControl('vacancy', '4');
    expect(field('mcVacancyMode').value).toBe('12');
    expect(bandState()[1]).toContain('Vacancy band: set by you; the vacancy box no longer moves it.');
    await click('Follow the vacancy again');
    expect([field('mcVacancyMin').value, field('mcVacancyMode').value, field('mcVacancyMax').value]).toEqual(['2', '5', '13']);
    expect(bandState()[1]).toBe('Vacancy band: follows the vacancy you entered (4%).');
  });

  test('the review\'s path: a rate typed on the flip tab, then a rate typed on the rental tab, is what the simulation uses', async () => {
    await click('Fix & flip');
    await setControl('interestRate', '11');
    expect(field('mcInterestMode').value).toBe('11');
    expect(bandState()).toEqual(['Interest-rate band: follows the interest rate you entered (11%).']);
    await click('Rental & commercial');
    expect(field('mcInterestMode').value).toBe('11');
    await setControl('interestRate', '7');
    expect([field('mcInterestMin').value, field('mcInterestMode').value, field('mcInterestMax').value]).toEqual(['6', '7', '8.75']);
    expect(bandState()[0]).toBe('Interest-rate band: follows the interest rate you entered (7%).');
  });

  test('the band helpers', () => {
    expect(vacancyBand('5')).toEqual({ mcVacancyMin: '3', mcVacancyMode: '6', mcVacancyMax: '14' });
    expect(vacancyBand('1')).toEqual({ mcVacancyMin: '0', mcVacancyMode: '2', mcVacancyMax: '10' });
    expect(vacancyBand('70')).toEqual({ mcVacancyMin: '68', mcVacancyMode: '71', mcVacancyMax: '75' });
    expect(vacancyBand('')).toBeNull();
    expect(exitCapBand('6.5')).toEqual({ mcExitCapMin: '5.75', mcExitCapMode: '6.75', mcExitCapMax: '8' });
    expect(exitCapBand('0.5')).toEqual({ mcExitCapMin: '0.1', mcExitCapMode: '0.75', mcExitCapMax: '2' });
    expect(followingBands({ interestRate: '7', vacancy: '5', exitCap: '6.5' }, new Set(['mcVacancyMode']))).toEqual({
      mcInterestMin: '6', mcInterestMode: '7', mcInterestMax: '8.75', mcExitCapMin: '5.75', mcExitCapMode: '6.75', mcExitCapMax: '8',
    });
  });
});

describe('a rental hold typed in years', () => {
  test('the hold box says how many years it is, and a hold under a year offers the years instead', async () => {
    expect(text()).toContain('5 years. Rentals are usually held for years; this box is in months.');
    expect(container.querySelector('.studio-inline-actions--warn')).toBeNull();
    await setControl('holdMonths', '5');
    const warning = container.querySelector('.studio-inline-actions--warn');
    expect(warning.getAttribute('role')).toBe('alert');
    expect(warning.textContent).toContain('A 5-month hold is unusual for a rental');
    await click('Use 5 years (60 months)');
    expect(field('holdMonths').value).toBe('60');
    expect(container.querySelector('.studio-inline-actions--warn')).toBeNull();
    // A short hold run anyway is said in the result's notes.
    await setControl('holdMonths', '5');
    await runBase();
    expect(text()).toContain('Year-one operating metrics are annualized from a holding period shorter than 12 months.');
    // Flips and land are in months by nature: no years hint there.
    await click('Fix & flip');
    expect(text()).not.toContain('this box is in months');
    expect(container.querySelector('.studio-inline-actions--warn')).toBeNull();
  });
});

describe('DSCR before and after reserves', () => {
  test('both coverages are reported, and the hurdle follows the basis chosen', async () => {
    await runBase();
    expect(tile('DSCR (on NOI)').textContent).toContain('1.45');
    expect(tile('DSCR after reserves & TI').textContent).toContain('1.18');
    let hurdles = [...container.querySelectorAll('.studio-hurdle-grid article')].map((item) => item.textContent);
    expect(hurdles[1]).toContain('DSCR1.45×');
    expect([...container.querySelectorAll('.studio-scenario-row--head span')].map((cell) => cell.textContent)).toEqual(['Case', 'NOI', 'CoC', 'DSCR', 'IRR']);
    await setControl('dscrBasis', 'after_reserves');
    await runBase();
    hurdles = [...container.querySelectorAll('.studio-hurdle-grid article')].map((item) => item.textContent);
    expect(hurdles[1]).toContain('DSCR after reserves1.18×');
    expect(hurdles[1].startsWith('DSCR after reserves')).toBe(true);
    expect([...container.querySelectorAll('.studio-scenario-row--head span')].map((cell) => cell.textContent)).toEqual(['Case', 'NOI', 'CoC', 'DSCR after reserves', 'IRR']);
    expect(text()).toContain('1.20× DSCR after reserves');
    expect(text()).toContain('Debt-service hurdle, on NOI after replacement reserves and TI, leasing and capital costs');
  });

  test('the rental cases are disclosed under the table', async () => {
    await runBase();
    expect(text()).toContain('Downside: rent and other income 10% lower, vacancy 3 points higher, operating expenses, reserves and TI 10% higher, initial capital work 25% higher, interest 0.5 points higher, and the exit cap rate 0.75 points higher (or the expected sale price 10% lower). Upside: rent and other income 10% higher, vacancy 2 points lower');
  });
});

describe('polish', () => {
  test('a validation message names the box as the page does, without a field key or the safe-integer limit', async () => {
    await click('Fix & flip');
    await setControl('rehabCost', '-5');
    await runBase();
    expect(container.querySelector('.studio-error').textContent).toContain('Rehabilitation budget cannot be negative.');
    expect(text()).not.toContain('9007199254740991');
    expect(text()).not.toContain('rehabCost');
    await setControl('rehabCost', '65000');
    await click('Land development');
    await setControl('rentableSquareFeet', '0');
    await runBase();
    expect(container.querySelector('.studio-error').textContent).toContain('Buildable square feet must be greater than 0.');
  });

  test('the land tab says what the schedule boxes do and what the contingency covers', async () => {
    await click('Land development');
    expect(text()).toContain('The budget is spent evenly over these months from closing, and the facility drawn as it is spent.');
    expect(text()).toContain('Sales fall evenly in the last months of the hold and repay the facility first. 0 means one sale in the final month.');
    expect(text()).toContain('On site work and hard construction only; soft costs, permits, remediation and the fee carry none.');
    // The two boxes now move the figures.
    await runBase();
    const even = container.querySelector('.studio-result__verdict').textContent;
    await setControl('developmentMonths', '6');
    await setControl('absorptionMonths', '1');
    await runBase();
    expect(container.querySelector('.studio-result__verdict').textContent).not.toBe(even);
    expect(text()).toContain('The hold is 17 months longer than development plus absorption; carrying costs and interest on the drawn facility run for those months too.');
  });

  test('the example facts each tab clears beside a typed price, and the service minimum for a rental', () => {
    expect(Object.keys(STRATEGY_EXAMPLE_FACTS)).toEqual(['rental', 'flip', 'land']);
    const form = { arv: '360000', rehabCost: '65000', monthlyHolding: '1800', otherProjectCosts: '6000' };
    expect(exampleFactsToClear(form, 'flip')).toEqual(form);
    expect(exampleFactsToClear({ ...form, arv: '300000' }, 'flip')).toEqual({ rehabCost: '65000', monthlyHolding: '1800', otherProjectCosts: '6000' });
    expect(exampleFactsToClear(form, 'flip', new Set(['rehabCost']))).toEqual({ arv: '360000', monthlyHolding: '1800', otherProjectCosts: '6000' });
    // Hard construction is 0 in the land example: an empty box would look cleared, so it is left.
    expect(Object.keys(exampleFactsToClear({ siteAcres: '6', hardConstructionCost: '0', siteWorkCost: '780000' }, 'land'))).toEqual(['siteAcres', 'siteWorkCost']);
    expect(rentalServiceFormulaIsCurrent('diamond-underwriting-1.6.0')).toBe(false);
    expect(rentalServiceFormulaIsCurrent('diamond-underwriting-1.7.0')).toBe(true);
  });
});

// The second pass of the 2026-10-26 review.
describe('the second pass', () => {
  test('a flip hold longer than the loan term is an exception, and the loan is extended rather than paid from the pocket', async () => {
    await click('Fix & flip');
    await setControl('holdMonths', '13');
    await setControl('interestOnlyMonths', '12');
    await runBase();
    expect(text()).toContain('The 13-month hold is longer than the 12-month loan term, so the loan would need extending to the sale; the model extends it at the same rate.');
    expect(text()).toContain('CONDITIONAL GO — RESOLVE EXCEPTIONS');
    // Return on cash stays in the twenties, not the thirteen percent the trap gave.
    const roi = [...container.querySelectorAll('.studio-decision-kpis article')].map((item) => item.textContent).find((card) => card.startsWith('RETURN ON CASH'));
    expect(Number(roi.match(/([0-9.]+)%/)[1])).toBeGreaterThan(20);
    expect(financing()[3]).toContain('MONTHLY PAYMENT$658');
    expect(financing()[3]).toContain('Interest only for 12 months, then principal and interest, at 6.75%');
  });

  test('a land hold shorter than build plus sell-out is a hard stop, never a Go', async () => {
    await click('Land development');
    await setControl('holdMonths', '3');
    await runBase();
    expect(container.querySelector('.studio-error').textContent).toContain('Hold period must be at least the development schedule plus the absorption (24 months). Lengthen the hold or shorten the schedule.');
    expect(text()).not.toContain('CONDITIONAL GO');
    expect(text()).not.toContain('741,908');
  });

  test('a service sentence gets its capital letter', async () => {
    await act(async () => { root.unmount(); });
    process.env.REACT_APP_BACKEND_URL = 'https://example.test';
    root = createRoot(container);
    await act(async () => { root.render(<MemoryRouter><InvestmentCalculator /></MemoryRouter>); });
    axios.post.mockRejectedValueOnce({ isAxiosError: true, response: { status: 400, data: { detail: 'construction financing must leave a positive equity contribution' } } });
    await click('Land development');
    await runBase();
    expect(container.querySelector('.studio-error').textContent).toContain('Construction financing must leave a positive equity contribution');
  });
});
