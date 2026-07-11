import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowDown, ArrowRight, ArrowUpRight, BarChart3,
  ChevronLeft, ChevronRight, KeyRound, Landmark,
  MessageCircle, Search, ShieldCheck, Sparkles, TrendingUp
} from 'lucide-react';
import { featuredProperties, neighborhoods } from '../data/mockData';

const heroSlides = [
  {
    image: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=2200&q=90',
    location: 'Trousdale Estates · Beverly Hills',
    title: ['Where architecture', 'becomes legacy.'],
  },
  {
    image: 'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=2200&q=90',
    location: 'Ocean House · Miami Beach',
    title: ['Exceptional living,', 'privately represented.'],
  },
  {
    image: 'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?auto=format&fit=crop&w=2200&q=90',
    location: 'Modern Estate · Austin',
    title: ['Real estate,', 'intelligently considered.'],
  },
];

const services = [
  { number: '01', icon: KeyRound, title: 'Acquire', copy: 'Private access, discreet representation, and a global search tailored to how you want to live.' },
  { number: '02', icon: Landmark, title: 'Sell', copy: 'Editorial storytelling, qualified global reach, and a strategy calibrated to protect value.' },
  { number: '03', icon: TrendingUp, title: 'Invest', copy: 'Institutional-grade underwriting for rentals, flips, multifamily, and commercial opportunities.' },
  { number: '04', icon: ShieldCheck, title: 'Transact', copy: 'A coordinated path through financing, diligence, negotiation, closing, and ownership.' },
];

const formatPrice = (price) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
}).format(price);

const Home = () => {
  const navigate = useNavigate();
  const [slide, setSlide] = React.useState(0);
  const [searchValue, setSearchValue] = React.useState('');

  React.useEffect(() => {
    const timer = window.setInterval(() => setSlide((current) => (current + 1) % heroSlides.length), 7000);
    return () => window.clearInterval(timer);
  }, []);

  const advance = (direction) => {
    setSlide((current) => (current + direction + heroSlides.length) % heroSlides.length);
  };

  const submitSearch = (event) => {
    event.preventDefault();
    navigate(searchValue ? `/search?q=${encodeURIComponent(searchValue)}` : '/search');
  };

  return (
    <main className="luxury-home">
      <section className="editorial-hero" aria-label="Featured private residences">
        {heroSlides.map((item, index) => (
          <div
            className={`editorial-hero__image ${index === slide ? 'is-active' : ''}`}
            style={{ backgroundImage: `url(${item.image})` }}
            key={item.location}
            aria-hidden={index !== slide}
          />
        ))}
        <div className="editorial-hero__veil" />
        <div className="editorial-hero__content">
          <p className="eyebrow eyebrow--light"><span /> PRIVATE REAL ESTATE · GLOBAL</p>
          <h1>
            <span>{heroSlides[slide].title[0]}</span>
            <em>{heroSlides[slide].title[1]}</em>
          </h1>
          <div className="editorial-hero__meta">
            <p>{heroSlides[slide].location}</p>
            <button onClick={() => navigate('/search')}>Explore the collection <ArrowUpRight /></button>
          </div>
        </div>

        <div className="editorial-hero__controls">
          <button onClick={() => advance(-1)} aria-label="Previous residence"><ChevronLeft /></button>
          <span>0{slide + 1} <i /> 0{heroSlides.length}</span>
          <button onClick={() => advance(1)} aria-label="Next residence"><ChevronRight /></button>
        </div>
        <a className="editorial-hero__scroll" href="#discover">Discover <ArrowDown /></a>
      </section>

      <section className="property-search" id="discover">
        <div className="property-search__intro">
          <p className="eyebrow">PRIVATE COLLECTION</p>
          <h2>Find a place<br /><em>without equal.</em></h2>
        </div>
        <form className="property-search__form" onSubmit={submitSearch}>
          <label htmlFor="property-search">Where would you like to be?</label>
          <div>
            <Search />
            <input
              id="property-search"
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="City, neighborhood, address, or private listing ID"
            />
            <button type="submit">Search <ArrowRight /></button>
          </div>
          <nav aria-label="Property search categories">
            <button type="button" onClick={() => navigate('/search')}>Buy</button>
            <button type="button" onClick={() => navigate('/search?status=rent')}>Rent</button>
            <button type="button" onClick={() => navigate('/investment-calculator')}>Invest</button>
            <button type="button" onClick={() => navigate('/agents')}>Sell with us</button>
          </nav>
        </form>
      </section>

      <section className="collection-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">THE PRIVATE COLLECTION</p>
            <h2>Remarkable by nature.<br /><em>Rare by definition.</em></h2>
          </div>
          <button onClick={() => navigate('/search')}>View all residences <ArrowUpRight /></button>
        </div>

        <div className="residence-grid">
          {featuredProperties.slice(0, 3).map((property, index) => (
            <article
              className={`residence-card residence-card--${index + 1}`}
              key={property.id}
              onClick={() => navigate(`/property/${property.id}`)}
              onKeyDown={(event) => event.key === 'Enter' && navigate(`/property/${property.id}`)}
              role="button"
              tabIndex={0}
            >
              <img src={`${property.images[0]}?auto=format&fit=crop&w=1400&q=88`} alt={property.title} />
              <div className="residence-card__scrim" />
              <div className="residence-card__tag">PRIVATE LISTING · 0{index + 1}</div>
              <div className="residence-card__content">
                <p>{property.city}, {property.state}</p>
                <h3>{property.title}</h3>
                <div>
                  <strong>{formatPrice(property.price)}</strong>
                  <span>{property.beds} beds · {property.baths} baths · {property.sqft.toLocaleString()} sq ft</span>
                </div>
              </div>
              <span className="residence-card__arrow"><ArrowUpRight /></span>
            </article>
          ))}
        </div>
      </section>

      <section className="intelligence-section">
        <div className="intelligence-section__visual">
          <img src="https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1600&q=85" alt="Advisors reviewing a real estate investment" />
          <div className="intelligence-section__badge"><Sparkles /> DIAMOND ECHO INTELLIGENCE</div>
        </div>

        <div className="intelligence-section__content">
          <p className="eyebrow eyebrow--light">DECISION INTELLIGENCE</p>
          <h2>Every opportunity,<br /><em>fully illuminated.</em></h2>
          <p className="intelligence-section__lede">
            From a first home to a global portfolio, our intelligence layer turns complex property economics into clear, explainable decisions.
          </p>

          <div className="deal-preview">
            <div className="deal-preview__head">
              <span><BarChart3 /> DEAL STUDIO</span>
              <span className="deal-preview__status">STRONG FIT</span>
            </div>
            <div className="deal-preview__property">
              <div><small>ASSET</small><strong>12-unit multifamily</strong></div>
              <div><small>MARKET</small><strong>Austin, TX</strong></div>
              <div><small>STRATEGY</small><strong>Value-add rental</strong></div>
            </div>
            <div className="deal-preview__metrics">
              <div><small>PROJECTED IRR</small><strong>18.4%</strong><i style={{ '--fill': '84%' }} /></div>
              <div><small>CASH-ON-CASH</small><strong>9.7%</strong><i style={{ '--fill': '69%' }} /></div>
              <div><small>DSCR</small><strong>1.46×</strong><i style={{ '--fill': '74%' }} /></div>
            </div>
          </div>

          <button className="text-link text-link--light" onClick={() => navigate('/investment-calculator')}>
            Analyze an opportunity <ArrowUpRight />
          </button>
        </div>
      </section>

      <section className="journey-section">
        <div className="section-heading section-heading--center">
          <div>
            <p className="eyebrow">ONE MAISON. EVERY MOVE.</p>
            <h2>Your entire real estate journey,<br /><em>beautifully orchestrated.</em></h2>
          </div>
        </div>
        <div className="journey-grid">
          {services.map(({ number, icon: Icon, title, copy }) => (
            <article key={title}>
              <div><span>{number}</span><Icon /></div>
              <h3>{title}</h3>
              <p>{copy}</p>
              <button onClick={() => navigate(title === 'Invest' ? '/investment-calculator' : title === 'Acquire' ? '/search' : '/agents')} aria-label={`Explore ${title}`}><ArrowUpRight /></button>
            </article>
          ))}
        </div>
      </section>

      <section className="destinations-section">
        <div className="destinations-section__intro">
          <p className="eyebrow eyebrow--light">SIGNATURE MARKETS</p>
          <h2>The world’s most<br /><em>considered addresses.</em></h2>
          <p>Local knowledge, private access, and connected representation across the markets that matter.</p>
          <button className="text-link text-link--light" onClick={() => navigate('/search')}>Explore all markets <ArrowUpRight /></button>
        </div>
        <div className="destinations-section__list">
          {neighborhoods.map((place, index) => (
            <button key={place.name} onClick={() => navigate(`/search?q=${encodeURIComponent(place.name)}`)}>
              <span>0{index + 1}</span>
              <strong>{place.name}</strong>
              <small>{place.city} · {place.properties} residences</small>
              <ArrowUpRight />
            </button>
          ))}
        </div>
      </section>

      <section className="concierge-section">
        <div className="concierge-section__content">
          <p className="eyebrow">PRIVATE CONCIERGE</p>
          <h2>Ask anything.<br /><em>Move with clarity.</em></h2>
          <p>Explore buying, selling, financing, taxes, neighborhoods, and investment strategy with a real-estate intelligence partner—then connect with a human advisor when it matters.</p>
          <div>
            <button onClick={() => window.dispatchEvent(new CustomEvent('open-diamond-assistant'))}><MessageCircle /> Ask DiamondEcho</button>
            <button onClick={() => navigate('/agents')}>Speak with an advisor <ArrowUpRight /></button>
          </div>
          <small>Educational guidance only. Legal, tax, mortgage, and investment decisions should be reviewed with qualified professionals.</small>
        </div>
        <div className="concierge-section__visual">
          <img src="https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1600&q=88" alt="Elegant contemporary residence interior" />
          <div className="concierge-card">
            <span><MessageCircle /> PRIVATE ASSISTANT</span>
            <p>“What should I know before making an offer on a historic property?”</p>
            <div><Sparkles /><span>I’ll walk you through inspections, restrictions, insurance, financing, and negotiation considerations.</span></div>
          </div>
        </div>
      </section>

      <section className="closing-statement">
        <div className="closing-statement__image" />
        <div className="closing-statement__veil" />
        <div>
          <p className="eyebrow eyebrow--light">YOUR NEXT CHAPTER</p>
          <h2>Some addresses are found.<br /><em>Others find you.</em></h2>
          <button onClick={() => navigate('/agents')}>Begin a private conversation <ArrowUpRight /></button>
        </div>
      </section>

    </main>
  );
};

export default Home;
