import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, ArrowUpRight, BarChart3, Building2, ChevronLeft, ChevronRight,
  LineChart, MessageCircle, Plus, Search, Users,
} from 'lucide-react';
import { featuredProperties, neighborhoods, properties } from '../data/mockData';

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */

const divisions = [
  {
    index: '01',
    name: 'Residences',
    to: '/search',
    cta: 'Explore the collection',
    copy: 'A private collection of exceptional homes — waterfront estates, penthouses, and architectural landmarks across America’s signature markets.',
    image: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=2200&q=88',
  },
  {
    index: '02',
    name: 'Rentals',
    to: '/search?status=rent',
    cta: 'View curated rentals',
    copy: 'Curated leases managed with the same discretion as our sales portfolio — furnished residences, seasonal homes, and executive placements.',
    image: 'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=2200&q=88',
  },
  {
    index: '03',
    name: 'Investments',
    to: '/investment-calculator',
    cta: 'Open the deal studio',
    copy: 'Institutional-grade underwriting for rentals, flips, multifamily, and commercial assets — modeled, stress-tested, and explained in plain language.',
    image: 'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?auto=format&fit=crop&w=2200&q=88',
  },
  {
    index: '04',
    name: 'Advisory',
    to: '/agents',
    cta: 'Meet the advisors',
    copy: 'Senior advisors coordinating financing, diligence, negotiation, and closing — one relationship across your entire real estate life.',
    image: 'https://images.unsplash.com/photo-1600607688969-a5bfcd646154?auto=format&fit=crop&w=2200&q=88',
  },
];

const sections = [
  { id: 'overview', label: 'Overview' },
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'collection', label: 'Collection' },
  { id: 'intelligence', label: 'Intelligence' },
  { id: 'markets', label: 'Markets' },
  { id: 'portal', label: 'Portal' },
  { id: 'contact', label: 'Contact' },
];

const stats = [
  { value: 2500, suffix: '+', label: 'Residences represented' },
  { value: 12, suffix: '', label: 'Signature markets' },
  { value: 4.2, suffix: 'B', prefix: '$', decimals: 1, label: 'Assets under advisement' },
  { value: 98, suffix: '%', label: 'Client retention' },
];

const explorerData = {
  Residences: [
    {
      title: 'Waterfront Estates',
      copy: 'Oceanfront, lakefront, and dockside estates where land is finite and provenance matters. Privately marketed, precisely valued, and quietly transacted.',
      facts: [{ k: 'From', v: '$3.8M' }, { k: 'Markets', v: 'Miami · Chicago · Malibu' }],
      to: '/search?q=waterfront',
    },
    {
      title: 'Penthouses & Skyline',
      copy: 'Full-floor residences and towers-in-the-sky across New York, Chicago, and San Francisco — engineered views, private elevators, hotel-grade service.',
      facts: [{ k: 'From', v: '$2.1M' }, { k: 'Markets', v: 'New York · SF · Chicago' }],
      to: '/search?q=penthouse',
    },
    {
      title: 'Architectural Estates',
      copy: 'Signature homes by name architects — Trousdale moderns, Mediterranean landmarks, and new builds of consequence, documented like the assets they are.',
      facts: [{ k: 'From', v: '$4.5M' }, { k: 'Markets', v: 'Beverly Hills · Austin' }],
      to: '/search',
    },
    {
      title: 'Curated Rentals',
      copy: 'Furnished residences and executive leases held to sale-grade standards — inspected, managed, and represented end to end.',
      facts: [{ k: 'From', v: '$8K/mo' }, { k: 'Terms', v: 'Seasonal · Annual' }],
      to: '/search?status=rent',
    },
  ],
  Investments: [
    {
      title: 'Multifamily',
      copy: 'Value-add and stabilized multifamily underwritten on real rent rolls — IRR, cash-on-cash, and DSCR modeled before you ever tour the asset.',
      facts: [{ k: 'Typical hold', v: '5–10 yrs' }, { k: 'Modeled in', v: 'Deal Studio' }],
      to: '/investment-calculator',
    },
    {
      title: 'Fix & Flip',
      copy: 'Acquisition, rehab budget, carry, and resale modeled with Monte Carlo ranges — so the downside is known before the offer goes in.',
      facts: [{ k: 'Cycle', v: '6–12 mo' }, { k: 'Modeled in', v: 'Deal Studio' }],
      to: '/investment-calculator',
    },
    {
      title: 'Commercial',
      copy: 'Office, retail, and mixed-use opportunities evaluated on tenancy, credit, and basis — with clear-eyed views on repositioning risk.',
      facts: [{ k: 'Focus', v: 'Core · Value-add' }, { k: 'Coverage', v: 'National' }],
      to: '/agents',
    },
    {
      title: 'New Development',
      copy: 'Ground-up projects from land assembly to sell-out — entitlement guidance, construction finance, and pre-sale strategy under one roof.',
      facts: [{ k: 'Stage', v: 'Land → Sell-out' }, { k: 'Coverage', v: 'Sunbelt · Coasts' }],
      to: '/agents',
    },
  ],
};

const portalTiles = [
  {
    index: '01', icon: Search, title: 'Search the collection',
    copy: 'Filter every residence by market, price, size, and character — no registration required.',
    action: 'search',
  },
  {
    index: '02', icon: LineChart, title: 'Deal Studio',
    copy: 'Underwrite any address yourself: rentals, flips, and multifamily with instant verdicts and downloadable workbooks.',
    action: 'studio',
  },
  {
    index: '03', icon: MessageCircle, title: 'Ask the concierge',
    copy: 'A real-estate intelligence partner for financing, taxes, neighborhoods, and negotiation — available on every page.',
    action: 'assistant',
  },
  {
    index: '04', icon: Users, title: 'Private advisors',
    copy: 'When it matters, move from self-service to full representation with a senior advisor in one step.',
    action: 'advisors',
  },
];

const formatPrice = (price) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
}).format(price);

/* ------------------------------------------------------------------ */
/* Hooks                                                               */
/* ------------------------------------------------------------------ */

const useReveal = () => {
  useEffect(() => {
    const nodes = document.querySelectorAll('[data-reveal]');
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.14 });
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);
};

const Counter = ({ value, prefix = '', suffix = '', decimals = 0 }) => {
  const ref = useRef(null);
  const [display, setDisplay] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || started.current) return;
      started.current = true;
      const duration = 1800;
      const t0 = performance.now();
      const tick = (now) => {
        const p = Math.min((now - t0) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        setDisplay(value * eased);
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [value]);

  return (
    <strong ref={ref}>
      {prefix && <i>{prefix}</i>}
      {display.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix && <i>{suffix}</i>}
    </strong>
  );
};

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

const Home = () => {
  const navigate = useNavigate();
  useReveal();

  /* Hero division switcher */
  const [division, setDivision] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return undefined;
    const timer = window.setInterval(() => setDivision((d) => (d + 1) % divisions.length), 6000);
    return () => window.clearInterval(timer);
  }, [paused]);
  const active = divisions[division];

  /* Section rail */
  const [activeSection, setActiveSection] = useState('overview');
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) setActiveSection(entry.target.id);
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    sections.forEach(({ id }) => {
      const node = document.getElementById(id);
      if (node) observer.observe(node);
    });
    return () => observer.disconnect();
  }, []);

  /* Explorer accordion */
  const [explorerTab, setExplorerTab] = useState('Residences');
  const [openItem, setOpenItem] = useState(0);

  /* Collection strip */
  const stripRef = useRef(null);
  const [stripProgress, setStripProgress] = useState(0.2);
  const onStripScroll = useCallback(() => {
    const node = stripRef.current;
    if (!node) return;
    const max = node.scrollWidth - node.clientWidth;
    setStripProgress(max > 0 ? Math.max(0.08, node.scrollLeft / max) : 1);
  }, []);
  const nudgeStrip = (direction) => {
    const node = stripRef.current;
    if (!node) return;
    node.scrollBy({ left: direction * Math.min(500, node.clientWidth * 0.85), behavior: 'smooth' });
  };

  /* Markets hover preview */
  const [marketIndex, setMarketIndex] = useState(0);
  const marketImages = useMemo(
    () => neighborhoods.map((n) => `${n.image}?auto=format&fit=crop&w=1400&q=82`),
    []
  );

  /* Deal card metric animation on view */
  const dealRef = useRef(null);
  const [dealLive, setDealLive] = useState(false);
  useEffect(() => {
    const node = dealRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setDealLive(true);
    }, { threshold: 0.4 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const collection = featuredProperties.length >= 4 ? properties.slice(0, 6) : featuredProperties;

  const onPortalTile = (action) => {
    if (action === 'search') navigate('/search');
    else if (action === 'studio') navigate('/investment-calculator');
    else if (action === 'advisors') navigate('/agents');
    else window.dispatchEvent(new CustomEvent('open-diamond-assistant'));
  };

  return (
    <main>
      {/* Section rail */}
      <nav className="mf-rail" aria-label="Page sections">
        {sections.map(({ id, label }) => (
          <button
            key={id}
            className={activeSection === id ? 'is-active' : ''}
            onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })}
            aria-label={`Go to ${label}`}
          >
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {/* Hero */}
      <section className="mf-hero" aria-label="DiamondEcho divisions">
        {divisions.map((item, index) => (
          <div
            key={item.name}
            className={`mf-hero__image ${index === division ? 'is-active' : ''}`}
            style={{ backgroundImage: `url(${item.image})` }}
            aria-hidden={index !== division}
          />
        ))}
        <div className="mf-hero__veil" />
        <div className="mf-hero__grid" />

        <div className="mf-hero__content">
          <div className="mf-hero__brand">
            <p>Private real estate · Global standards</p>
            <h1>Diamond Echo</h1>
          </div>
          <div
            className="mf-divisions"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            {divisions.map((item, index) => (
              <button
                key={item.name}
                className={index === division ? 'is-active' : ''}
                onClick={() => (index === division ? navigate(item.to) : setDivision(index))}
                aria-pressed={index === division}
              >
                <span>{item.index}</span>{item.name}
              </button>
            ))}
          </div>
        </div>

        <aside className="mf-hero__panel" key={active.name}>
          <small>{active.index} — {active.name}</small>
          <p>{active.copy}</p>
          <a href={active.to} onClick={(event) => { event.preventDefault(); navigate(active.to); }}>
            {active.cta} <ArrowUpRight />
          </a>
        </aside>

        <span className="mf-hero__side">Diamond Echo — Private Real Estate</span>

        <a className="mf-hero__scroll" href="#overview">Scroll down to discover</a>

        <div className="mf-hero__index">
          <span>0{division + 1}</span>
          <i style={{ '--progress': `${((division + 1) / divisions.length) * 100}%` }} />
          <span>0{divisions.length}</span>
        </div>
      </section>

      {/* Overview / statement */}
      <section className="mf-statement" id="overview">
        <div className="mf-statement__inner">
          <p className="eyebrow" data-reveal>The Firm</p>
          <h2 data-reveal>
            Operating privately.<br />
            <em>Leading with intelligence.</em>
          </h2>
          <p data-reveal style={{ '--reveal-delay': '.12s' }}>
            DiamondEcho manages a portfolio of exceptional residences and investment assets across
            America&apos;s signature markets. With deep local expertise and an institutional intelligence
            layer, we turn complex property economics into clear, explainable decisions — for first
            homes and for global portfolios alike.
          </p>
          <div className="mf-counters" data-reveal style={{ '--reveal-delay': '.2s' }}>
            {stats.map((stat) => (
              <article key={stat.label}>
                <Counter value={stat.value} prefix={stat.prefix} suffix={stat.suffix} decimals={stat.decimals || 0} />
                <span>{stat.label}</span>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Portfolio explorer */}
      <section className="mf-explorer" id="portfolio">
        <div className="mf-explorer__inner">
          <div className="mf-explorer__intro">
            <p className="eyebrow" data-reveal>Explore our portfolio</p>
            <h2 data-reveal>Every asset class,<br /><em>one standard.</em></h2>
            <p data-reveal style={{ '--reveal-delay': '.1s' }}>
              From landmark residences to income-producing assets, each vertical is run with the same
              discipline: private access, rigorous underwriting, and representation without compromise.
            </p>
            <div className="mf-explorer__tabs" data-reveal style={{ '--reveal-delay': '.15s' }} role="tablist">
              {Object.keys(explorerData).map((tab) => (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={explorerTab === tab}
                  className={explorerTab === tab ? 'is-active' : ''}
                  onClick={() => { setExplorerTab(tab); setOpenItem(0); }}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div className="mf-accordion" data-reveal style={{ '--reveal-delay': '.1s' }}>
            {explorerData[explorerTab].map((item, index) => (
              <div key={item.title} className={`mf-accordion__item ${openItem === index ? 'is-open' : ''}`}>
                <button
                  className="mf-accordion__head"
                  onClick={() => setOpenItem(openItem === index ? -1 : index)}
                  aria-expanded={openItem === index}
                >
                  <span>0{index + 1}</span>
                  <strong>{item.title}</strong>
                  <Plus />
                </button>
                <div className="mf-accordion__body">
                  <div>
                    <div className="mf-accordion__content">
                      <div>
                        <p>{item.copy}</p>
                        <dl>
                          {item.facts.map((fact) => (
                            <div key={fact.k}><dt>{fact.k}</dt><dd>{fact.v}</dd></div>
                          ))}
                        </dl>
                      </div>
                      <button className="text-link" onClick={() => navigate(item.to)}>
                        Explore <ArrowUpRight />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Collection strip */}
      <section className="mf-collection" id="collection">
        <div className="mf-collection__head">
          <div>
            <p className="eyebrow" data-reveal>The private collection</p>
            <h2 data-reveal>Remarkable by nature.<br /><em>Rare by definition.</em></h2>
          </div>
          <div className="mf-collection__controls" data-reveal>
            <button onClick={() => nudgeStrip(-1)} aria-label="Previous properties"><ChevronLeft /></button>
            <button onClick={() => nudgeStrip(1)} aria-label="Next properties"><ChevronRight /></button>
            <button className="mf-btn" onClick={() => navigate('/search')} style={{ marginLeft: 10 }}>
              View all <ArrowUpRight />
            </button>
          </div>
        </div>

        <div className="mf-strip" ref={stripRef} onScroll={onStripScroll}>
          {collection.map((property, index) => (
            <article
              key={property.id}
              className="mf-prop-card"
              data-reveal
              style={{ '--reveal-delay': `${index * 0.07}s` }}
              onClick={() => navigate(`/property/${property.id}`)}
              onKeyDown={(event) => event.key === 'Enter' && navigate(`/property/${property.id}`)}
              role="button"
              tabIndex={0}
            >
              <div className="mf-prop-card__media">
                <img src={`${property.images[0]}?auto=format&fit=crop&w=1200&q=82`} alt={property.title} loading="lazy" />
                <span className="mf-prop-card__status">{property.status}</span>
              </div>
              <div className="mf-prop-card__body">
                <small>{property.city}, {property.state}</small>
                <h3>{property.title}</h3>
                <div className="mf-prop-card__meta">
                  <strong>{formatPrice(property.price)}</strong>
                  <span>{property.beds} bd · {property.baths} ba · {property.sqft.toLocaleString()} sf</span>
                </div>
              </div>
            </article>
          ))}
        </div>
        <div className="mf-strip-progress"><i style={{ '--w': `${stripProgress * 100}%` }} /></div>
      </section>

      {/* Intelligence */}
      <section className="mf-intel" id="intelligence">
        <div className="mf-intel__content">
          <p className="eyebrow" data-reveal>Decision intelligence</p>
          <h2 data-reveal>Every opportunity,<br /><em>fully illuminated.</em></h2>
          <p data-reveal style={{ '--reveal-delay': '.1s' }}>
            Our intelligence layer underwrites rentals, flips, multifamily, and commercial deals with
            institutional rigor — IRR, cash-on-cash, DSCR, and Monte Carlo stress tests — then explains
            the verdict in plain language you can act on.
          </p>
          <button className="mf-btn mf-btn--solid" data-reveal style={{ '--reveal-delay': '.15s' }} onClick={() => navigate('/investment-calculator')}>
            <BarChart3 size={15} /> Analyze an opportunity
          </button>
        </div>
        <div className="mf-intel__visual">
          <div ref={dealRef} className={`mf-deal-card ${dealLive ? '' : 'is-idle'}`} data-reveal>
            <div className="mf-deal-card__head">
              <span><BarChart3 /> Deal studio — live model</span>
              <span className="mf-deal-card__verdict">Strong fit</span>
            </div>
            <div className="mf-deal-card__props">
              <div><small>Asset</small><strong>12-unit multifamily</strong></div>
              <div><small>Market</small><strong>Austin, TX</strong></div>
              <div><small>Strategy</small><strong>Value-add rental</strong></div>
            </div>
            <div className="mf-deal-card__metrics">
              <div><small>Projected IRR</small><strong>18.4%</strong><i style={{ '--fill': '84%' }} /></div>
              <div><small>Cash-on-cash</small><strong>9.7%</strong><i style={{ '--fill': '69%' }} /></div>
              <div><small>DSCR</small><strong>1.46×</strong><i style={{ '--fill': '74%' }} /></div>
            </div>
          </div>
        </div>
      </section>

      {/* Markets */}
      <section className="mf-markets" id="markets">
        <div className="mf-markets__inner">
          <div className="mf-markets__list">
            <p className="eyebrow" data-reveal>Signature markets</p>
            <h2 data-reveal>The world&apos;s most<br /><em>considered addresses.</em></h2>
            <div className="mf-markets__rows" data-reveal style={{ '--reveal-delay': '.1s' }}>
              {neighborhoods.map((place, index) => (
                <button
                  key={place.name}
                  className={marketIndex === index ? 'is-active' : ''}
                  onMouseEnter={() => setMarketIndex(index)}
                  onFocus={() => setMarketIndex(index)}
                  onClick={() => navigate(`/search?q=${encodeURIComponent(place.name)}`)}
                >
                  <span>0{index + 1}</span>
                  <strong>{place.name}</strong>
                  <small>{place.properties} residences · avg {formatPrice(place.avgPrice)}</small>
                  <ArrowUpRight />
                </button>
              ))}
            </div>
          </div>
          <div className="mf-markets__preview" data-reveal style={{ '--reveal-delay': '.15s' }}>
            <div className="mf-markets__frame">
              {marketImages.map((src, index) => (
                <img key={src} src={src} alt={neighborhoods[index].name} className={marketIndex === index ? 'is-active' : ''} loading="lazy" />
              ))}
            </div>
            <div className="mf-markets__caption">
              <strong>{neighborhoods[marketIndex].name}</strong>
              <span>{neighborhoods[marketIndex].city}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Client portal */}
      <section className="mf-portal" id="portal">
        <div className="mf-portal__inner">
          <div className="mf-portal__head">
            <p className="eyebrow" data-reveal>The client portal</p>
            <h2 data-reveal>Self-service,<br /><em>concierge standard.</em></h2>
            <p data-reveal style={{ '--reveal-delay': '.1s' }}>
              Everything you need to move on real estate — search, underwriting, guidance, and
              representation — available on your own terms, at any hour. Start yourself; escalate to a
              human advisor the moment it matters.
            </p>
          </div>
          <div className="mf-portal__grid">
            {portalTiles.map(({ index, icon: Icon, title, copy, action }, i) => (
              <button
                key={title}
                className="mf-portal__tile"
                data-reveal
                style={{ '--reveal-delay': `${i * 0.08}s` }}
                onClick={() => onPortalTile(action)}
              >
                <header><span>{index}</span><Icon /></header>
                <h3>{title}</h3>
                <p>{copy}</p>
                <footer>Open <ArrowRight /></footer>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Contact / closing */}
      <section className="mf-contact" id="contact">
        <div className="mf-contact__image" />
        <div className="mf-contact__veil" />
        <div className="mf-contact__content">
          <p className="eyebrow" data-reveal>Your next chapter</p>
          <h2 data-reveal>Some addresses are found.<br /><em>Others find you.</em></h2>
          <div className="mf-contact__actions" data-reveal style={{ '--reveal-delay': '.12s' }}>
            <button className="mf-btn mf-btn--solid" onClick={() => navigate('/agents')}>
              <Users size={15} /> Begin a private conversation
            </button>
            <button className="mf-btn" onClick={() => navigate('/search')}>
              <Building2 size={15} /> Browse the collection
            </button>
          </div>
        </div>
      </section>
    </main>
  );
};

export default Home;
