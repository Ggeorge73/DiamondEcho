import fs from 'fs';
import path from 'path';
import { analyzeDealLocally } from './dealAnalysis';
import { buildDealWorkbook } from './dealWorkbook';
import { buildDealRequest } from './dealRequest';

const landForm = {
  address: '11085 State Bridge Rd, Johns Creek, GA 30022', strategy: 'land', propertyType: 'land',
  market: 'Johns Creek, GA', units: '3', rentableSquareFeet: '15000', purchasePrice: '999999',
  closingCosts: '0', dueDiligenceCosts: '0', initialCapex: '0', holdMonths: '24', ltv: '0',
  sellingCosts: '5', discountRate: '10', developmentType: 'single_family_subdivision',
  dispositionStrategy: 'build_and_sell', siteAcres: '2.5', parcelCount: '1', currentZoning: 'R-4A',
  proposedZoning: 'R-4A', entitlementStatus: 'fully_entitled', utilityStatus: 'available',
  accessStatus: 'legal_confirmed', environmentalStatus: 'clear', geotechnicalStatus: 'complete_suitable',
  floodZone: 'X', wetlandsAcres: '0', developmentMonths: '18', absorptionMonths: '6',
  siteWorkCost: '300000', hardConstructionCost: '1500000', softCosts: '200000',
  permitsImpactFees: '100000', environmentalRemediation: '0', developerFee: '100000',
  landContingency: '10', annualCarryingCosts: '30000', expectedTerminalValue: '4500000',
  stabilizedNoi: '0', stabilizedExitCap: '0', targetProfitMargin: '20',
};

test('deal-specific XLSX contains the submitted land assumptions and reconciled results', () => {
  const landDeal = buildDealRequest(landForm);
  const result = analyzeDealLocally(landDeal);
  const bytes = buildDealWorkbook({ form: landForm, request: landDeal, result });
  expect(bytes[0]).toBe(0x50); expect(bytes[1]).toBe(0x4B);
  let raw = '';
  for (let offset = 0; offset < bytes.length; offset += 16000) raw += String.fromCharCode(...bytes.slice(offset, offset + 16000));
  expect(raw).toContain('11085 State Bridge Rd');
  expect(raw).toContain('Development profit');
  expect(raw).toContain(String(result.metrics.development_profit.value));
  expect(raw).toContain('Monthly Levered Cash Flow');
  const outputDir = path.resolve(__dirname, '../../../outputs/e2e_audit');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'DiamondEcho_Johns_Creek_E2E.xlsx'), bytes);
});
