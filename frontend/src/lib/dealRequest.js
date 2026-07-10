const n = (value) => Number(value || 0);
const rate = (value) => n(value) / 100;

export const buildDealRequest = (form) => {
  const operatingExpenses = n(form.propertyTaxes) + n(form.insurance) + n(form.repairsMaintenance) + n(form.utilities) + n(form.payrollAdmin);
  const common = {
    strategy: form.strategy,
    property: {
      property_type: form.propertyType, unit_count: Math.max(1, n(form.units)),
      rentable_square_feet: n(form.rentableSquareFeet) || null,
      market: form.market || null, currency: 'USD',
    },
    acquisition: {
      purchase_price: n(form.purchasePrice), closing_costs: n(form.closingCosts),
      due_diligence_costs: n(form.dueDiligenceCosts), initial_capex: n(form.initialCapex),
      hold_months: Math.max(1, n(form.holdMonths)),
    },
    debt: n(form.ltv) > 0 ? [{
      name: 'Senior acquisition loan', loan_to_value: rate(form.ltv),
      annual_interest_rate: rate(form.interestRate), amortization_years: Math.max(1, n(form.amortizationYears)),
      interest_only_months: Math.max(0, n(form.interestOnlyMonths)),
      term_months: Math.max(12, n(form.loanTermYears) * 12), origination_fee_rate: rate(form.originationFee),
    }] : [],
    exit: { selling_cost_rate: rate(form.sellingCosts) },
    assumptions: { annual_discount_rate: rate(form.discountRate) },
  };
  if (form.strategy === 'rental') {
    return {
      ...common,
      operating: {
        gross_scheduled_rent: n(form.annualRent), other_income: n(form.otherIncome),
        vacancy_rate: rate(form.vacancy), operating_expenses: operatingExpenses,
        management_fee_rate: rate(form.managementFee), replacement_reserves: n(form.reserves),
        annual_below_noi_costs: n(form.annualBelowNoiCosts),
        annual_income_growth_rate: rate(form.incomeGrowth), annual_expense_growth_rate: rate(form.expenseGrowth),
      },
      exit: {
        ...common.exit,
        ...(n(form.explicitSalePrice) > 0
          ? { explicit_sale_price: n(form.explicitSalePrice) }
          : n(form.exitCap) > 0 ? { exit_cap_rate: rate(form.exitCap) } : {}),
      },
    };
  }
  if (form.strategy === 'land') {
    const developmentCosts = n(form.siteWorkCost) + n(form.hardConstructionCost) + n(form.softCosts)
      + n(form.permitsImpactFees) + n(form.environmentalRemediation) + n(form.developerFee)
      + (n(form.siteWorkCost) + n(form.hardConstructionCost)) * rate(form.landContingency);
    const totalProjectCost = n(form.purchasePrice) + n(form.closingCosts) + n(form.dueDiligenceCosts) + n(form.initialCapex) + developmentCosts;
    return {
      ...common,
      property: { ...common.property, property_type: 'land' },
      debt: n(form.ltv) > 0 ? [{
        name: 'Construction / development facility', principal: totalProjectCost * rate(form.ltv),
        annual_interest_rate: rate(form.interestRate), amortization_years: Math.max(1, n(form.amortizationYears)),
        interest_only_months: Math.max(0, n(form.interestOnlyMonths)),
        term_months: Math.max(12, n(form.loanTermYears) * 12), origination_fee_rate: rate(form.originationFee),
      }] : [],
      land: {
        development_type: form.developmentType, disposition_strategy: form.dispositionStrategy,
        site_acres: n(form.siteAcres), parcel_count: Math.max(1, n(form.parcelCount)),
        current_zoning: form.currentZoning, proposed_zoning: form.proposedZoning,
        entitlement_status: form.entitlementStatus, utility_status: form.utilityStatus,
        access_status: form.accessStatus, environmental_status: form.environmentalStatus,
        geotechnical_status: form.geotechnicalStatus, flood_zone: form.floodZone,
        wetlands_acres: n(form.wetlandsAcres), planned_units: n(form.units),
        buildable_square_feet: n(form.rentableSquareFeet), development_months: Math.max(1, n(form.developmentMonths)),
        absorption_months: Math.max(0, n(form.absorptionMonths)),
        site_work_cost: n(form.siteWorkCost), hard_construction_cost: n(form.hardConstructionCost),
        soft_costs: n(form.softCosts), permits_impact_fees: n(form.permitsImpactFees),
        environmental_remediation: n(form.environmentalRemediation), developer_fee: n(form.developerFee),
        contingency_rate: rate(form.landContingency), annual_carrying_costs: n(form.annualCarryingCosts),
        expected_terminal_value: n(form.expectedTerminalValue), stabilized_noi: n(form.stabilizedNoi),
        stabilized_exit_cap_rate: rate(form.stabilizedExitCap), target_profit_margin: rate(form.targetProfitMargin),
      },
    };
  }
  return {
    ...common,
    flip: {
      after_repair_value: n(form.arv), rehab_cost: n(form.rehabCost),
      rehab_contingency_rate: rate(form.rehabContingency), monthly_holding_costs: n(form.monthlyHolding),
      other_project_costs: n(form.otherProjectCosts),
    },
  };
};

