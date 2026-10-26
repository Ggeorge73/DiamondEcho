import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight, ArrowUpRight, BarChart3, Building2,
  LineChart, MessageCircle, Plus, Search, Users,
} from 'lucide-react';
import GamlsSearch from '../components/GamlsSearch';
import MarketBrief from '../components/MarketBrief';
import LatestEpisode from '../components/LatestEpisode';
import { assistantAvailable, openAssistant } from '../lib/assistant';
import { SERVICE_AREAS, serviceAreaList } from '../lib/pageMeta';

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */

const divisions = [
  {
    index: '01',
    name: 'Residences',
    to: '/search',
    cta: 'Search Georgia MLS',
    copy: 'Explore homes through Georgia MLS and choose the location, price, and property features that matter to you.',
    image: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=2200&q=88',
  },
  {
    index: '02',
    name: 'Rentals',
    to: '/search?status=rent',
    cta: 'Explore rental options',
    copy: 'Explore available rental options in Georgia MLS. Select rental criteria within the provider’s search.',
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
    cta: 'Explore advisory',
    copy: 'See how property search, deal analysis, and buying or selling inquiries fit together.',
    image: 'https://images.unsplash.com/photo-1600607688969-a5bfcd646154?auto=format&fit=crop&w=2200&q=88',
  },
];

const sections = [
  { id: 'overview', label: 'Overview' },
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'collection', label: 'Property search' },
  { id: 'intelligence', label: 'Intelligence' },
  { id: 'portal', label: 'Explore' },
  { id: 'contact', label: 'Contact' },
];

const explorerData = {
  Residences: [
    {
      title: 'Homes for sale',
      copy: 'Search available properties through Georgia MLS. Set your city, county, price, and preferred features within the search form.',
      facts: [{ k: 'Source', v: 'Georgia MLS' }, { k: 'Search', v: 'Location and property criteria' }],
      to: '/search',
    },
    {
      title: 'Rental properties',
      copy: 'Opens the Georgia MLS search with Rental (Residential) already selected under Type. Tick Rental (Commercial) there if you need it.',
      facts: [{ k: 'Source', v: 'Georgia MLS' }, { k: 'Filter', v: 'Rental (Residential) pre-selected' }],
      to: '/search?status=rent',
    },
  ],
  // Every item here describes something Deal Studio does with the figures the
  // visitor enters, and opens Deal Studio. None is a service, a market
  // statistic or a coverage area: those need Gbenga's approval first (DE-17).
  Investments: [
    {
      title: 'Multifamily',
      copy: 'Model value-add and stabilized multifamily from the rent and expense figures you enter: IRR, cash-on-cash, and DSCR, before you tour the asset.',
      facts: [{ k: 'Strategy', v: 'Rental & commercial' }, { k: 'Modeled in', v: 'Deal Studio' }],
      to: '/investment-calculator',
    },
    {
      title: 'Fix & Flip',
      copy: 'Acquisition, rehab budget, carry, and resale modeled with Monte Carlo ranges, so you can see a spread of outcomes before the offer goes in.',
      facts: [{ k: 'Strategy', v: 'Fix & flip' }, { k: 'Modeled in', v: 'Deal Studio' }],
      to: '/investment-calculator',
    },
    {
      title: 'Commercial',
      copy: 'Model office, retail, industrial, mixed-use, and hospitality income property from your own rent, expense, and financing figures.',
      facts: [{ k: 'Strategy', v: 'Rental & commercial' }, { k: 'Modeled in', v: 'Deal Studio' }],
      to: '/investment-calculator',
    },
    {
      title: 'New Development',
      copy: 'Model a land or ground-up project from your own figures: site work, construction, carrying costs, and a sale or a stabilized hold.',
      facts: [{ k: 'Strategy', v: 'Land development' }, { k: 'Modeled in', v: 'Deal Studio' }],
      to: '/investment-calculator',
    },
  ],
};

const portalTiles = [
  {
    icon: Search, title: 'Search Georgia MLS',
    copy: 'Explore Georgia MLS listings by location, price, and property preferences.',
    action: 'search',
  },
  {
    icon: LineChart, title: 'Deal Studio',
    copy: 'Underwrite any address yourself: rentals, flips, and multifamily with instant verdicts and downloadable workbooks.',
    action: 'studio',
  },
  {
    icon: MessageCircle, title: 'Ask the concierge',
    copy: 'General answers on buying, selling, renting, financing, and taxes, with their sources. Educational information, not advice.',
    action: 'assistant',
  },
  {
    icon: Users, title: 'Advisory',
    copy: 'Explore the ways to begin a buying or selling conversation.',
    action: 'advisors',
  },
];

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

  // The assistant tile is offered only where a service can answer (DE-20).
  const assistantOffered = assistantAvailable();
  const tiles = portalTiles.filter(({ action }) => action !== 'assistant' || assistantOffered);

  const onPortalTile = (action) => {
    if (action === 'search') navigate('/search');
    else if (action === 'studio') navigate('/investment-calculator');
    else if (action === 'advisors') navigate('/agents');
    else openAssistant();
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

      {/* Daily welcome, site tour and Georgia market brief, read aloud */}
      <MarketBrief />
      <LatestEpisode />

      {/* Overview / statement */}
      <section className="mf-statement" id="overview">
        <div className="mf-statement__inner">
          <p className="eyebrow" data-reveal>The Firm</p>
          <h2 data-reveal>
            Operating privately.<br />
            <em>Leading with intelligence.</em>
          </h2>
          <p data-reveal style={{ '--reveal-delay': '.12s' }}>
            Search Georgia MLS listings, explore property questions, and model potential
            purchases with DiamondEcho. Start with a location, compare available properties,
            and contact us to discuss your next step.
          </p>
        </div>
      </section>

      {/* Where DiamondEcho works. The cities are the ones Gbenga named on
          2026-10-10 (lib/pageMeta.js); a city is added there, not here. */}
      <section className="mf-statement mf-statement--areas" aria-labelledby="home-areas-heading">
        <div className="mf-statement__inner">
          <p className="eyebrow" data-reveal>Where we work</p>
          <h2 id="home-areas-heading" data-reveal>
            Homes and investments<br />
            <em>across metro Atlanta.</em>
          </h2>
          <p data-reveal style={{ '--reveal-delay': '.12s' }}>
            DiamondEcho works with home buyers, sellers and real estate investors
            in {serviceAreaList()}, from the brokerage office in Duluth, Georgia.
          </p>
          <ul className="mf-areas" data-reveal style={{ '--reveal-delay': '.18s' }}>
            {SERVICE_AREAS.map(({ city, county }) => (
              <li key={city}><strong>{city}</strong><small>{county}</small></li>
            ))}
            <li className="mf-areas__more">
              <Link to="/search">Search anywhere in Georgia <ArrowUpRight /></Link>
            </li>
          </ul>
        </div>
      </section>

      {/* Portfolio explorer */}
      <section className="mf-explorer" id="portfolio">
        <div className="mf-explorer__inner">
          <div className="mf-explorer__intro">
            <p className="eyebrow" data-reveal>Explore your options</p>
            <h2 data-reveal>Every asset class,<br /><em>one standard.</em></h2>
            <p data-reveal style={{ '--reveal-delay': '.1s' }}>
              Search properties through Georgia MLS, or explore tools for evaluating
              a potential investment. Choose the path that fits your goals.
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

      {/* Georgia MLS search */}
      <section className="mf-collection" id="collection" aria-labelledby="home-search-heading">
        <div className="mf-collection__head">
          <div>
            <p className="eyebrow">Georgia MLS property search</p>
            <h2 id="home-search-heading">Find your next home.<br /><em>Search right here.</em></h2>
          </div>
        </div>
        <GamlsSearch loading="lazy" />
      </section>

      {/* Intelligence */}
      <section className="mf-intel" id="intelligence">
        <div className="mf-intel__content">
          <p className="eyebrow" data-reveal>Decision intelligence</p>
          <h2 data-reveal>Every opportunity,<br /><em>fully illuminated.</em></h2>
          <p data-reveal style={{ '--reveal-delay': '.1s' }}>
            Our intelligence layer underwrites rentals, flips, multifamily, and commercial deals with
            institutional rigor — IRR, cash-on-cash, DSCR, and Monte Carlo stress tests — then explains
            the result in plain language for you to review. Results are estimates from the figures
            you enter, not advice.
          </p>
          <button className="mf-btn mf-btn--solid" data-reveal style={{ '--reveal-delay': '.15s' }} onClick={() => navigate('/investment-calculator')}>
            <BarChart3 size={15} /> Analyze an opportunity
          </button>
        </div>
        <div className="mf-intel__visual">
          <div className="mf-deal-card">
            <div className="mf-deal-card__head"><span><BarChart3 /> Deal Studio</span></div>
            <div className="mf-deal-card__props">
              <div><small>Step 1</small><strong>Enter a property</strong></div>
              <div><small>Step 2</small><strong>Review assumptions</strong></div>
              <div><small>Step 3</small><strong>Compare scenarios</strong></div>
            </div>
            <p>Use your own property information and financial assumptions. Georgia MLS search selections are not automatically imported into Deal Studio.</p>
          </div>
        </div>
      </section>

      {/* Public services */}
      <section className="mf-portal" id="portal">
        <div className="mf-portal__inner">
          <div className="mf-portal__head">
            <p className="eyebrow" data-reveal>Explore DiamondEcho</p>
            <h2 data-reveal>Explore properties.<br /><em>Consider your next move.</em></h2>
            <p data-reveal style={{ '--reveal-delay': '.1s' }}>
              {assistantOffered
                ? 'Browse residences, model a potential deal, and ask property questions online.'
                : 'Browse residences and model a potential deal.'}
              {' '}See the available paths for beginning a buying or selling inquiry.
            </p>
          </div>
          <div className={`mf-portal__grid${tiles.length === 3 ? ' mf-portal__grid--three' : ''}`}>
            {tiles.map(({ icon: Icon, title, copy, action }, i) => (
              <button
                key={title}
                className="mf-portal__tile"
                data-reveal
                style={{ '--reveal-delay': `${i * 0.08}s` }}
                onClick={() => onPortalTile(action)}
              >
                <header><span>{String(i + 1).padStart(2, '0')}</span><Icon /></header>
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
            <button className="mf-btn mf-btn--solid" onClick={() => navigate('/inquire?type=buyer')}>
              <Users size={15} /> Ask about buying
            </button>
            <button className="mf-btn" onClick={() => navigate('/inquire?type=seller')}>
              <Building2 size={15} /> Discuss selling
            </button>
          </div>
        </div>
      </section>
    </main>
  );
};

export default Home;
