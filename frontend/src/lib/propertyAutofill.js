export const UNDERWRITING_RADIUS_MILES = 0.5;

const roundMoney = (value, increment = 100) => Math.round(Math.max(0, Number(value) || 0) / increment) * increment;

export const assumptionsByField = (profile) => Object.fromEntries(
  (profile?.assumptions || []).map((item) => [item.field, item]),
);

export const applyAutofillProfile = (form, profile) => ({
  ...form,
  ...(profile?.inputs || {}),
  address: profile?.property?.formatted_address || form.address,
  strategy: profile?.strategy || form.strategy,
});

const propertyTypeValue = (value = '') => {
  const normalized = value.toLowerCase();
  if (normalized.includes('multi') || normalized.includes('apartment')) return 'multifamily';
  if (normalized.includes('condo')) return 'condo';
  if (normalized.includes('land') || normalized.includes('lot') || normalized.includes('vacant')) return 'land';
  return 'single_family';
};

/**
 * Keeps the built-in review properties useful when the live provider is absent.
 * These values are deliberately labelled as review-mode screening estimates and
 * are never represented as researched local comparables.
 */
export const buildReviewAutofillProfile = ({ property, strategy, currentForm }) => {
  const price = Number(property.price || property.last_sale_price || 0);
  const squareFeet = Number(property.sqft || property.square_footage || 0);
  const taxes = Number(property.taxHistory?.[0]?.amount || property.annual_taxes || price * .012);
  const yearBuilt = Number(property.yearBuilt || property.year_built || 1985);
  const age = Math.max(0, new Date().getUTCFullYear() - yearBuilt);
  const capexPerSquareFoot = age <= 10 ? 5 : age <= 20 ? 10 : age <= 40 ? 20 : 30;
  const units = propertyTypeValue(property.propertyType || property.property_type) === 'multifamily' ? 2 : 1;
  const monthlyRent = Math.max(750, price * .006);
  const annualRent = monthlyRent * units * 12;
  const insurance = price * .0075;
  const inputs = {
    ...currentForm,
    market: [property.city, property.state].filter(Boolean).join(', '),
    propertyType: propertyTypeValue(property.propertyType || property.property_type),
    units: String(units), rentableSquareFeet: String(squareFeet), purchasePrice: String(roundMoney(price, 1000)),
    closingCosts: String(roundMoney(price * .03)), dueDiligenceCosts: String(roundMoney(1500 + units * 500 + squareFeet * .15)),
    initialCapex: String(roundMoney(Math.max(2500 * units, squareFeet * capexPerSquareFoot))),
    propertyTaxes: String(roundMoney(taxes)), insurance: String(roundMoney(insurance)),
    annualRent: String(roundMoney(annualRent)), otherIncome: String(roundMoney(annualRent * .015)),
    repairsMaintenance: String(roundMoney(Math.max(annualRent * .05, squareFeet * 1.25))),
    utilities: String(roundMoney(units > 1 ? units * 900 : 2400)), payrollAdmin: String(roundMoney(Math.max(units * 350, annualRent * .025))),
    managementFee: units >= 5 ? '5' : '7', reserves: String(roundMoney(Math.max(units * 500, squareFeet * .35))),
    annualBelowNoiCosts: String(roundMoney(Math.max(units * 250, annualRent * .02))),
    preliminaryMarketCeiling: String(roundMoney(price, 1000)), maxImmediateCapex: String(roundMoney(price * .10, 1000)),
    maxAnnualTaxes: String(roundMoney(taxes * 1.1)), maxAnnualInsurance: String(roundMoney(insurance * 1.1)),
    arv: String(roundMoney(price, 1000)), rehabCost: String(roundMoney(Math.max(10000, squareFeet * Math.max(35, capexPerSquareFoot * 2.25)), 1000)),
    monthlyHolding: String(roundMoney(taxes / 12 + insurance / 12 + 2400 / 12 + price * .70 * .075 / 12)),
    otherProjectCosts: String(roundMoney(price * .02)),
  };
  if (strategy === 'land') {
    const lotSize = Number(property.lotSize || property.lot_size || 0);
    const acres = lotSize ? lotSize / 43560 : 1;
    inputs.propertyType = 'land';
    inputs.siteAcres = String(Number(acres.toFixed(3)));
    inputs.units = String(Math.max(1, Math.round(acres * 3)));
    inputs.rentableSquareFeet = String(roundMoney(Math.max(1000, lotSize * .25), 100));
  }
  const ignored = new Set(['address', 'strategy']);
  const assumptions = Object.entries(inputs)
    .filter(([field]) => !ignored.has(field))
    .map(([field, value]) => ({
      field, value, label: field, source_kind: 'review_default', source_name: 'DiamondEcho review mode',
      method: 'Screening placeholder until the live property-data provider is configured', confidence: 'low',
      note: 'Review-mode value—not 0.5-mile observed evidence.',
    }));
  return {
    property: {
      formatted_address: [property.address, property.city, property.state, property.zip].filter(Boolean).join(', '),
      city: property.city, state: property.state, property_type: property.propertyType,
      square_footage: squareFeet, year_built: yearBuilt, annual_taxes: taxes,
      provider: 'review', is_demo: true,
    },
    strategy, radius_miles: UNDERWRITING_RADIUS_MILES, inputs, assumptions,
    comparables: { radius_miles: UNDERWRITING_RADIUS_MILES, property_records: 0, rental_comps: 0, sale_comps: 0 },
    provider: 'review', generated_at: new Date().toISOString(),
    warnings: ['Review-mode estimates are not live 0.5-mile comparable evidence. Configure the property-data backend for production research.'],
  };
};

