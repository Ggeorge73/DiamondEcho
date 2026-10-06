// Property changes must not carry underwriting inputs from the last address.
// Financing preferences and target hurdles are user choices, not property facts.
export const PROPERTY_ASSUMPTION_FIELDS = [
  'units', 'rentableSquareFeet', 'purchasePrice', 'closingCosts',
  'dueDiligenceCosts', 'initialCapex', 'annualRent', 'otherIncome',
  'vacancy', 'propertyTaxes', 'insurance', 'repairsMaintenance',
  'utilities', 'payrollAdmin', 'managementFee', 'reserves',
  'annualBelowNoiCosts', 'incomeGrowth', 'expenseGrowth', 'exitCap',
  'explicitSalePrice', 'arv', 'rehabCost', 'rehabContingency',
  'monthlyHolding', 'otherProjectCosts', 'sellingCosts',
  'preliminaryMarketCeiling', 'maxImmediateCapex', 'maxAnnualTaxes',
  'maxAnnualInsurance', 'siteAcres', 'parcelCount', 'currentZoning',
  'proposedZoning', 'floodZone', 'wetlandsAcres', 'developmentMonths',
  'absorptionMonths', 'siteWorkCost', 'hardConstructionCost',
  'softCosts', 'permitsImpactFees', 'environmentalRemediation',
  'developerFee', 'landContingency', 'annualCarryingCosts',
  'expectedTerminalValue', 'stabilizedNoi', 'stabilizedExitCap',
];

const hasValue = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

// Site diligence and project-program choices cannot carry to another parcel.
const SITE_CHOICE_RESETS = {
  developmentType: '', dispositionStrategy: '', entitlementStatus: '',
  utilityStatus: 'verify', accessStatus: 'verify',
  environmentalStatus: 'phase_i_required', geotechnicalStatus: 'not_started',
};

// A different property was chosen from the suggestions, or a listing link was
// opened: nothing about the last property carries over. The Land development
// tab only analyses land, so the asset type stays "Lot / land" there.
export const preparePropertyChange = (form, address = '') => {
  const next = { ...form, address, market: '', propertyType: form.strategy === 'land' ? 'land' : 'single_family' };
  PROPERTY_ASSUMPTION_FIELDS.forEach((field) => { next[field] = ''; });
  Object.assign(next, SITE_CHOICE_RESETS);
  return next;
};

// The address box was typed in (DE-25). Figures the visitor entered themselves
// are theirs and stay. Figures they did not enter, the example values or facts
// loaded for another address, are cleared, because they say nothing about this
// property. The asset type and the strategy are never changed by typing.
// Returns the new form and what was cleared, so the page can say so and offer
// to put it back.
export const prepareAddressEdit = (form, address, entered = []) => {
  const kept = new Set(entered);
  const next = { ...form, address };
  const cleared = {};
  const reset = (field, value) => {
    if (kept.has(field) || form[field] === value || form[field] === undefined) return;
    cleared[field] = form[field];
    next[field] = value;
  };
  PROPERTY_ASSUMPTION_FIELDS.forEach((field) => reset(field, ''));
  reset('market', '');
  Object.entries(SITE_CHOICE_RESETS).forEach(([field, value]) => reset(field, value));
  return { form: next, cleared };
};

const normalizePropertyType = (value = '') => {
  const type = String(value).toLowerCase();
  if (type.includes('multi') || type.includes('apartment')) return 'multifamily';
  if (type.includes('condo')) return 'condo';
  if (type.includes('office')) return 'office';
  if (type.includes('retail')) return 'retail';
  if (type.includes('industrial')) return 'industrial';
  if (type.includes('mixed')) return 'mixed_use';
  if (type.includes('land') || type.includes('lot') || type.includes('vacant')) return 'land';
  return 'single_family';
};

// Neither public records nor illustrative deal examples establish an asking price.
// A historical sale is context, not today's proposed acquisition.
export const applyPropertyAutofill = (form, record) => {
  const next = preparePropertyChange(form, record?.formatted_address || '');
  const provenance = {};
  const sourceLabel = record?.is_demo || record?.provider === 'demo'
    ? 'Illustrative deal example — not verified public data'
    : record?.provider ? `${record.provider} public record — verify currency` : 'Unverified property record';
  const fill = (field, value, description) => {
    if (value === null || value === undefined || value === '') return;
    next[field] = String(value);
    provenance[field] = { source: sourceLabel, description };
  };

  if (record?.formatted_address) provenance.address = { source: sourceLabel, description: 'Reported address' };
  if (record?.city && record?.state) {
    next.market = `${record.city}, ${record.state}`;
    provenance.market = { source: sourceLabel, description: 'Location, not a market forecast' };
  }
  if (record?.property_type) {
    next.propertyType = normalizePropertyType(record.property_type);
    provenance.propertyType = { source: sourceLabel, description: 'Reported property type' };
  }
  if (hasValue(record?.square_footage)) fill('rentableSquareFeet', record.square_footage, 'Reported building area; verify rentable area');
  if (hasValue(record?.annual_taxes)) fill('propertyTaxes', record.annual_taxes, 'Reported historical annual taxes; reassess after purchase');
  if (record?.property_type && !String(record.property_type).toLowerCase().includes('multi')) {
    fill('units', 1, 'Single-property working assumption; verify unit count');
  }

  const reviewFields = [
    ['purchasePrice', 'Purchase price or current ask'],
    ['annualRent', 'Annual rent or income'],
    ['propertyTaxes', 'Current tax bill and post-sale assessment'],
    ['insurance', 'Insurance quote'],
    ['repairsMaintenance', 'Maintenance budget'],
    ['closingCosts', 'Closing-cost estimate'],
  ].filter(([field]) => !provenance[field]).map(([, label]) => label);
  // Historical sale is deliberately not copied into purchasePrice.
  if (hasValue(record?.last_sale_price)) reviewFields.unshift('Historical sale price is context only; enter a current purchase price');
  return { form: next, provenance, sourceLabel, reviewFields };
};
