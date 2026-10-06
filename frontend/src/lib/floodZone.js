// Reads what was typed in the FEMA flood zone box. Text that is not a FEMA
// designation, such as "Not verified", says nothing about the zone and must
// not be treated as one (DE-25). Mirrors classify_flood_zone in
// backend/deal_intelligence/engine.py; the two must read text the same way.
const MINIMAL = new Set(['X', 'C', 'X UNSHADED', 'X (UNSHADED)']);
const MODERATE = new Set(['B', 'X SHADED', 'X (SHADED)', 'X500', '0.2 PCT ANNUAL CHANCE FLOOD HAZARD']);
const SPECIAL = /^(A|AE|AH|AO|AR|A99|A([1-9]|[12][0-9]|30)|V|VE|V([1-9]|[12][0-9]|30)|AR\/(A|AE|AH|AO|A([1-9]|[12][0-9]|30)))$/;

export const classifyFloodZone = (text) => {
  const raw = String(text ?? '').trim().split(/\s+/).filter(Boolean).join(' ');
  if (!raw) return { status: 'not_entered', zone: '' };
  const zone = raw.toUpperCase().replace(/^(FEMA\s+)?(FLOOD\s+)?ZONES?\s+/, '').trim();
  if (MINIMAL.has(zone)) return { status: 'minimal', zone };
  if (MODERATE.has(zone)) return { status: 'moderate', zone };
  if (zone === 'D') return { status: 'undetermined', zone };
  if (SPECIAL.test(zone)) return { status: 'special', zone };
  return { status: 'unrecognized', zone: '' };
};

// A recognised designation means the zone has been looked up, whatever it is.
export const floodZoneVerified = (text) => !['not_entered', 'unrecognized'].includes(classifyFloodZone(text).status);

// Same sentences as the analysis service, so both paths warn alike.
export const floodZoneWarning = (text) => {
  const { status, zone } = classifyFloodZone(text);
  if (status === 'special') return `Flood zone ${zone} is a FEMA Special Flood Hazard Area; floodplain, stormwater, elevation, insurance, and buildable-area review is required.`;
  if (status === 'moderate') return `Flood zone ${zone} is a moderate flood-hazard area; confirm stormwater, elevation, and insurance requirements.`;
  if (status === 'undetermined') return 'Flood zone D means FEMA has not determined the flood hazard; obtain a flood study before relying on the buildable area.';
  if (status === 'minimal') return null;
  return 'The FEMA flood zone is not verified; confirm the designation, base flood elevation, and insurance requirement.';
};
