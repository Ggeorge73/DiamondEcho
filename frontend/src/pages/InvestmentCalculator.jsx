import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle, ArrowRight, BarChart3, Building2, CheckCircle2, ChevronDown,
  CircleDollarSign, Database, Download, FileSpreadsheet, Home, KeyRound, Loader2,
  LandPlot, MapPin, RotateCcw, ShieldCheck, Sparkles, TrendingUp, Wallet
} from 'lucide-react';
import MortgageSimulator from '../components/calculators/MortgageSimulator';
import SellerNetSheet from '../components/calculators/SellerNetSheet';
import '../components/calculators/calculators.css';
import { analyzeDealLocally, BROWSER_MONTE_CARLO_ITERATION_CAP, runMonteCarloInBrowser } from '../lib/dealAnalysis';
import { scenarioDisclosure, splitWarnings } from '../lib/monteCarloDisclosure';
import { buildDecision, LAND_CHECKLIST_ITEMS, RENTAL_EVIDENCE_ITEMS } from '../lib/dealDecision';
import { classifyFloodZone } from '../lib/floodZone';
import { downloadDealWorkbook } from '../lib/dealWorkbook';
import { buildDealRequest } from '../lib/dealRequest';
import {
  MONTE_CARLO_VACANCY_CAP_PERCENT, responseErrorMessage, validateDealForm,
  validateMonteCarloForm, validateMonteCarloScenarios,
} from '../lib/dealValidation';
import { buildMonteCarloScenarios, MONTE_CARLO_CASES } from '../lib/monteCarloCases';
import { resolveListingContext } from '../lib/listingContext';
import { toolFromSearch } from '../lib/intelligenceTools';
import { applyPropertyAutofill, prepareAddressEdit, preparePropertyChange } from '../lib/propertyAutofill';

// Monte Carlo runs in the visitor's browser, a block at a time (DE-25). The
// analysis service stops a simulation at a 20-second budget, which on its one
// processor was about 3,400 of 5,000 iterations per rental case; the browser
// finishes every choice on this form in a few seconds and reports progress.

// The land residual changed in service formula 1.1.0. Until the service is on
// it, a land analysis is calculated on this device so the page never shows the
// older figure beside the Go / No-Go decision.
const LAND_SERVICE_FORMULA_MINIMUM = [1, 1];
export const landServiceFormulaIsCurrent = (version) => {
  const match = /(\d+)\.(\d+)\.\d+$/.exec(String(version || ''));
  if (!match) return true; // not a version this page can read: leave the result alone
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return major > LAND_SERVICE_FORMULA_MINIMUM[0] || (major === LAND_SERVICE_FORMULA_MINIMUM[0] && minor >= LAND_SERVICE_FORMULA_MINIMUM[1]);
};

const INTELLIGENCE_TOOLS = [
  { key: 'deal', to: '/investment-calculator', label: 'Deal Studio', audience: 'For investors', icon: BarChart3 },
  { key: 'mortgage', to: '/investment-calculator?tool=mortgage', label: 'Mortgage simulator', audience: 'For buyers', icon: KeyRound },
  { key: 'net-proceeds', to: '/investment-calculator?tool=net-proceeds', label: 'Seller net sheet', audience: 'For sellers', icon: Wallet },
];
const TOOL_HERO = {
  deal: {
    eyebrow: 'DIAMOND ECHO DEAL ANALYSIS',
    title: <>Underwrite with<br /><em>absolute clarity.</em></>,
    seal: <>FORMULA VERSION<br />1.1 · MONTE CARLO</>,
  },
  mortgage: {
    eyebrow: 'DIAMOND ECHO BUYER TOOLS',
    title: <>Know the payment<br /><em>before the offer.</em></>,
    text: 'Estimate what a home costs each month: principal and interest, property taxes, insurance, association fees and mortgage insurance, from the figures you enter.',
    seal: <>AN ESTIMATE<br />NOT A LOAN OFFER</>,
  },
  'net-proceeds': {
    eyebrow: 'DIAMOND ECHO SELLER TOOLS',
    title: <>See what you keep<br /><em>after closing.</em></>,
    text: 'Estimate your net proceeds: the sale price less your mortgage payoff, commission, closing costs, Georgia transfer tax, concessions and prorations, from the figures you enter.',
    seal: <>AN ESTIMATE<br />NOT A CLOSING STATEMENT</>,
  },
};

const ASSET_TYPE_LABELS = {
  single_family: 'Single-family', condo: 'Condominium', multifamily: 'Multifamily', office: 'Office',
  retail: 'Retail', industrial: 'Industrial', mixed_use: 'Mixed-use', hospitality: 'Hospitality', land: 'Lot / land',
};
const STRATEGY_LABELS = { rental: 'Rental & commercial', flip: 'Fix & flip', land: 'Land development' };

const MARKET_OPTIONS = [
  'Atlanta, GA', 'Austin, TX', 'Boston, MA', 'Charlotte, NC', 'Chicago, IL',
  'Dallas, TX', 'Denver, CO', 'Houston, TX', 'Las Vegas, NV', 'Los Angeles, CA',
  'Miami, FL', 'Nashville, TN', 'New York, NY', 'Orlando, FL', 'Philadelphia, PA',
  'Phoenix, AZ', 'Raleigh, NC', 'San Antonio, TX', 'San Diego, CA',
  'San Francisco, CA', 'Seattle, WA', 'Tampa, FL', 'Washington, DC',
];

const initialForm = {
  address: '', strategy: 'rental', propertyType: 'multifamily', market: 'Atlanta, GA',
  units: '12', rentableSquareFeet: '18000', purchasePrice: '3000000',
  closingCosts: '75000', dueDiligenceCosts: '25000', initialCapex: '125000', holdMonths: '60',
  ltv: '65', interestRate: '6.75', amortizationYears: '30', interestOnlyMonths: '0',
  loanTermYears: '10', originationFee: '1', annualRent: '360000', otherIncome: '18000',
  vacancy: '5', propertyTaxes: '54000', insurance: '24000', repairsMaintenance: '18000',
  utilities: '12000', payrollAdmin: '18000', managementFee: '4', reserves: '30000',
  annualBelowNoiCosts: '10000', incomeGrowth: '3', expenseGrowth: '3', exitCap: '6.5',
  explicitSalePrice: '',
  arv: '4200000', rehabCost: '450000', rehabContingency: '10', monthlyHolding: '7500',
  otherProjectCosts: '50000', sellingCosts: '6', discountRate: '10', mcIterations: '2500',
  targetCashOnCash: '8', minimumDscr: '1.2', targetIrr: '15', preliminaryMarketCeiling: '',
  maxImmediateCapex: '', maxAnnualTaxes: '', maxAnnualInsurance: '',
  // The land example: twelve finished lots on six acres, sold as lots. Like
  // every starting figure on this page it is an illustration, and the page
  // says so. The figures the land tab shares with the other two tabs are in
  // LAND_EXAMPLE_SHARED below.
  developmentType: 'finished_lots', dispositionStrategy: 'sell_finished_lots',
  siteAcres: '6', parcelCount: '1', currentZoning: '', proposedZoning: '',
  entitlementStatus: 'unentitled', utilityStatus: 'verify', accessStatus: 'verify',
  environmentalStatus: 'phase_i_required', geotechnicalStatus: 'not_started', floodZone: '',
  wetlandsAcres: '0', developmentMonths: '12', absorptionMonths: '12', siteWorkCost: '780000',
  hardConstructionCost: '0', softCosts: '110000', permitsImpactFees: '60000',
  environmentalRemediation: '0', developerFee: '60000', landContingency: '10',
  annualCarryingCosts: '12000', expectedTerminalValue: '2280000', stabilizedNoi: '0',
  stabilizedExitCap: '0', targetProfitMargin: '20',
  mcRentMin: '-10', mcRentMode: '2', mcRentMax: '10', mcVacancyMin: '3',
  mcVacancyMode: '6', mcVacancyMax: '14', mcExpenseMin: '-3', mcExpenseMode: '3',
  mcExpenseMax: '15', mcExitCapMin: '5.75', mcExitCapMode: '6.75', mcExitCapMax: '8',
  mcInterestMin: '5.75', mcInterestMode: '6.75', mcInterestMax: '8.5',
  mcArvMin: '-15', mcArvMode: '0', mcArvMax: '10', mcRehabMin: '0',
  mcRehabMode: '10', mcRehabMax: '30',
};

// DE-37. The price, closing costs, hold period and loan terms are one set of
// boxes for all three tabs, and they start as an apartment-building example: a
// $3,000,000 purchase held for five years. Read as a land deal that was a
// $2.76 million loss before the visitor had typed anything. So while those
// boxes still hold untouched example figures, opening the Land development tab
// swaps in the land example's, and leaving it puts the building's back. A
// figure the visitor typed, or one loaded for an address, is never swapped.
// No value here may be empty: an empty box is what "cleared for an address"
// looks like, and a cleared box must never be filled with an example.
export const LAND_EXAMPLE_SHARED = Object.freeze({
  purchasePrice: '375000', closingCosts: '15000', initialCapex: '0', holdMonths: '24',
  interestOnlyMonths: '24', loanTermYears: '2',
});

const SHARED_EXAMPLE_LABELS = {
  purchasePrice: 'purchase price', closingCosts: 'closing costs', initialCapex: 'initial capital work',
  holdMonths: 'hold period', interestOnlyMonths: 'interest-only period', loanTermYears: 'loan term',
};

// Which of the shared boxes to change when moving between tabs, and to what.
export const exampleSwap = (form, fromStrategy, toStrategy, entered = new Set()) => {
  if ((fromStrategy === 'land') === (toStrategy === 'land')) return {};
  const [from, to] = toStrategy === 'land' ? [initialForm, LAND_EXAMPLE_SHARED] : [LAND_EXAMPLE_SHARED, initialForm];
  return Object.fromEntries(Object.keys(LAND_EXAMPLE_SHARED)
    .filter((field) => !entered.has(field) && form[field] === from[field])
    .map((field) => [field, to[field]]));
};

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

const Field = ({ label, name, value, onChange, prefix, suffix, type = 'number', min = '0', step = 'any', placeholder, hint }) => (
  <label className="studio-field">
    <span>{label}</span>
    <div>{prefix && <i>{prefix}</i>}<input name={name} value={value} onChange={onChange} type={type} min={min} step={step} placeholder={placeholder} />{suffix && <i>{suffix}</i>}</div>
    {hint && <small className="studio-field__hint">{hint}</small>}
  </label>
);

const SelectField = ({ label, name, value, onChange, children }) => (
  <label className="studio-field">
    <span>{label}</span>
    <div><select name={name} value={value} onChange={onChange}>{children}</select><ChevronDown /></div>
  </label>
);

const AutocompleteField = ({ label, name, value, onChange, suggestions, onSelect, placeholder, icon: Icon }) => (
  <label className="studio-field studio-autocomplete">
    <span>{label}</span>
    <div>{Icon && <Icon />}<input name={name} value={value} onChange={onChange} type="text" autoComplete="off" placeholder={placeholder} /></div>
    {value.length > 0 && suggestions.length > 0 && (
      <div className="studio-suggestions" role="listbox">
        {suggestions.map((suggestion) => (
          <button type="button" role="option" key={suggestion.id || suggestion.label} onMouseDown={(event) => event.preventDefault()} onClick={() => onSelect(suggestion)}>
            <MapPin /><span><strong>{suggestion.label}</strong><small>{suggestion.provider === 'mapbox' ? 'Live address result' : suggestion.kind === 'market' ? 'Market' : suggestion.provider === 'demo' ? 'Illustrative deal example' : 'Address for analysis'}</small></span>
          </button>
        ))}
      </div>
    )}
  </label>
);

const InvestmentCalculator = () => {
  const location = useLocation();
  const navigate = useNavigate();
  // Keyed on the listing part of the address only, so that moving between the
  // three tools does not reset the Deal Studio form.
  const listingParam = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.has('listing') ? `?listing=${encodeURIComponent(params.get('listing'))}` : '';
  }, [location.search]);
  const listingContext = useMemo(() => resolveListingContext(listingParam), [listingParam]);
  const tool = toolFromSearch(location.search);
  // A buyer or seller tool is built the first time it is opened and then kept,
  // so what the visitor typed is still there when they come back to it.
  const [openedTools, setOpenedTools] = useState(() => new Set([tool]));
  useEffect(() => {
    setOpenedTools((current) => (current.has(tool) ? current : new Set([...current, tool])));
  }, [tool]);
  const [form, setForm] = useState(initialForm);
  const [result, setResult] = useState(null);
  const [analysisSnapshot, setAnalysisSnapshot] = useState(null);
  const [decision, setDecision] = useState(null);
  const [evidence, setEvidence] = useState(() => Object.fromEntries([...RENTAL_EVIDENCE_ITEMS, ...LAND_CHECKLIST_ITEMS].map((item) => [item.key, false])));
  const [monteCarlo, setMonteCarlo] = useState(null);
  const [riskProgress, setRiskProgress] = useState(null);
  // Says what the page changed on the visitor's behalf, so nothing changes silently.
  const [notice, setNotice] = useState(null);
  const [addressLookupAvailable, setAddressLookupAvailable] = useState(false);
  const [error, setError] = useState('');
  const [riskError, setRiskError] = useState('');
  const [loading, setLoading] = useState(false);
  const [riskLoading, setRiskLoading] = useState(false);
  const [propertyLoading, setPropertyLoading] = useState(false);
  const [propertyRecord, setPropertyRecord] = useState(null);
  const [propertyProvenance, setPropertyProvenance] = useState({});
  const [propertyReviewFields, setPropertyReviewFields] = useState([]);
  const [propertySourceLabel, setPropertySourceLabel] = useState('');
  const [addressSuggestions, setAddressSuggestions] = useState([]);
  const [marketSuggestions, setMarketSuggestions] = useState([]);
  const [resultMode, setResultMode] = useState('base');
  const analysisGeneration = useRef(0);
  const propertyLookupGeneration = useRef(0);
  const skipNextContextReset = useRef(false);
  // Fields the visitor typed or chose themselves; typing an address keeps these.
  const enteredFields = useRef(new Set());
  // The asset type in use before the Land development tab, to return to.
  const lastBuiltType = useRef(null);
  const resultsRef = useRef(null);
  const backendUrl = useMemo(() => (process.env.REACT_APP_BACKEND_URL || '').replace(/\/$/, ''), []);
  const sessionToken = useMemo(() => globalThis.crypto?.randomUUID?.() || `session-${Date.now()}`, []);

  const n = (value) => Number(value || 0);
  const rate = (value) => n(value) / 100;

  const invalidateAnalysis = () => {
    analysisGeneration.current += 1;
    setResult(null);
    setAnalysisSnapshot(null);
    setDecision(null);
    setMonteCarlo(null);
    setResultMode('base');
    setError('');
    setRiskError('');
    setLoading(false);
    setRiskLoading(false);
    setRiskProgress(null);
  };

  // Bring the results into view when a run starts: on a phone they sit below
  // the form, and on a desktop the results column keeps its own scroll position.
  const revealResults = () => {
    // After the running state has been drawn, so the position is measured on
    // the page as the visitor will see it.
    window.setTimeout(() => {
      const panel = resultsRef.current;
      if (!panel) return;
      panel.scrollTop = 0;
      // In view means its top sits below the fixed header and in the upper
      // part of the screen. Beside the form on a wide screen that is normally
      // so and the page stays put; at the very end of the form the panel is
      // pushed up under the header, and the page moves just enough to show it.
      const box = panel.getBoundingClientRect?.();
      const viewport = window.innerHeight || 0;
      const visible = box && box.top >= 72 && box.top < viewport * 0.6;
      if (!visible && typeof panel.scrollIntoView === 'function') {
        const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        panel.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
      }
      if (typeof panel.focus === 'function') panel.focus({ preventScroll: true });
    }, 0);
  };

  const clearListingRoute = () => {
    if (listingContext.kind !== 'manual') {
      skipNextContextReset.current = true;
      navigate('/investment-calculator', { replace: true });
    }
  };

  useEffect(() => {
    const clean = form.address.trim().toLowerCase();
    if (!clean) { setAddressSuggestions([]); return undefined; }
    setAddressSuggestions([]);
    const timer = window.setTimeout(async () => {
      try {
        const { data } = await axios.get(`${backendUrl}/api/v1/properties/suggest`, {
          params: { q: form.address, session_token: sessionToken },
        });
        // Only real address results belong under the address box. Without an
        // address provider the service answers with market names, and picking
        // one of those would start a property lookup that cannot succeed.
        const live = data?.provider === 'mapbox' && Array.isArray(data?.suggestions);
        setAddressLookupAvailable(Boolean(live));
        setAddressSuggestions(live ? data.suggestions.slice(0, 8) : []);
      } catch { setAddressSuggestions([]); }
    }, 325);
    return () => window.clearTimeout(timer);
  }, [backendUrl, form.address, sessionToken]);

  useEffect(() => {
    const clean = form.market.trim().toLowerCase();
    if (!clean) { setMarketSuggestions([]); return; }
    setMarketSuggestions(MARKET_OPTIONS.filter((market) => market.toLowerCase().startsWith(clean) || market.toLowerCase().includes(clean)).slice(0, 8).map((market) => ({ id: market, label: market, kind: 'market', provider: 'curated' })));
  }, [form.market]);

  const update = (event) => {
    const { name, value } = event.target;
    if (name === 'address') {
      propertyLookupGeneration.current += 1;
      invalidateAnalysis();
      const hadRecord = Boolean(propertyRecord);
      setPropertyRecord(null);
      setPropertyReviewFields([]);
      setPropertySourceLabel('');
      setPropertyLoading(false);
      clearListingRoute();
      // Keep what the visitor entered; clear what they did not (DE-25).
      const { form: next, cleared } = prepareAddressEdit(form, value, [...enteredFields.current]);
      setPropertyProvenance((current) => Object.fromEntries(Object.entries(current).filter(([, details]) => details.source === 'Your input')));
      setForm(next);
      if (Object.keys(cleared).length) {
        const kept = enteredFields.current.size;
        setNotice({
          text: `${hadRecord ? 'The details loaded for the previous address' : 'The example figures'} were cleared, because they are not facts about this address.${kept ? ` The ${kept === 1 ? 'figure' : `${kept} figures`} you entered ${kept === 1 ? 'was' : 'were'} kept.` : ''} The asset type and strategy were not changed.`,
          restore: hadRecord ? null : cleared,
        });
      }
      return;
    }
    if (name === 'propertyType' && value === 'land' && form.strategy !== 'land') {
      switchStrategy('land', { chosenType: true });
      return;
    }
    if (name === 'propertyType' && value !== 'land' && form.strategy === 'land') {
      // Lot / land is the only asset type the Land development tab analyses.
      enteredFields.current.add('propertyType');
      switchStrategy('rental', { chosenType: value });
      return;
    }
    invalidateAnalysis();
    enteredFields.current.add(name);
    setPropertyProvenance((current) => ({ ...current, [name]: { source: 'Your input', description: 'Entered for this analysis; verify before relying on it' } }));
    setForm((current) => ({ ...current, [name]: value }));
  };

  const restoreCleared = () => {
    if (!notice?.restore) return;
    const restored = notice.restore;
    invalidateAnalysis();
    // Putting them back is the visitor's choice, so they now count as entered.
    Object.keys(restored).forEach((field) => enteredFields.current.add(field));
    setForm((current) => ({ ...current, ...restored }));
    setNotice({ text: 'The example figures are back. They are illustrations, not facts about this address; replace each one with a verified figure.', restore: null });
  };

  // Lot / land is analysed only on the Land development tab, so the asset type
  // and the tab move together. Whenever one moves the other, the page says so,
  // and leaving the land tab returns to the asset type in use before it.
  const switchStrategy = (strategy, { chosenType } = {}) => {
    if (strategy === form.strategy) return;
    invalidateAnalysis();
    const previousType = form.propertyType;
    let nextType = previousType;
    if (strategy === 'land') {
      if (previousType !== 'land') lastBuiltType.current = previousType;
      nextType = 'land';
    } else if (typeof chosenType === 'string') {
      nextType = chosenType;
    } else if (previousType === 'land') {
      nextType = lastBuiltType.current || (strategy === 'flip' ? 'single_family' : 'multifamily');
    }
    if (nextType !== previousType) {
      setPropertyProvenance((current) => ({ ...current, propertyType: { source: 'Your input', description: 'Selected for this analysis; verify against the property' } }));
    }
    // Untouched example figures follow the tab; anything entered stays (DE-37).
    const swapped = exampleSwap(form, form.strategy, strategy, enteredFields.current);
    const swappedNames = Object.keys(swapped).map((field) => SHARED_EXAMPLE_LABELS[field]).join(', ');
    const swapNote = !swappedNames ? ''
      : !('purchasePrice' in swapped)
        // Only some boxes still held examples (the rest were typed, or cleared for an address): name them.
        ? ` These example figures, which you had not changed, were set ${strategy === 'land' ? 'for a land deal' : 'back for a building'}: ${swappedNames}.`
        : strategy === 'land'
          ? ' The example figures you had not changed are now a land example (twelve finished lots on six acres). They are illustrations, not facts about any property.'
          : ' The example figures you had not changed are the building example again.';
    let message = '';
    if (chosenType === true) {
      message = `Moved to the ${STRATEGY_LABELS.land} tab, because ${ASSET_TYPE_LABELS.land} is analysed there. Your figures were kept.`;
    } else if (typeof chosenType === 'string') {
      message = `Moved to the ${STRATEGY_LABELS[strategy]} tab, because the ${STRATEGY_LABELS.land} tab only analyses ${ASSET_TYPE_LABELS.land}. Your figures were kept.`;
    } else if (nextType !== previousType) {
      message = strategy === 'land'
        ? `Asset type set to ${ASSET_TYPE_LABELS.land} for the ${STRATEGY_LABELS.land} tab. It returns to ${ASSET_TYPE_LABELS[previousType] || previousType} when you leave this tab.`
        : `Asset type set back to ${ASSET_TYPE_LABELS[nextType] || nextType}, because ${ASSET_TYPE_LABELS.land} is analysed only on the ${STRATEGY_LABELS.land} tab. Change it in "Asset type" if that is not right.`;
    }
    if (message || swapNote) setNotice({ text: `${message}${swapNote}`.trim(), restore: null });
    setForm((current) => ({ ...current, ...swapped, strategy, propertyType: nextType }));
  };

  useEffect(() => {
    if (skipNextContextReset.current) {
      skipNextContextReset.current = false;
      return;
    }
    propertyLookupGeneration.current += 1;
    invalidateAnalysis();
    setPropertyLoading(false);
    setAddressSuggestions([]);
    setMarketSuggestions([]);

    setPropertyRecord(null);
    setPropertyProvenance({});
    setPropertyReviewFields([]);
    setPropertySourceLabel('');
    enteredFields.current = new Set();
    lastBuiltType.current = null;
    setNotice(null);
    setForm(listingContext.kind === 'missing'
      ? preparePropertyChange(initialForm)
      : initialForm);
  }, [listingContext]);

  const applyProperty = (record) => {
    const autofill = applyPropertyAutofill(form, record);
    setPropertyRecord(record);
    setForm(autofill.form);
    setPropertyProvenance(autofill.provenance);
    setPropertyReviewFields(autofill.reviewFields);
    setPropertySourceLabel(autofill.sourceLabel);
    setAddressSuggestions([]);
  };

  const selectAddress = async (suggestion) => {
    const lookupGeneration = ++propertyLookupGeneration.current;
    invalidateAnalysis();
    setPropertyRecord(null);
    setPropertyProvenance({});
    setPropertyReviewFields([]);
    setPropertySourceLabel('');
    setPropertyLoading(false);
    // A property picked from the list is a different property: start clean.
    enteredFields.current = new Set();
    setNotice({ text: 'A property was chosen from the list, so the figures for the previous one were cleared.', restore: null });
    setForm((current) => preparePropertyChange(current, suggestion.label));
    setAddressSuggestions([]);
    clearListingRoute();
    setPropertyLoading(true); setError('');
    try {
      const { data } = await axios.get(`${backendUrl}/api/v1/properties/lookup`, { params: { address: suggestion.label } });
      if (lookupGeneration === propertyLookupGeneration.current) applyProperty(data.property);
    } catch (lookupError) {
      // The service's own message names its settings; visitors get plain words.
      if (lookupGeneration === propertyLookupGeneration.current) setError(lookupError.response?.status === 404 && /No property record/i.test(String(lookupError.response?.data?.detail || ''))
        ? 'No public record was found for that address. Enter the property\'s figures yourself.'
        : 'Public-record details are not available for that address. Enter the property\'s figures yourself.');
    } finally {
      if (lookupGeneration === propertyLookupGeneration.current) setPropertyLoading(false);
    }
  };

  const buildRequest = () => {
    validateDealForm(form);
    return buildDealRequest(form);
  };

  const analyze = async (event) => {
    event.preventDefault();
    const generation = ++analysisGeneration.current;
    setLoading(true); setError(''); setRiskError(''); setResult(null); setDecision(null); setMonteCarlo(null); setRiskProgress(null); setResultMode('base');
    setAnalysisSnapshot(null);
    revealResults();
    let request;
    try {
      request = buildRequest();
      let analysis;
      if (!backendUrl) analysis = analyzeDealLocally(request);
      else {
        const { data } = await axios.post(`${backendUrl}/api/v1/deals/analyze`, request);
        // A service still on the older land formula: calculate here instead.
        analysis = data?.strategy === 'land' && !landServiceFormulaIsCurrent(data.formula_version)
          ? analyzeDealLocally(request)
          : data;
      }
      if (generation === analysisGeneration.current) {
        setResult(analysis);
        setAnalysisSnapshot({ form: { ...form }, request, result: analysis });
        setDecision(buildDecision({ form, evidence }));
      }
    } catch (requestError) {
      if (generation === analysisGeneration.current) setError(responseErrorMessage(requestError, 'The analysis could not be completed. Review the assumptions and try again.'));
    } finally { if (generation === analysisGeneration.current) setLoading(false); }
  };

  // How far each case stretches the entered worst-case values.
  const caseScale = (caseName) => (caseName === 'Severe stress' ? 1.75 : caseName === 'Downside case' ? 1.25 : 1);

  const scenarioDrivers = (caseName) => {
    const downside = caseName === 'Downside case';
    const scale = caseScale(caseName);
    if (form.strategy === 'rental') return {
      rent_change: { minimum: rate(n(form.mcRentMin) * scale), mode: rate(form.mcRentMode), maximum: rate(form.mcRentMax) },
      vacancy_rate: { minimum: rate(form.mcVacancyMin), mode: rate(n(form.mcVacancyMode) * (downside ? 1.2 : 1)), maximum: Math.min(MONTE_CARLO_VACANCY_CAP_PERCENT / 100, rate(n(form.mcVacancyMax) * scale)) },
      operating_expense_change: { minimum: rate(form.mcExpenseMin), mode: rate(form.mcExpenseMode), maximum: rate(n(form.mcExpenseMax) * scale) },
      exit_cap_rate: { minimum: rate(form.mcExitCapMin), mode: rate(n(form.mcExitCapMode) * (downside ? 1.05 : 1)), maximum: rate(n(form.mcExitCapMax) * scale) },
      interest_rate: { minimum: rate(form.mcInterestMin), mode: rate(form.mcInterestMode), maximum: rate(n(form.mcInterestMax) * scale) },
    };
    if (form.strategy === 'land') return {
      terminal_value_change: { minimum: rate(n(form.mcArvMin) * scale), mode: rate(form.mcArvMode), maximum: rate(form.mcArvMax) },
      development_cost_change: { minimum: rate(form.mcRehabMin), mode: rate(form.mcRehabMode), maximum: rate(n(form.mcRehabMax) * scale) },
      interest_rate: { minimum: rate(form.mcInterestMin), mode: rate(form.mcInterestMode), maximum: rate(n(form.mcInterestMax) * scale) },
    };
    return {
      after_repair_value_change: { minimum: rate(n(form.mcArvMin) * scale), mode: rate(form.mcArvMode), maximum: rate(form.mcArvMax) },
      rehab_cost_change: { minimum: rate(form.mcRehabMin), mode: rate(form.mcRehabMode), maximum: rate(n(form.mcRehabMax) * scale) },
      interest_rate: { minimum: rate(form.mcInterestMin), mode: rate(form.mcInterestMode), maximum: rate(n(form.mcInterestMax) * scale) },
    };
  };

  const runRiskAnalysis = async () => {
    const generation = ++analysisGeneration.current;
    setRiskLoading(true); setRiskError(''); setMonteCarlo(null); setRiskProgress(null); setResultMode('risk');
    revealResults();
    try {
      validateMonteCarloForm(form);
      const scenarios = buildMonteCarloScenarios({ iterations: form.mcIterations, driversForCase: scenarioDrivers });
      validateMonteCarloScenarios(scenarios);
      const payload = { deal: buildRequest(), scenarios };
      const analysis = await runMonteCarloInBrowser(payload, {
        onProgress: (done, total) => { if (generation === analysisGeneration.current) setRiskProgress({ done, total }); },
        // An input changed while this was running: stop, the figures would be stale.
        shouldStop: () => generation !== analysisGeneration.current,
      });
      if (analysis && generation === analysisGeneration.current) setMonteCarlo(analysis);
    } catch (requestError) {
      if (generation === analysisGeneration.current) setRiskError(responseErrorMessage(requestError, 'Risk analysis could not be completed.'));
    } finally { if (generation === analysisGeneration.current) { setRiskLoading(false); setRiskProgress(null); } }
  };

  const exportWorkbook = () => {
    setError('');
    setResultMode('base');
    try {
      if (!analysisSnapshot || !result || resultIssue) {
        throw new Error('Run a successful base analysis with the current inputs before downloading Excel.');
      }
      downloadDealWorkbook(analysisSnapshot);
    } catch (calculationError) {
      setError(calculationError.message || 'The deal-specific workbook could not be generated. Review the assumptions and try again.');
      setResultMode('base');
    }
  };

  const metricKeys = form.strategy === 'rental'
    ? ['irr', 'cash_on_cash', 'cap_rate', 'dscr', 'noi', 'npv', 'equity_multiple', 'break_even_occupancy']
    : form.strategy === 'land'
      ? ['development_profit', 'development_roi', 'irr', 'npv', 'development_margin', 'total_development_cost', 'residual_land_value', 'break_even_terminal_value', 'cost_per_acre', 'cost_per_unit', 'cost_per_buildable_sf', 'ltc']
      : ['flip_profit', 'flip_roi', 'irr', 'npv', 'equity_multiple', 'ltv', 'ltc', 'max_offer_70_rule'];

  const displayMetric = (metric) => {
    if (!metric || metric.value === null) return '—';
    if (metric.unit?.startsWith('USD')) {
      const suffix = metric.unit.includes('/') ? ` / ${metric.unit.split('/')[1]}` : '';
      return `${money.format(metric.value)}${suffix}`;
    }
    if (metric.unit === 'decimal_rate') return `${number.format(metric.value * 100)}%`;
    if (metric.unit === 'multiple') return `${number.format(metric.value)}×`;
    return number.format(metric.value);
  };

  const labels = {
    irr: 'Projected IRR', cash_on_cash: 'Cash-on-cash', cap_rate: 'Going-in cap rate', dscr: 'DSCR',
    noi: 'Year-one NOI', npv: 'Net present value', equity_multiple: 'Equity multiple',
    break_even_occupancy: 'Break-even occupancy', flip_profit: 'Projected profit', flip_roi: 'Flip ROI',
    ltv: 'Loan-to-value', ltc: 'Loan-to-cost', max_offer_70_rule: '70% screening threshold',
    development_profit: 'Development profit', development_roi: 'Development ROI',
    development_margin: 'Development margin', total_development_cost: 'Total development cost',
    residual_land_value: 'Residual land value', break_even_terminal_value: 'Break-even terminal value',
    cost_per_acre: 'Cost per acre', cost_per_unit: 'Cost per planned unit', cost_per_buildable_sf: 'Cost per buildable sf',
  };

  const summaryFormat = (key, value) => value == null ? 'Not defined' : key === 'npv' || key === 'flip_profit' || key === 'development_profit' ? money.format(value) : key === 'equity_multiple' || key === 'dscr' ? `${number.format(value)}×` : `${number.format(value * 100)}%`;
  const resultIssue = result && (result.strategy !== form.strategy || !result.metrics || typeof result.metrics !== 'object')
    ? 'This analysis result does not match the current strategy or is incomplete. Run the base analysis again.'
    : '';
  const riskSummaryKey = form.strategy === 'rental' ? 'irr' : form.strategy === 'land' ? 'development_profit' : 'flip_profit';
  const riskWarnings = splitWarnings(Array.isArray(monteCarlo?.scenarios) ? monteCarlo.scenarios : []);
  // The stress cases scale the entered high vacancy; say so when the cap stops them.
  const stressCapNotes = (caseName) => {
    if (form.strategy !== 'rental') return [];
    const scale = caseScale(caseName);
    const scaled = n(form.mcVacancyMax) * scale;
    return scaled > MONTE_CARLO_VACANCY_CAP_PERCENT
      ? [`Vacancy high was limited to ${MONTE_CARLO_VACANCY_CAP_PERCENT}% in this case; ${number.format(n(form.mcVacancyMax))}% × ${scale} would be ${number.format(scaled)}%.`]
      : [];
  };
  const riskResultIssue = monteCarlo && (!Array.isArray(monteCarlo.scenarios) || monteCarlo.scenarios.length === 0 || monteCarlo.scenarios.some((scenario) => {
    const summary = scenario?.summaries?.[riskSummaryKey];
    return typeof scenario?.name !== 'string' || !Number.isFinite(scenario?.iterations_completed)
      || !summary || !('p50' in summary) || !('p10' in summary) || !('p90' in summary)
      || !Number.isFinite(summary.probability_above_zero);
  }))
    ? 'The risk result is incomplete for this strategy. Review the scenarios and run the analysis again.'
    : '';

  const floodZoneStatus = classifyFloodZone(form.floodZone).status;
  const floodZoneHint = floodZoneStatus === 'unrecognized'
    ? `"${form.floodZone.trim()}" is not a FEMA zone, so the flood zone is treated as not verified.`
    : floodZoneStatus === 'special' ? 'Special Flood Hazard Area.'
      : floodZoneStatus === 'not_entered' ? 'Treated as not verified until a zone is entered.' : '';

  const ActiveToolIcon = INTELLIGENCE_TOOLS.find((item) => item.key === tool).icon;

  return (
    <main className="deal-studio-page">
      <header className="deal-studio-hero">
        <div>
          <p className="eyebrow eyebrow--light"><span /> {TOOL_HERO[tool].eyebrow}</p>
          <h1>{TOOL_HERO[tool].title}</h1>
          {tool === 'deal'
            ? <p>Institutional-grade analysis for residences, income property, commercial assets, fix-and-flips, lots, and ground-up development, from the figures you enter.</p>
            : <p>{TOOL_HERO[tool].text}</p>}
        </div>
        <div className="deal-studio-hero__seal"><ActiveToolIcon /><span>{TOOL_HERO[tool].seal}</span></div>
      </header>

      <nav className="studio-tools" aria-label="Intelligence tools">
        {INTELLIGENCE_TOOLS.map(({ key, to, label, audience, icon: Icon }) => (
          <Link key={key} to={to} aria-current={tool === key ? 'page' : undefined}><Icon /><span><strong>{label}</strong><small>{audience}</small></span></Link>
        ))}
      </nav>

      {openedTools.has('mortgage') && <MortgageSimulator search={location.search} hidden={tool !== 'mortgage'} />}
      {openedTools.has('net-proceeds') && <SellerNetSheet hidden={tool !== 'net-proceeds'} />}

      <section className="deal-studio-shell" hidden={tool !== 'deal'}>
        <form className="deal-studio-form" onSubmit={analyze} noValidate>
          {listingContext.kind === 'manual' && !propertyRecord && <p className="studio-provider-note" role="status">Manual Deal Studio entry. Any prefilled numbers are illustrative, not facts about a selected listing; verify all assumptions.</p>}
          {listingContext.kind === 'missing' && <p className="studio-provider-note" role="alert">This old sample-property link is unavailable. No listing facts were loaded; enter and verify a property manually or return to Georgia MLS search.</p>}
          {propertyRecord && <div className="studio-provider-note studio-provenance-note" role="status"><strong>Input sources: {propertySourceLabel}</strong><ul>{Object.entries(propertyProvenance).map(([field, details]) => <li key={field}>{field.replace(/([A-Z])/g, ' $1')}: {details.source} — {details.description}</li>)}</ul>{propertyReviewFields.length > 0 && <p>Review and enter missing values: {propertyReviewFields.join('; ')}.</p>}</div>}
          <div className="studio-strategy" role="group" aria-label="Investment strategy">
            <button type="button" className={form.strategy === 'rental' ? 'is-active' : ''} aria-pressed={form.strategy === 'rental'} onClick={() => switchStrategy('rental')}><Building2 /> Rental & commercial</button>
            <button type="button" className={form.strategy === 'flip' ? 'is-active' : ''} aria-pressed={form.strategy === 'flip'} onClick={() => switchStrategy('flip')}><Home /> Fix & flip</button>
            <button type="button" className={form.strategy === 'land' ? 'is-active' : ''} aria-pressed={form.strategy === 'land'} onClick={() => switchStrategy('land')}><LandPlot /> Land development</button>
          </div>
          {notice && (
            <div className="studio-change-notice" role="status">
              <AlertCircle />
              <p>{notice.text}</p>
              {notice.restore && <button type="button" onClick={restoreCleared}><RotateCcw /> Put the example figures back</button>}
              <button type="button" className="studio-change-notice__dismiss" aria-label="Dismiss this note" onClick={() => setNotice(null)}>×</button>
            </div>
          )}

          <fieldset>
            <legend><span>01</span> Property intelligence</legend>
            <div className="studio-property-search">
              <AutocompleteField label="Property address" name="address" value={form.address} onChange={update} suggestions={addressSuggestions} onSelect={selectAddress} placeholder="Property address" icon={MapPin} />
              {propertyLoading && <p className="studio-provider-note"><Loader2 className="spin" /> Retrieving public-record details…</p>}
              {!propertyLoading && <p className="studio-provider-note"><Database /> {addressLookupAvailable
                ? 'Choose a suggestion to load public-record details, then check each one.'
                : 'This site does not look up addresses or public records yet. Type the address for your own reference and enter the property\'s figures yourself.'}</p>}
            </div>
            {propertyRecord && (
              <div className="studio-property-card">
                <div><span>{propertyRecord.is_demo ? 'ILLUSTRATIVE DEAL EXAMPLE' : 'PUBLIC RECORD'}</span><strong>{propertyRecord.formatted_address}</strong><small>{propertyRecord.provider || 'Property data provider'}</small></div>
                <dl>
                  <div><dt>TYPE</dt><dd>{propertyRecord.property_type || 'Verify'}</dd></div>
                  <div><dt>BUILT</dt><dd>{propertyRecord.year_built || '—'}</dd></div>
                  <div><dt>SIZE</dt><dd>{propertyRecord.square_footage != null ? `${number.format(propertyRecord.square_footage)} sf` : '—'}</dd></div>
                  <div><dt>TAXES</dt><dd>{propertyRecord.annual_taxes != null ? money.format(propertyRecord.annual_taxes) : '—'}</dd></div>
                </dl>
              </div>
            )}
            <div className="studio-field-grid">
              <SelectField label="Asset type" name="propertyType" value={form.propertyType} onChange={update}>
                <option value="single_family">Single-family</option><option value="condo">Condominium</option>
                <option value="multifamily">Multifamily</option><option value="office">Office</option>
                <option value="retail">Retail</option><option value="industrial">Industrial</option>
                <option value="mixed_use">Mixed-use</option><option value="hospitality">Hospitality</option>
                <option value="land">Lot / land</option>
              </SelectField>
              <AutocompleteField label="Market" name="market" value={form.market} onChange={update} suggestions={marketSuggestions} onSelect={(item) => { invalidateAnalysis(); setPropertyProvenance((current) => ({ ...current, market: { source: 'Your input', description: 'Selected market for this analysis' } })); setForm((current) => ({ ...current, market: item.label })); setMarketSuggestions([]); }} placeholder="Type one letter" />
              <Field label={form.strategy === 'land' ? 'Planned units / lots' : 'Units'} name="units" value={form.units} onChange={update} step="1" />
              <Field label={form.strategy === 'land' ? 'Buildable square feet' : 'Rentable square feet'} name="rentableSquareFeet" value={form.rentableSquareFeet} onChange={update} suffix="sf" />
              <Field label="Purchase price" name="purchasePrice" value={form.purchasePrice} onChange={update} prefix="$" />
              <Field label="Closing costs" name="closingCosts" value={form.closingCosts} onChange={update} prefix="$" />
              <Field label="Due diligence" name="dueDiligenceCosts" value={form.dueDiligenceCosts} onChange={update} prefix="$" />
              <Field label="Initial capital work" name="initialCapex" value={form.initialCapex} onChange={update} prefix="$" />
              <Field label="Hold period" name="holdMonths" value={form.holdMonths} onChange={update} suffix="months" step="1" />
            </div>
          </fieldset>

          <fieldset>
            <legend><span>02</span> Capital structure</legend>
            <div className="studio-field-grid">
              <Field label={form.strategy === 'land' ? 'Construction loan-to-cost' : 'Loan-to-value'} name="ltv" value={form.ltv} onChange={update} suffix="%" />
              <Field label="Interest rate" name="interestRate" value={form.interestRate} onChange={update} suffix="%" />
              <Field label="Amortization" name="amortizationYears" value={form.amortizationYears} onChange={update} suffix="years" step="1" />
              <Field label="Interest-only period" name="interestOnlyMonths" value={form.interestOnlyMonths} onChange={update} suffix="months" step="1" />
              <Field label="Loan term" name="loanTermYears" value={form.loanTermYears} onChange={update} suffix="years" step="1" />
              <Field label="Origination fee" name="originationFee" value={form.originationFee} onChange={update} suffix="%" />
              <Field label="Discount rate" name="discountRate" value={form.discountRate} onChange={update} suffix="%" />
              <Field label="Selling costs" name="sellingCosts" value={form.sellingCosts} onChange={update} suffix="%" />
            </div>
          </fieldset>

          {form.strategy === 'rental' ? (
            <>
            <fieldset>
              <legend><span>03</span> Operations & exit</legend>
              <div className="studio-field-grid">
                <Field label="Annual scheduled rent" name="annualRent" value={form.annualRent} onChange={update} prefix="$" />
                <Field label="Other annual income" name="otherIncome" value={form.otherIncome} onChange={update} prefix="$" />
                <Field label="Vacancy" name="vacancy" value={form.vacancy} onChange={update} suffix="%" />
                <Field label="Property taxes" name="propertyTaxes" value={form.propertyTaxes} onChange={update} prefix="$" />
                <Field label="Insurance" name="insurance" value={form.insurance} onChange={update} prefix="$" />
                <Field label="Repairs & maintenance" name="repairsMaintenance" value={form.repairsMaintenance} onChange={update} prefix="$" />
                <Field label="Utilities" name="utilities" value={form.utilities} onChange={update} prefix="$" />
                <Field label="Payroll & administration" name="payrollAdmin" value={form.payrollAdmin} onChange={update} prefix="$" />
                <Field label="Management fee" name="managementFee" value={form.managementFee} onChange={update} suffix="%" />
                <Field label="Replacement reserves" name="reserves" value={form.reserves} onChange={update} prefix="$" />
                <Field label="TI / leasing / capital" name="annualBelowNoiCosts" value={form.annualBelowNoiCosts} onChange={update} prefix="$" />
                <Field label="Income growth" name="incomeGrowth" value={form.incomeGrowth} onChange={update} suffix="%" />
                <Field label="Expense growth" name="expenseGrowth" value={form.expenseGrowth} onChange={update} suffix="%" />
                <Field label="Exit cap rate" name="exitCap" value={form.exitCap} onChange={update} suffix="%" />
                <Field label="Expected sale price / terminal value" name="explicitSalePrice" value={form.explicitSalePrice} onChange={update} prefix="$" />
              </div>
            </fieldset>
            <fieldset className="studio-mandate">
              <legend><span>04</span> Investment mandate & evidence</legend>
              <div className="studio-field-grid">
                <Field label="Target cash-on-cash" name="targetCashOnCash" value={form.targetCashOnCash} onChange={update} suffix="%" />
                <Field label="Minimum DSCR" name="minimumDscr" value={form.minimumDscr} onChange={update} suffix="×" />
                <Field label="Target levered IRR" name="targetIrr" value={form.targetIrr} onChange={update} suffix="%" />
                <Field label="Market-value ceiling (optional)" name="preliminaryMarketCeiling" value={form.preliminaryMarketCeiling} onChange={update} prefix="$" />
                <Field label="Maximum immediate capital work" name="maxImmediateCapex" value={form.maxImmediateCapex} onChange={update} prefix="$" />
                <Field label="Maximum annual taxes" name="maxAnnualTaxes" value={form.maxAnnualTaxes} onChange={update} prefix="$" />
                <Field label="Maximum annual insurance" name="maxAnnualInsurance" value={form.maxAnnualInsurance} onChange={update} prefix="$" />
              </div>
              <div className="studio-evidence-grid">
                {RENTAL_EVIDENCE_ITEMS.map((item) => (
                  <label key={item.key} className={evidence[item.key] ? 'is-verified' : ''}>
                    <input type="checkbox" checked={Boolean(evidence[item.key])} onChange={(event) => { invalidateAnalysis(); setEvidence((current) => ({ ...current, [item.key]: event.target.checked })); }} />
                    <span>{evidence[item.key] ? <CheckCircle2 /> : <AlertCircle />}{item.label}</span>
                  </label>
                ))}
              </div>
              <p className="studio-provider-note"><ShieldCheck /> Hurdles determine the maximum investment basis. Evidence controls the confidence level; unchecked items remain diligence conditions, not assumed facts.</p>
            </fieldset>
            </>
          ) : form.strategy === 'land' ? (
            <>
            <fieldset>
              <legend><span>03</span> Land development program & feasibility</legend>
              <div className="studio-field-grid">
                <SelectField label="Development type" name="developmentType" value={form.developmentType} onChange={update}>
                  <option value="">Select / verify…</option>
                  <option value="sell_entitled_land">Entitle and sell land</option><option value="finished_lots">Finished-lot development</option>
                  <option value="single_family_subdivision">Single-family subdivision</option><option value="multifamily">Multifamily</option>
                  <option value="mixed_use">Mixed-use</option><option value="retail">Retail</option><option value="office">Office</option>
                  <option value="industrial_logistics">Industrial / logistics</option><option value="hospitality">Hospitality</option>
                  <option value="self_storage">Self-storage</option><option value="data_center">Data center</option><option value="other">Other</option>
                </SelectField>
                <SelectField label="Disposition strategy" name="dispositionStrategy" value={form.dispositionStrategy} onChange={update}>
                  <option value="">Select / verify…</option>
                  <option value="sell_entitled">Sell entitled land</option><option value="sell_finished_lots">Sell finished lots</option>
                  <option value="build_and_sell">Build and sell</option><option value="stabilize_and_sell">Stabilize and sell</option>
                  <option value="stabilize_and_hold">Stabilize and hold / refinance</option>
                </SelectField>
                <Field label="Site area" name="siteAcres" value={form.siteAcres} onChange={update} suffix="acres" />
                <Field label="Parcel count" name="parcelCount" value={form.parcelCount} onChange={update} step="1" />
                <Field label="Current zoning" name="currentZoning" value={form.currentZoning} onChange={update} type="text" min={undefined} />
                <Field label="Proposed zoning" name="proposedZoning" value={form.proposedZoning} onChange={update} type="text" min={undefined} />
                <SelectField label="Entitlement status" name="entitlementStatus" value={form.entitlementStatus} onChange={update}>
                  <option value="">Select / verify…</option>
                  <option value="unentitled">Unentitled</option><option value="rezoning_required">Rezoning required</option>
                  <option value="application_pending">Application pending</option><option value="approved_with_conditions">Approved with conditions</option>
                  <option value="fully_entitled">Fully entitled</option><option value="shovel_ready">Shovel-ready / permitted</option>
                </SelectField>
                <SelectField label="Utility availability" name="utilityStatus" value={form.utilityStatus} onChange={update}>
                  <option value="verify">Not verified</option><option value="available">Capacity confirmed at site</option>
                  <option value="extension_required">Extension / upgrade required</option><option value="unavailable">Unavailable</option>
                </SelectField>
                <SelectField label="Legal access" name="accessStatus" value={form.accessStatus} onChange={update}>
                  <option value="verify">Not verified</option><option value="legal_confirmed">Legal access confirmed</option>
                  <option value="easement_required">Easement required</option><option value="access_unavailable">No confirmed access</option>
                </SelectField>
                <SelectField label="Environmental diligence" name="environmentalStatus" value={form.environmentalStatus} onChange={update}>
                  <option value="phase_i_required">Phase I required</option><option value="clear">Phase I / environmental clear</option>
                  <option value="recognized_condition">Recognized environmental condition</option><option value="remediation_required">Remediation required</option>
                </SelectField>
                <SelectField label="Geotechnical diligence" name="geotechnicalStatus" value={form.geotechnicalStatus} onChange={update}>
                  <option value="not_started">Not started</option><option value="in_progress">In progress</option>
                  <option value="complete_suitable">Complete / suitable</option><option value="mitigation_required">Mitigation required</option>
                </SelectField>
                <Field label="FEMA flood zone" name="floodZone" value={form.floodZone} onChange={update} type="text" min={undefined} placeholder="e.g. X or AE; blank if not looked up" hint={floodZoneHint} />
                <Field label="Wetlands area" name="wetlandsAcres" value={form.wetlandsAcres} onChange={update} suffix="acres" />
                <Field label="Development schedule" name="developmentMonths" value={form.developmentMonths} onChange={update} suffix="months" step="1" />
                <Field label="Sales / lease-up absorption" name="absorptionMonths" value={form.absorptionMonths} onChange={update} suffix="months" step="1" />
                <Field label="Site work & infrastructure" name="siteWorkCost" value={form.siteWorkCost} onChange={update} prefix="$" />
                <Field label="Hard construction cost" name="hardConstructionCost" value={form.hardConstructionCost} onChange={update} prefix="$" />
                <Field label="Soft costs / A&E" name="softCosts" value={form.softCosts} onChange={update} prefix="$" />
                <Field label="Permits & impact fees" name="permitsImpactFees" value={form.permitsImpactFees} onChange={update} prefix="$" />
                <Field label="Environmental / remediation" name="environmentalRemediation" value={form.environmentalRemediation} onChange={update} prefix="$" />
                <Field label="Developer fee" name="developerFee" value={form.developerFee} onChange={update} prefix="$" />
                <Field label="Construction contingency" name="landContingency" value={form.landContingency} onChange={update} suffix="%" />
                <Field label="Annual taxes & carrying" name="annualCarryingCosts" value={form.annualCarryingCosts} onChange={update} prefix="$" />
                <Field label="Expected gross terminal value" name="expectedTerminalValue" value={form.expectedTerminalValue} onChange={update} prefix="$" />
                <Field label="Stabilized NOI (alternative)" name="stabilizedNoi" value={form.stabilizedNoi} onChange={update} prefix="$" />
                <Field label="Stabilized exit cap" name="stabilizedExitCap" value={form.stabilizedExitCap} onChange={update} suffix="%" />
              </div>
              <p className="studio-provider-note"><ShieldCheck /> Terminal value uses the explicit gross exit value first; otherwise it capitalizes stabilized NOI. Residual land value is the land price at which the deal earns exactly the target development margin.</p>
            </fieldset>
            <fieldset className="studio-mandate">
              <legend><span>04</span> Go / no-go targets & evidence</legend>
              <div className="studio-field-grid">
                <Field label="Target development margin" name="targetProfitMargin" value={form.targetProfitMargin} onChange={update} suffix="%" />
                <Field label="Target levered IRR (optional)" name="targetIrr" value={form.targetIrr} onChange={update} suffix="%" />
                <Field label="Comparable land value (optional)" name="preliminaryMarketCeiling" value={form.preliminaryMarketCeiling} onChange={update} prefix="$" />
              </div>
              <div className="studio-evidence-grid">
                {LAND_CHECKLIST_ITEMS.map((item) => (
                  <label key={item.key} className={evidence[item.key] ? 'is-verified' : ''}>
                    <input type="checkbox" checked={Boolean(evidence[item.key])} onChange={(event) => { invalidateAnalysis(); setEvidence((current) => ({ ...current, [item.key]: event.target.checked })); }} />
                    <span>{evidence[item.key] ? <CheckCircle2 /> : <AlertCircle />}{item.label}</span>
                  </label>
                ))}
              </div>
              <p className="studio-provider-note"><ShieldCheck /> The decision compares the purchase price with the highest land price that meets every target. Entitlement, utilities, access, environmental, geotechnical, and flood-zone answers above count as evidence too; anything unverified stays a condition, not an assumed fact.</p>
            </fieldset>
            </>
          ) : (
            <fieldset>
              <legend><span>03</span> Project & disposition</legend>
              <div className="studio-field-grid">
                <Field label="After-repair value" name="arv" value={form.arv} onChange={update} prefix="$" />
                <Field label="Rehabilitation budget" name="rehabCost" value={form.rehabCost} onChange={update} prefix="$" />
                <Field label="Rehab contingency" name="rehabContingency" value={form.rehabContingency} onChange={update} suffix="%" />
                <Field label="Monthly holding costs" name="monthlyHolding" value={form.monthlyHolding} onChange={update} prefix="$" />
                <Field label="Other project costs" name="otherProjectCosts" value={form.otherProjectCosts} onChange={update} prefix="$" />
              </div>
            </fieldset>
          )}

          <fieldset className="studio-monte-carlo">
            <legend><span>{form.strategy === 'flip' ? '04' : '05'}</span> Monte Carlo risk laboratory</legend>
            <div className="studio-case-picker">
              {MONTE_CARLO_CASES.map((caseName) => (
                <div key={caseName} className="is-active"><CheckCircle2 /> {caseName}</div>
              ))}
            </div>
            <p className="studio-case-note">Every run includes all three cases so the committee view is complete regardless of the result tab in focus. The simulation runs on this device and shows its progress.</p>
            {Number(form.mcIterations) > BROWSER_MONTE_CARLO_ITERATION_CAP && <p className="studio-case-note" role="note">This browser runs at most {BROWSER_MONTE_CARLO_ITERATION_CAP.toLocaleString('en-US')} iterations per case. {Number(form.mcIterations).toLocaleString('en-US')} were selected, so each case will stop at {BROWSER_MONTE_CARLO_ITERATION_CAP.toLocaleString('en-US')} and the results will say so.</p>}
            <div className="studio-field-grid">
              <SelectField label="Iterations per case" name="mcIterations" value={form.mcIterations} onChange={update}><option value="1000">1,000</option><option value="2500">2,500</option><option value="5000">5,000</option><option value="10000">10,000</option></SelectField>
              {form.strategy === 'rental' ? <>
                <Field label="Rent change · low" name="mcRentMin" value={form.mcRentMin} onChange={update} suffix="%" min="-90" />
                <Field label="Rent change · mode" name="mcRentMode" value={form.mcRentMode} onChange={update} suffix="%" min="-90" />
                <Field label="Rent change · high" name="mcRentMax" value={form.mcRentMax} onChange={update} suffix="%" min="-90" />
                <Field label="Vacancy · low" name="mcVacancyMin" value={form.mcVacancyMin} onChange={update} suffix="%" />
                <Field label="Vacancy · mode" name="mcVacancyMode" value={form.mcVacancyMode} onChange={update} suffix="%" />
                <Field label="Vacancy · high" name="mcVacancyMax" value={form.mcVacancyMax} onChange={update} suffix="%" />
                <Field label="Exit cap · low" name="mcExitCapMin" value={form.mcExitCapMin} onChange={update} suffix="%" />
                <Field label="Exit cap · mode" name="mcExitCapMode" value={form.mcExitCapMode} onChange={update} suffix="%" />
                <Field label="Exit cap · high" name="mcExitCapMax" value={form.mcExitCapMax} onChange={update} suffix="%" />
              </> : <>
                <Field label={`${form.strategy === 'land' ? 'Terminal value' : 'ARV'} change · low`} name="mcArvMin" value={form.mcArvMin} onChange={update} suffix="%" min="-90" />
                <Field label={`${form.strategy === 'land' ? 'Terminal value' : 'ARV'} change · mode`} name="mcArvMode" value={form.mcArvMode} onChange={update} suffix="%" min="-90" />
                <Field label={`${form.strategy === 'land' ? 'Terminal value' : 'ARV'} change · high`} name="mcArvMax" value={form.mcArvMax} onChange={update} suffix="%" min="-90" />
                <Field label={`${form.strategy === 'land' ? 'Development cost' : 'Rehab'} overrun · low`} name="mcRehabMin" value={form.mcRehabMin} onChange={update} suffix="%" />
                <Field label={`${form.strategy === 'land' ? 'Development cost' : 'Rehab'} overrun · mode`} name="mcRehabMode" value={form.mcRehabMode} onChange={update} suffix="%" />
                <Field label={`${form.strategy === 'land' ? 'Development cost' : 'Rehab'} overrun · high`} name="mcRehabMax" value={form.mcRehabMax} onChange={update} suffix="%" />
              </>}
            </div>
            <div className="studio-risk-actions">
              <p><TrendingUp /> Reproducible triangular distributions, percentile outcomes, downside probabilities, and excluded-iteration disclosure.</p>
              <button type="button" onClick={runRiskAnalysis} disabled={riskLoading}>{riskLoading ? <><Loader2 className="spin" /> Simulating</> : <>Run Monte Carlo <BarChart3 /></>}</button>
            </div>
          </fieldset>

          <div className="studio-submit-row">
            <p><ShieldCheck /> Every metric includes its formula, components, assumptions, warnings, and audit version.</p>
            <div className="studio-submit-actions">
              <button type="button" className="studio-download-button" onClick={exportWorkbook}><FileSpreadsheet /> Download deal-specific Excel <Download /></button>
              <button type="submit" disabled={loading}>{loading ? <><Loader2 className="spin" /> Analyzing</> : <>Run base analysis <ArrowRight /></>}</button>
            </div>
          </div>
        </form>

        <aside className="deal-studio-results" ref={resultsRef} tabIndex={-1} aria-label="Analysis results">
          <div className="deal-studio-results__head"><span><Sparkles /> INVESTMENT COMMITTEE OUTPUT</span>{result && <small>{decision?.version || result.formula_version}</small>}</div>
          <div className="studio-result-tabs"><button className={resultMode === 'base' ? 'is-active' : ''} onClick={() => setResultMode('base')}>{form.strategy === 'flip' ? 'Base case' : 'IC decision'}</button><button className={resultMode === 'risk' ? 'is-active' : ''} onClick={() => setResultMode('risk')}>Monte Carlo</button></div>
          {resultMode === 'base' && loading && (
            <div className="studio-empty studio-running" role="status"><Loader2 className="spin" /><h2>Calculating…</h2><p>Working through the figures you entered.</p></div>
          )}
          {resultMode === 'base' && !loading && !result && !error && (
            <div className="studio-empty"><CircleDollarSign /><h2>Your decision canvas</h2><p>Complete the assumptions and run an analysis. DiamondEcho will calculate returns, debt coverage, value creation, and risk signals without hidden inputs.</p></div>
          )}
          {resultMode === 'base' && error && <div className="studio-error" role="alert"><AlertCircle /><h2>Analysis needs attention</h2><p>{error}</p><button onClick={() => setError('')}><RotateCcw /> Review inputs</button></div>}
          {resultMode === 'base' && resultIssue && <div className="studio-error" role="alert"><AlertCircle /><h2>Analysis needs attention</h2><p>{resultIssue}</p><button onClick={() => { setResult(null); setDecision(null); }}><RotateCcw /> Review inputs</button></div>}
          {resultMode === 'base' && result && !resultIssue && (
            <div className="studio-result">
              {decision ? <>
                <div className={`studio-result__verdict studio-result__verdict--${decision.tone}`}>
                  <span>INVESTMENT COMMITTEE VERDICT · {decision.confidence.toUpperCase()} CONFIDENCE</span>
                  <strong>{decision.verdict}</strong>
                  <p>{decision.summary}</p>
                </div>
                {decision.strategy === 'land' ? <>
                <div className="studio-decision-kpis">
                  <article><small>MAXIMUM LAND PRICE</small><strong>{decision.recommendedMaximum ? money.format(decision.recommendedMaximum) : 'None'}</strong><p>{decision.exactMaximum ? `Exact modeled ceiling ${money.format(decision.exactMaximum)}` : 'No price meets every target'}</p></article>
                  <article><small>PRICE AGAINST THE CEILING</small><strong className={decision.gapToAsk > 0 ? 'is-negative' : 'is-positive'}>{decision.gapToAsk == null ? '—' : decision.gapToAsk > 0 ? `${money.format(decision.gapToAsk)} over` : `${money.format(Math.abs(decision.gapToAsk))} below`}</strong><p>Purchase price {money.format(decision.askingPrice)}{decision.openingRange ? ` · open at ${money.format(decision.openingRange[0])}–${money.format(decision.openingRange[1])}` : ''}</p></article>
                  <article><small>PROFIT AT THIS PRICE</small><strong className={decision.profitability.profit > 0 ? 'is-positive' : 'is-negative'}>{decision.profitability.profit == null ? '—' : money.format(decision.profitability.profit)}</strong><p>{decision.profitability.margin == null ? 'Margin not defined' : `${number.format(decision.profitability.margin * 100)}% of exit value; target ${number.format(decision.profitability.targetMargin * 100)}%`}</p></article>
                  <article><small>EVIDENCE CONFIDENCE</small><strong>{decision.confidence}</strong><p>{decision.evidenceVerified} of {decision.evidenceTotal} diligence items verified</p></article>
                </div>
                <div className="studio-decision-kpis studio-decision-kpis--minor">
                  <article><small>RETURN ON EQUITY</small><strong>{decision.profitability.roi == null ? '—' : `${number.format(decision.profitability.roi * 100)}%`}</strong><p>Profit over the cash you put in</p></article>
                  <article><small>LEVERED IRR</small><strong>{decision.profitability.irr == null ? '—' : `${number.format(decision.profitability.irr * 100)}%`}</strong><p>Annualized, on equity</p></article>
                  <article><small>BREAK-EVEN EXIT VALUE</small><strong>{decision.profitability.breakEvenTerminalValue == null ? '—' : money.format(decision.profitability.breakEvenTerminalValue)}</strong><p>Exit value entered: {money.format(decision.profitability.terminalValue)}</p></article>
                  <article><small>SAFETY CUSHION</small><strong className={decision.profitability.cushion > 0 ? 'is-positive' : 'is-negative'}>{decision.profitability.cushion == null ? '—' : `${number.format(decision.profitability.cushion * 100)}%`}</strong><p>{decision.profitability.cushion > 0 ? 'The exit value can fall this far before the deal stops making money' : 'The exit value is below break-even'}</p></article>
                </div>
                </> : (
                <div className="studio-decision-kpis">
                  <article><small>RECOMMENDED MAXIMUM</small><strong>{decision.recommendedMaximum ? money.format(decision.recommendedMaximum) : 'Not established'}</strong><p>{decision.exactMaximum ? `Exact modeled ceiling ${money.format(decision.exactMaximum)}` : 'Review return hurdles'}</p></article>
                  <article><small>GAP TO ASK</small><strong className={decision.gapToAsk > 0 ? 'is-negative' : 'is-positive'}>{decision.gapToAsk == null ? '—' : decision.gapToAsk > 0 ? `${money.format(decision.gapToAsk)} over` : `${money.format(Math.abs(decision.gapToAsk))} below`}</strong><p>Compared with {money.format(decision.askingPrice)}</p></article>
                  <article><small>OPENING RANGE</small><strong>{decision.openingRange ? `${money.format(decision.openingRange[0])}–${money.format(decision.openingRange[1])}` : '—'}</strong><p>Target no higher than {decision.recommendedMaximum ? money.format(decision.recommendedMaximum) : 'the verified ceiling'}</p></article>
                  <article><small>EVIDENCE CONFIDENCE</small><strong>{decision.confidence}</strong><p>{decision.evidenceVerified} of {decision.evidenceTotal} core files verified</p></article>
                </div>
                )}

                <section className="studio-decision-section">
                  <div className="studio-decision-section__head"><span>{decision.strategy === 'land' ? 'HIGHEST LAND PRICE THAT MEETS EACH TARGET' : 'RETURN-CONSTRAINED PRICE CEILINGS'}</span><small>{decision.strategy === 'land' ? 'The lowest one controls' : 'Lowest verified ceiling controls'}</small></div>
                  <div className="studio-ceiling-list">
                    {decision.ceilings.map((ceiling) => <div key={ceiling.key} className={ceiling.binding ? 'is-binding' : ''}><span>{ceiling.label}<small>{ceiling.source}</small></span><strong>{ceiling.value > 0 ? money.format(ceiling.value) : decision.strategy === 'land' ? 'No price works' : 'Not solved'}{ceiling.binding && <em>BINDING</em>}</strong></div>)}
                  </div>
                  <p className="studio-valuation-notice"><ShieldCheck /> {decision.valuationNotice}</p>
                </section>

                <section className="studio-decision-section">
                  <div className="studio-decision-section__head"><span>{decision.strategy === 'land' ? 'TARGETS AT THIS PRICE' : 'HURDLE TEST AT CURRENT PRICE'}</span><small>Pass / fail at stated assumptions</small></div>
                  <div className="studio-hurdle-grid">
                    {decision.hurdleResults.map((hurdle) => <article key={hurdle.label} className={hurdle.pass ? 'is-pass' : 'is-fail'}><span>{hurdle.pass ? <CheckCircle2 /> : <AlertCircle />}{hurdle.label}</span><strong>{hurdle.actual == null ? '—' : hurdle.format === 'multiple' ? `${number.format(hurdle.actual)}×` : `${number.format(hurdle.actual * 100)}%`}</strong><small>Minimum {hurdle.format === 'multiple' ? `${number.format(hurdle.target)}×` : `${number.format(hurdle.target * 100)}%`}</small></article>)}
                  </div>
                </section>

                <section className="studio-decision-section">
                  <div className="studio-decision-section__head"><span>DETERMINISTIC SCENARIOS</span><small>At the current purchase price</small></div>
                  <div className="studio-scenario-table" role="region" aria-label="Deterministic scenarios" tabIndex={0}>
                    {decision.strategy === 'land' ? <>
                      <div className="studio-scenario-row studio-scenario-row--head"><span>Case</span><span>Profit</span><span>Margin</span><span>ROI</span><span>IRR</span></div>
                      {decision.scenarios.map((scenario) => <div className="studio-scenario-row" key={scenario.name}><strong>{scenario.name}</strong><span>{scenario.metrics.profit == null ? '—' : money.format(scenario.metrics.profit)}</span><span>{scenario.metrics.margin == null ? '—' : `${number.format(scenario.metrics.margin * 100)}%`}</span><span>{scenario.metrics.roi == null ? '—' : `${number.format(scenario.metrics.roi * 100)}%`}</span><span>{scenario.metrics.irr == null ? '—' : `${number.format(scenario.metrics.irr * 100)}%`}</span></div>)}
                    </> : <>
                      <div className="studio-scenario-row studio-scenario-row--head"><span>Case</span><span>NOI</span><span>CoC</span><span>DSCR</span><span>IRR</span></div>
                      {decision.scenarios.map((scenario) => <div className="studio-scenario-row" key={scenario.name}><strong>{scenario.name}</strong><span>{money.format(scenario.metrics.noi || 0)}</span><span>{scenario.metrics.cashOnCash == null ? '—' : `${number.format(scenario.metrics.cashOnCash * 100)}%`}</span><span>{scenario.metrics.dscr == null ? '—' : `${number.format(scenario.metrics.dscr)}×`}</span><span>{scenario.metrics.irr == null ? '—' : `${number.format(scenario.metrics.irr * 100)}%`}</span></div>)}
                    </>}
                  </div>
                  {decision.scenarioNote && <p className="studio-valuation-notice">{decision.scenarioNote}</p>}
                </section>

                <section className="studio-decision-section studio-diligence">
                  <div className="studio-decision-section__head"><span>DILIGENCE CONDITIONS & WALK-AWAY TESTS</span><small>{decision.evidenceGaps.length} evidence gaps</small></div>
                  {decision.evidenceGaps.length > 0 ? decision.evidenceGaps.map((item) => <div key={item.key}><AlertCircle /><p><strong>{item.label}</strong>{item.action}</p></div>) : <div className="is-cleared"><CheckCircle2 /><p><strong>{decision.strategy === 'land' ? 'Diligence checklist complete' : 'Core evidence checklist complete'}</strong>Maintain contract protections and confirm no material change before closing.</p></div>}
                  {decision.walkAwaySignals.map((signal) => <div className="is-walk" key={signal}><AlertCircle /><p><strong>{decision.strategy === 'land' ? 'Exception to resolve' : 'Exception triggered'}</strong>{signal}</p></div>)}
                </section>
              </> : <div className="studio-result__verdict"><span>MODEL STATUS</span><strong>Analysis complete</strong><p>{result.calculation_mode === 'browser' ? 'Calculated on this device with the same transparent underwriting conventions.' : 'Acquisition, project, holding, and disposition costs have been modeled.'}</p></div>}
              <div className="studio-metric-heading"><span>TRANSPARENT MODEL OUTPUT</span><small>Formula-level detail</small></div>
              <div className="studio-metrics">
                {metricKeys.map((key) => {
                  const metric = result.metrics[key];
                  return <article key={key}><small>{labels[key]}</small><strong>{displayMetric(metric)}</strong><p>{metric?.formula}</p>{metric?.warning && <span>{metric.warning}</span>}</article>;
                })}
              </div>
              {result.warnings?.length > 0 && <div className="studio-warnings"><span>ASSUMPTIONS TO VERIFY</span>{result.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
            </div>
          )}
          {resultMode === 'risk' && (riskError || riskResultIssue) && <div className="studio-error" role="alert"><AlertCircle /><h2>Risk analysis needs attention</h2><p>{riskError || riskResultIssue}</p><button onClick={() => { setRiskError(''); setMonteCarlo(null); }}><RotateCcw /> Review scenarios</button></div>}
          {resultMode === 'risk' && riskLoading && !riskError && (
            <div className="studio-empty studio-running" role="status">
              <Loader2 className="spin" /><h2>Simulating…</h2>
              <p>{riskProgress ? `${riskProgress.done.toLocaleString('en-US')} of ${riskProgress.total.toLocaleString('en-US')} iterations across the three cases.` : 'Preparing the three cases.'}</p>
              <div className="studio-progress" role="progressbar" aria-label="Monte Carlo progress" aria-valuemin={0} aria-valuemax={riskProgress?.total || 100} aria-valuenow={riskProgress?.done || 0}><span style={{ width: `${riskProgress?.total ? Math.round((riskProgress.done / riskProgress.total) * 100) : 0}%` }} /></div>
            </div>
          )}
          {resultMode === 'risk' && !riskLoading && !monteCarlo && !riskError && <div className="studio-empty"><BarChart3 /><h2>Distribution before decision</h2><p>Run Monte Carlo to see percentile returns, downside frequency, and the range of plausible outcomes across the three cases.</p></div>}
          {resultMode === 'risk' && monteCarlo && !riskResultIssue && !riskError && <div className="studio-risk-results">
            {monteCarlo.scenarios.map((scenario, index) => {
              const summary = scenario.summaries[riskSummaryKey];
              const metricLabel = labels[riskSummaryKey] || riskSummaryKey;
              const disclosure = scenarioDisclosure(scenario, summary, metricLabel);
              const notes = [...disclosure.notes, ...riskWarnings.perScenario[index], ...stressCapNotes(scenario.name)];
              return <article key={scenario.name}><span>{scenario.name.toUpperCase()}</span><h3>{summaryFormat(riskSummaryKey, summary.p50)}</h3><p>Median {metricLabel} · {number.format(summary.probability_above_zero * 100)}% probability above zero <span className="studio-risk-denominator">({disclosure.denominator})</span></p><dl><div><dt>P10</dt><dd>{summaryFormat(riskSummaryKey, summary.p10)}</dd></div><div><dt>P50</dt><dd>{summaryFormat(riskSummaryKey, summary.p50)}</dd></div><div><dt>P90</dt><dd>{summaryFormat(riskSummaryKey, summary.p90)}</dd></div></dl><small>{disclosure.counts.join(' · ')} · seed {scenario.seed}</small>{notes.length > 0 && <ul className="studio-risk-notes" aria-label={`Limits that apply to ${scenario.name}`}>{notes.map((note) => <li key={note}>{note}</li>)}</ul>}</article>;
            })}
            {riskWarnings.common.length > 0 && <div className="studio-risk-common-notes" role="note"><span>HOW TO READ THESE RESULTS</span>{riskWarnings.common.map((warning) => <p key={warning}>{warning}</p>)}</div>}
          </div>}
          <p className="studio-disclaimer">Illustrative analysis only. Not an appraisal, credit decision, offer, tax opinion, or investment recommendation. Verify property records and every assumption with qualified professionals.</p>
        </aside>
      </section>
    </main>
  );
};

export default InvestmentCalculator;
