import { BROKERAGE, HOURS, OFFICE } from './contact';
import { TOOL_PATHS } from './intelligenceTools';

// What each public page tells a search engine about itself: the title and
// summary shown in results, and the one address the page should be listed
// under. The build writes these into each page's saved HTML
// (scripts/prerender.mjs) and the app keeps the browser tab in step as the
// visitor moves around (components/PageMeta.jsx), so both read this file.
//
// A title or summary is a published claim like any other (docs/de17-content-claims.md):
// it may say what the page does and name what Gbenga has approved, and
// nothing else.

export const SITE_ORIGIN = 'https://diamondecho.com';
export const SITE_NAME = 'DiamondEcho';
export const SHARE_IMAGE = Object.freeze({ path: '/og-image.png', width: 1200, height: 630, alt: 'DiamondEcho — real estate in metro Atlanta, Georgia' });

// The cities Gbenga named on 2026-10-10 as the places he wants buyers, sellers
// and investors to find DiamondEcho. Change the list here only: the home page,
// the summaries below and the business details read by search engines use it.
export const SERVICE_AREAS = Object.freeze([
  Object.freeze({ city: 'Alpharetta', county: 'Fulton County' }),
  Object.freeze({ city: 'Roswell', county: 'Fulton County' }),
  Object.freeze({ city: 'Duluth', county: 'Gwinnett County' }),
  Object.freeze({ city: 'Atlanta', county: 'Fulton County' }),
  Object.freeze({ city: 'Suwanee', county: 'Gwinnett County' }),
  Object.freeze({ city: 'Cumming', county: 'Forsyth County' }),
  Object.freeze({ city: 'Lawrenceville', county: 'Gwinnett County' }),
]);

// "Alpharetta, Roswell, … and Lawrenceville"
export const serviceAreaList = (areas = SERVICE_AREAS) => {
  const names = areas.map((area) => area.city);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join('');
};

const page = (path, name, title, description, extra = {}) => Object.freeze({ path, name, title, description, ...extra });

export const PAGES = Object.freeze([
  page('/', 'Home',
    'Metro Atlanta Real Estate: Buy, Sell & Invest | DiamondEcho',
    'Search Georgia MLS homes for sale and rent, estimate a mortgage payment or your sale proceeds, and analyze investment deals across metro Atlanta, Georgia.'),
  page('/search', 'Search homes',
    'Homes for Sale & Rent in Metro Atlanta, GA | DiamondEcho',
    `Search Georgia MLS listings for homes, land, multifamily and rentals in ${serviceAreaList()}.`),
  page(TOOL_PATHS.deal, 'Deal Studio',
    'Real Estate Investment Calculator: Deal Studio | DiamondEcho',
    'Free real estate deal calculator for rentals, fix and flips and land development. See IRR, cash-on-cash, DSCR and Monte Carlo ranges from the figures you enter.',
    { tool: 'Deal Studio' }),
  page(TOOL_PATHS.mortgage, 'Mortgage simulator',
    'Mortgage Calculator for Georgia Home Buyers | DiamondEcho',
    'Estimate a monthly house payment: principal and interest, property taxes, insurance, HOA fees and mortgage insurance. Free, and nothing you type is sent or saved.',
    { tool: 'Mortgage simulator' }),
  page(TOOL_PATHS['net-proceeds'], 'Seller net sheet',
    'Georgia Seller Net Sheet: Estimate Sale Proceeds | DiamondEcho',
    'Estimate what you keep when you sell a home in Georgia: mortgage payoff, the commission you enter, closing costs, Georgia transfer tax, concessions and prorations.',
    { tool: 'Seller net sheet' }),
  page('/agents', 'Advisory',
    'Buy, Sell or Invest With a Georgia Agent | DiamondEcho',
    'Search Georgia MLS, work through the numbers, then tell DiamondEcho what you need. Working with buyers, sellers and investors across metro Atlanta, Georgia.'),
  page('/about', 'The firm',
    'About DiamondEcho | Real Estate in Duluth, Georgia',
    `Georgia MLS property search, deal analysis and a way to start a buying or selling conversation, in one place. Brokerage: ${BROKERAGE.name}, Duluth, GA.`),
  page('/inquire', 'Contact',
    'Contact DiamondEcho | Buy or Sell a Home in Georgia',
    `Ask about buying, request a seller consultation or a property tour. Replies ${HOURS.label}. Direct ${OFFICE.phone}.`),
  page('/podcast', 'Podcast',
    'Georgia Real Estate Podcast | DiamondEcho',
    'Episodes recorded by DiamondEcho on buying, selling and investing in Georgia real estate. General information, not advice about any property or loan.'),
  page('/privacy', 'Privacy',
    'Privacy | DiamondEcho',
    'A plain account of what DiamondEcho’s website collects, what it does not, and which other companies are involved when you use it.'),
  page('/terms', 'Terms of use',
    'Terms of use | DiamondEcho',
    'How to read and use the DiamondEcho website: what the information on it is, and what it is not.'),
]);

const withoutClosingSlash = (pathname) => String(pathname || '').replace(/\/+$/, '') || '/';

// The page an address belongs to, or null for an address the site does not have.
export const pageForPath = (pathname) => PAGES.find((item) => item.path === withoutClosingSlash(pathname)) || null;

// The one address a page is listed under: the public domain, no "?" part.
export const canonicalFor = (item) => `${SITE_ORIGIN}${item.path === '/' ? '/' : item.path}`;

const DAY_NAMES = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
const clock = (hour) => `${String(hour).padStart(2, '0')}:00`;
const dialable = (href) => href.replace(/^tel:/, '');

// "Duluth, GA 30097" → its three parts, for the address search engines read.
export const officeLocality = (line = OFFICE.addressLines[1]) => {
  const match = /^(.+),\s*([A-Z]{2})\s+(\d{5})$/.exec(line);
  if (!match) throw new Error(`Cannot read city, state and ZIP from "${line}"`);
  return { city: match[1], state: match[2], zip: match[3] };
};

const BUSINESS_ID = `${SITE_ORIGIN}/#business`;
const WEBSITE_ID = `${SITE_ORIGIN}/#website`;

// The business as schema.org describes it. Every value is read from
// lib/contact.js or the list above: nothing here is typed a second time, and
// nothing is stated that the pages themselves do not show.
export const businessData = () => {
  const { city, state, zip } = officeLocality();
  return {
    '@type': 'RealEstateAgent',
    '@id': BUSINESS_ID,
    name: SITE_NAME,
    alternateName: ['Diamond Echo', 'DiamondEcho Private Real Estate'],
    url: `${SITE_ORIGIN}/`,
    image: `${SITE_ORIGIN}${SHARE_IMAGE.path}`,
    logo: `${SITE_ORIGIN}/apple-touch-icon.png`,
    telephone: dialable(OFFICE.phoneHref),
    email: OFFICE.email,
    address: {
      '@type': 'PostalAddress',
      streetAddress: OFFICE.addressLines[0],
      addressLocality: city,
      addressRegion: state,
      postalCode: zip,
      addressCountry: 'US',
    },
    areaServed: SERVICE_AREAS.map((area) => ({
      '@type': 'City',
      name: area.city,
      containedInPlace: { '@type': 'AdministrativeArea', name: `${area.county}, Georgia` },
    })),
    openingHoursSpecification: [{
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: HOURS.days.map((day) => DAY_NAMES[day]),
      opens: clock(HOURS.open),
      closes: clock(HOURS.close),
    }],
    // The firm DiamondEcho operates under (Georgia Real Estate Commission Rule 520-1-.09).
    parentOrganization: {
      '@type': 'RealEstateAgent',
      name: BROKERAGE.name,
      telephone: dialable(BROKERAGE.phoneHref),
    },
  };
};

export const structuredDataFor = (item) => {
  const url = canonicalFor(item);
  const graph = [
    businessData(),
    { '@type': 'WebSite', '@id': WEBSITE_ID, url: `${SITE_ORIGIN}/`, name: SITE_NAME, publisher: { '@id': BUSINESS_ID } },
    {
      '@type': 'WebPage',
      '@id': `${url}#page`,
      url,
      name: item.title,
      description: item.description,
      isPartOf: { '@id': WEBSITE_ID },
      about: { '@id': BUSINESS_ID },
      inLanguage: 'en-US',
    },
  ];
  if (item.path !== '/') {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: item.name, item: url },
      ],
    });
  }
  if (item.tool) {
    graph.push({
      '@type': 'WebApplication',
      name: `${SITE_NAME} ${item.tool}`,
      url,
      description: item.description,
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'Any',
      browserRequirements: 'Requires JavaScript',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      provider: { '@id': BUSINESS_ID },
    });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
};

// Everything that goes in a page's <head>, as data. The build turns it into
// tags; applyPageMeta below turns it into changes to the open page.
export const headFor = (item) => {
  const url = canonicalFor(item);
  const image = `${SITE_ORIGIN}${SHARE_IMAGE.path}`;
  return {
    title: item.title,
    description: item.description,
    canonical: url,
    properties: [
      ['og:type', 'website'],
      ['og:site_name', SITE_NAME],
      ['og:locale', 'en_US'],
      ['og:title', item.title],
      ['og:description', item.description],
      ['og:url', url],
      ['og:image', image],
      ['og:image:width', String(SHARE_IMAGE.width)],
      ['og:image:height', String(SHARE_IMAGE.height)],
      ['og:image:alt', SHARE_IMAGE.alt],
    ],
    names: [
      ['twitter:card', 'summary_large_image'],
      ['twitter:title', item.title],
      ['twitter:description', item.description],
      ['twitter:image', image],
    ],
    structuredData: structuredDataFor(item),
  };
};

export const STRUCTURED_DATA_ID = 'de-page-data';

// JSON that is safe inside a <script> element: "<" cannot start a closing tag.
export const jsonForScript = (data) => JSON.stringify(data).replace(/</g, '\\u003c');

const upsert = (doc, selector, create) => {
  let node = doc.head.querySelector(selector);
  if (!node) { node = create(); doc.head.appendChild(node); }
  return node;
};
const element = (doc, tag, attributes) => {
  const node = doc.createElement(tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
};

// Brings the open page's <head> in step with the page now on screen. On an
// address the site does not have, the previous page's listing address and
// business details are taken away; the "Page not found" screen sets its own
// title and asks not to be listed.
export const applyPageMeta = (doc, item) => {
  if (!item) {
    doc.head.querySelectorAll(`link[rel="canonical"], script#${STRUCTURED_DATA_ID}`).forEach((node) => node.remove());
    return;
  }
  const head = headFor(item);
  doc.title = head.title;
  upsert(doc, 'meta[name="description"]', () => element(doc, 'meta', { name: 'description' })).setAttribute('content', head.description);
  upsert(doc, 'link[rel="canonical"]', () => element(doc, 'link', { rel: 'canonical' })).setAttribute('href', head.canonical);
  head.properties.forEach(([property, content]) => {
    upsert(doc, `meta[property="${property}"]`, () => element(doc, 'meta', { property })).setAttribute('content', content);
  });
  head.names.forEach(([name, content]) => {
    upsert(doc, `meta[name="${name}"]`, () => element(doc, 'meta', { name })).setAttribute('content', content);
  });
  upsert(doc, `script#${STRUCTURED_DATA_ID}`, () => element(doc, 'script', { id: STRUCTURED_DATA_ID, type: 'application/ld+json' }))
    .textContent = jsonForScript(head.structuredData);
};
