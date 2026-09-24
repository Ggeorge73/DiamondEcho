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

export const preparePropertyChange = (form, address = '') => {
  const next = { ...form, address, market: '', propertyType: 'single_family' };
  PROPERTY_ASSUMPTION_FIELDS.forEach((field) => { next[field] = ''; });
  // Site diligence and project-program choices cannot carry to another parcel.
  Object.assign(next, {
    developmentType: '', dispositionStrategy: '', entitlementStatus: '',
    utilityStatus: 'verify', accessStatus: 'verify',
    environmentalStatus: 'phase_i_required', geotechnicalStatus: 'not_started',
  });
  return next;
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

// Only an actual listing ask can prefill purchase price. A historical sale is
// useful context, but it is not today's asking price or proposed acquisition.
export const applyPropertyAutofill = (form, record, sourceKind = 'record') => {
  const next = preparePropertyChange(form, record?.formatted_address || '');
  const provenance = {};
  const isListing = sourceKind === 'listing' && record?.source_listing_id != null;
  const sourceLabel = isListing
    ? `DiamondEcho review listing #${record.source_listing_id}`
    : record?.is_demo || record?.provider === 'demo'
      ? 'Demo property record — not verified public data'
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
  if (isListing && hasValue(record?.price)) fill('purchasePrice', record.price, 'Current review-listing asking price, not an agreed purchase price');
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
  if (!isListing && hasValue(record?.last_sale_price)) reviewFields.unshift('Historical sale price is context only; enter a current purchase price');
  return { form: next, provenance, sourceLabel, reviewFields };
};
