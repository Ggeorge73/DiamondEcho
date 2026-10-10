import {
  PAGES, SERVICE_AREAS, SHARE_IMAGE, SITE_ORIGIN, STRUCTURED_DATA_ID,
  applyPageMeta, businessData, canonicalFor, headFor, jsonForScript, officeLocality, pageForPath, serviceAreaList, structuredDataFor,
} from './pageMeta';
import { BROKERAGE, HOURS, OFFICE } from './contact';

describe('what each page tells a search engine', () => {
  test('every page has a title and a summary of its own', () => {
    expect(new Set(PAGES.map((page) => page.title)).size).toBe(PAGES.length);
    expect(new Set(PAGES.map((page) => page.description)).size).toBe(PAGES.length);
    expect(new Set(PAGES.map((page) => page.path)).size).toBe(PAGES.length);
  });

  // Search results cut a title at about 60 characters and a summary at about 160.
  test.each(PAGES.map((page) => [page.path, page]))('%s: the title and summary fit a search result and name the site', (_, page) => {
    expect(page.title.length).toBeGreaterThanOrEqual(15);
    expect(page.title.length).toBeLessThanOrEqual(60);
    expect(page.title).toMatch(/DiamondEcho/);
    expect(page.description.length).toBeGreaterThanOrEqual(70);
    expect(page.description.length).toBeLessThanOrEqual(160);
    expect(page.description).toMatch(/[.!?]$/);
  });

  test('the pages people search for say where: Georgia or metro Atlanta', () => {
    ['/', '/search', '/mortgage-calculator', '/seller-net-sheet', '/agents', '/about', '/inquire', '/podcast'].forEach((address) => {
      const page = pageForPath(address);
      expect(`${page.title} ${page.description}`).toMatch(/Georgia|Atlanta|, GA/);
    });
  });

  test('the policy pages keep the titles the pages set for themselves', () => {
    expect(pageForPath('/privacy').title).toBe('Privacy | DiamondEcho');
    expect(pageForPath('/terms').title).toBe('Terms of use | DiamondEcho');
  });

  test('an address is matched with or without a closing slash, and an unknown one is no page', () => {
    expect(pageForPath('/about/').path).toBe('/about');
    expect(pageForPath('/').path).toBe('/');
    expect(pageForPath('/no-such-page')).toBeNull();
    expect(pageForPath('/property/123')).toBeNull();
    expect(pageForPath('/About')).toBeNull();
  });

  test('each page is listed under one address: the public domain, no "?" part', () => {
    expect(canonicalFor(pageForPath('/'))).toBe('https://diamondecho.com/');
    expect(canonicalFor(pageForPath('/mortgage-calculator'))).toBe('https://diamondecho.com/mortgage-calculator');
    PAGES.forEach((page) => expect(canonicalFor(page)).toMatch(/^https:\/\/diamondecho\.com\/[a-z0-9-]*$/));
  });

  // The words a title or summary may not use: the same ones the pages may not (docs/de17-content-claims.md).
  test.each(['#1', 'best ', 'top-rated', 'top rated', 'award', 'guarantee', 'luxury', 'trusted', 'leading', 'expert', 'years of', 'national', 'nationwide', 'lowest', 'pre-approv'])(
    'no title or summary says %j', (word) => {
      PAGES.forEach((page) => expect(`${page.title} ${page.description}`.toLowerCase()).not.toContain(word));
    },
  );

  test('contact details in a summary are the published ones', () => {
    expect(pageForPath('/inquire').description).toContain(`Direct ${OFFICE.phone}`);
    expect(pageForPath('/about').description).toContain(`Brokerage: ${BROKERAGE.name}`);
  });

  // The request forms exist only in a build with a service to send them to (pages/Inquire.jsx).
  describe('the request page\u2019s summary says what that build\u2019s page offers', () => {
    const saved = process.env.REACT_APP_BACKEND_URL;
    afterEach(() => {
      if (saved === undefined) delete process.env.REACT_APP_BACKEND_URL;
      else process.env.REACT_APP_BACKEND_URL = saved;
    });
    const summary = (backend) => {
      if (backend) process.env.REACT_APP_BACKEND_URL = backend;
      else delete process.env.REACT_APP_BACKEND_URL;
      let description;
      jest.isolateModules(() => { description = require('./pageMeta').pageForPath('/inquire').description; });
      return description;
    };

    test('with the service: the three requests and when replies are sent', () => {
      const description = summary('https://api.example.com');
      expect(description).toBe(`Ask about buying, request a seller consultation or a property tour. Replies ${HOURS.label}. Direct ${OFFICE.phone}.`);
      expect(description.length).toBeLessThanOrEqual(160);
    });

    test('without it: how to reach the brokerage and DiamondEcho, and no promise of a form', () => {
      const description = summary('');
      expect(description).toBe(`Reach DiamondEcho about buying or selling a home in Georgia. Brokerage: ${BROKERAGE.name}, office ${BROKERAGE.phone}. Direct ${OFFICE.phone}.`);
      expect(description).not.toMatch(/request|Replies|tour/);
      expect(description.length).toBeLessThanOrEqual(160);
    });
  });
});

describe('the cities DiamondEcho works in', () => {
  test('are the seven Gbenga named, each with its county', () => {
    expect(SERVICE_AREAS.map((area) => area.city)).toEqual(['Alpharetta', 'Roswell', 'Duluth', 'Atlanta', 'Suwanee', 'Cumming', 'Lawrenceville']);
    SERVICE_AREAS.forEach((area) => expect(area.county).toMatch(/^(Fulton|Gwinnett|Forsyth) County$/));
  });

  test('read as a sentence', () => {
    expect(serviceAreaList()).toBe('Alpharetta, Roswell, Duluth, Atlanta, Suwanee, Cumming and Lawrenceville');
    expect(serviceAreaList([{ city: 'Duluth' }])).toBe('Duluth');
    expect(serviceAreaList([{ city: 'Duluth' }, { city: 'Suwanee' }])).toBe('Duluth and Suwanee');
  });
});

describe('the business details search engines read', () => {
  const business = businessData();

  test('are the published contact details, not a second copy of them', () => {
    expect(business['@type']).toBe('RealEstateAgent');
    expect(business.name).toBe('DiamondEcho');
    expect(business.telephone).toBe('+16785169717');
    expect(business.email).toBe(OFFICE.email);
    expect(business.address).toEqual({
      '@type': 'PostalAddress', streetAddress: '2750 Premiere Pkwy, Ste. 200',
      addressLocality: 'Duluth', addressRegion: 'GA', postalCode: '30097', addressCountry: 'US',
    });
    expect(`${business.address.streetAddress}|${business.address.addressLocality}, ${business.address.addressRegion} ${business.address.postalCode}`)
      .toBe(OFFICE.addressLines.join('|'));
  });

  test('name the brokerage and its telephone number (Rule 520-1-.09)', () => {
    expect(business.parentOrganization).toEqual({ '@type': 'Organization', name: BROKERAGE.name, telephone: '+17704955050' });
  });

  test('give the hours as the hours DiamondEcho can be reached, not as the hours an office is open', () => {
    expect(business.contactPoint).toEqual([{
      '@type': 'ContactPoint', contactType: 'customer service',
      telephone: '+16785169717', email: OFFICE.email, areaServed: 'US-GA', availableLanguage: 'en',
      hoursAvailable: [{
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        opens: '09:00', closes: '17:00',
      }],
    }]);
    // Nobody has said when the brokerage's office is open to callers in person.
    expect(business).not.toHaveProperty('openingHoursSpecification');
    expect(business).not.toHaveProperty('openingHours');
  });

  test('list the seven cities, and nothing that is not on the pages', () => {
    expect(business.areaServed.map((area) => area.name)).toEqual(SERVICE_AREAS.map((area) => area.city));
    expect(business.areaServed[5]).toEqual({ '@type': 'City', name: 'Cumming', containedInPlace: { '@type': 'AdministrativeArea', name: 'Forsyth County, Georgia' } });
    // No ratings, reviews, prices, awards, licence numbers or map position: none has been supplied or approved.
    ['aggregateRating', 'review', 'priceRange', 'award', 'geo', 'founder', 'foundingDate', 'numberOfEmployees', 'sameAs', 'hasCredential'].forEach((key) => {
      expect(business).not.toHaveProperty(key);
    });
  });

  test('an office line that cannot be read stops the build instead of publishing a wrong address', () => {
    expect(officeLocality('Duluth, GA 30097')).toEqual({ city: 'Duluth', state: 'GA', zip: '30097' });
    expect(() => officeLocality('Duluth Georgia')).toThrow(/Cannot read city, state and ZIP/);
  });

  test('every page carries the business, the site and itself; inner pages their place in the site', () => {
    PAGES.forEach((page) => {
      const types = structuredDataFor(page)['@graph'].map((node) => node['@type']);
      expect(types.slice(0, 3)).toEqual(['RealEstateAgent', 'WebSite', 'WebPage']);
      expect(types.includes('BreadcrumbList')).toBe(page.path !== '/');
    });
    const crumbs = structuredDataFor(pageForPath('/about'))['@graph'].find((node) => node['@type'] === 'BreadcrumbList');
    expect(crumbs.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://diamondecho.com/' },
      { '@type': 'ListItem', position: 2, name: 'The firm', item: 'https://diamondecho.com/about' },
    ]);
  });

  test('no page is described as software, a product or an offer', () => {
    // Search engines accept those descriptions only with ratings or reviews, and the site has none.
    PAGES.forEach((page) => {
      const text = JSON.stringify(structuredDataFor(page));
      expect(text).not.toMatch(/"(WebApplication|SoftwareApplication|Product|Offer|AggregateRating|Review)"/);
    });
  });
});

describe('the head of a page', () => {
  test('holds the title, summary, listing address and link-preview tags', () => {
    const head = headFor(pageForPath('/search'));
    expect(head.canonical).toBe('https://diamondecho.com/search');
    const tags = Object.fromEntries([...head.properties, ...head.names]);
    expect(tags['og:title']).toBe(head.title);
    expect(tags['og:description']).toBe(head.description);
    expect(tags['og:url']).toBe(head.canonical);
    expect(tags['og:image']).toBe(`${SITE_ORIGIN}${SHARE_IMAGE.path}`);
    expect(tags['og:image:width']).toBe('1200');
    expect(tags['og:image:height']).toBe('630');
    expect(tags['twitter:card']).toBe('summary_large_image');
  });

  test('the link-preview picture is in the public folder at the size it claims', () => {
    const fs = require('fs');
    const path = require('path');
    const file = fs.readFileSync(path.resolve(__dirname, '../../public', SHARE_IMAGE.path.slice(1)));
    // A PNG states its width and height at bytes 16 to 23.
    expect(file.subarray(1, 4).toString()).toBe('PNG');
    expect([file.readUInt32BE(16), file.readUInt32BE(20)]).toEqual([SHARE_IMAGE.width, SHARE_IMAGE.height]);
    ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png'].forEach((name) => {
      expect(fs.existsSync(path.resolve(__dirname, '../../public', name))).toBe(true);
    });
  });

  test('data written into a script element cannot close it', () => {
    expect(jsonForScript({ note: '</script><script>alert(1)</script>' })).not.toContain('</script>');
    expect(JSON.parse(jsonForScript({ note: 'a < b' }))).toEqual({ note: 'a < b' });
  });
});

describe('keeping the open page in step', () => {
  const head = () => ({
    title: document.title,
    description: [...document.head.querySelectorAll('meta[name="description"]')].map((node) => node.content),
    canonical: [...document.head.querySelectorAll('link[rel="canonical"]')].map((node) => node.getAttribute('href')),
    ogUrl: [...document.head.querySelectorAll('meta[property="og:url"]')].map((node) => node.content),
    data: [...document.head.querySelectorAll(`script#${STRUCTURED_DATA_ID}`)].map((node) => JSON.parse(node.textContent)),
  });
  beforeEach(() => {
    document.head.innerHTML = '<title>DiamondEcho | Private Real Estate</title><meta name="description" content="Fallback.">';
  });

  test('a page\'s details replace the ones before it, and are never doubled', () => {
    applyPageMeta(document, pageForPath('/about'));
    applyPageMeta(document, pageForPath('/mortgage-calculator'));
    applyPageMeta(document, pageForPath('/mortgage-calculator'));
    const now = head();
    const page = pageForPath('/mortgage-calculator');
    expect(now.title).toBe(page.title);
    expect(now.description).toEqual([page.description]);
    expect(now.canonical).toEqual(['https://diamondecho.com/mortgage-calculator']);
    expect(now.ogUrl).toEqual(['https://diamondecho.com/mortgage-calculator']);
    expect(now.data).toEqual([structuredDataFor(page)]);
    expect(document.head.querySelectorAll('meta[property="og:title"]')).toHaveLength(1);
    expect(document.head.querySelectorAll('meta[name="twitter:card"]')).toHaveLength(1);
  });

  test('an address the site does not have keeps nothing the page before it said about itself', () => {
    applyPageMeta(document, pageForPath('/about'));
    applyPageMeta(document, null);
    const now = head();
    expect(now.canonical).toEqual([]);
    expect(now.data).toEqual([]);
    expect(now.description).toEqual([]);
    expect(now.ogUrl).toEqual([]);
    expect(document.head.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"]')).toHaveLength(0);
    // And the next real page puts all of it back.
    applyPageMeta(document, pageForPath('/search'));
    expect(head().description).toEqual([pageForPath('/search').description]);
    expect(document.head.querySelectorAll('meta[property^="og:"]')).toHaveLength(10);
  });

  test('a real page is never left marked "not to be listed"', () => {
    // 404.html carries the mark from the start; a visitor who lands there and clicks Home is on a real page.
    document.head.insertAdjacentHTML('beforeend', '<meta name="robots" content="noindex">');
    applyPageMeta(document, null);
    expect(document.head.querySelectorAll('meta[name="robots"]')).toHaveLength(1);
    applyPageMeta(document, pageForPath('/'));
    expect(document.head.querySelectorAll('meta[name="robots"]')).toHaveLength(0);
  });
});
