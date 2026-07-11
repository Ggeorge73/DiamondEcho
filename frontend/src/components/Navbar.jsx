import React, { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Diamond, LayoutGrid, Menu, X } from 'lucide-react';

const navItems = [
  { label: 'Residences', to: '/search' },
  { label: 'Rentals', to: '/search?status=rent' },
  { label: 'Intelligence', to: '/investment-calculator' },
  { label: 'Advisors', to: '/agents' },
  { label: 'The Firm', to: '/about' },
];

const menuItems = [
  { index: '01', label: 'Residences', to: '/search' },
  { index: '02', label: 'Rentals', to: '/search?status=rent' },
  { index: '03', label: 'Deal Intelligence', to: '/investment-calculator' },
  { index: '04', label: 'Advisors', to: '/agents' },
  { index: '05', label: 'The Firm', to: '/about' },
];

const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isHomePage = pathname === '/';

  useEffect(() => {
    if (!isHomePage) {
      setIsScrolled(true);
      return undefined;
    }
    const onScroll = () => setIsScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [isHomePage]);

  useEffect(() => {
    document.body.style.overflow = isMenuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isMenuOpen]);

  useEffect(() => { setIsMenuOpen(false); }, [pathname]);

  const closeAndNavigate = (to) => {
    setIsMenuOpen(false);
    navigate(to);
  };

  return (
    <>
      <header className={`mf-nav ${isScrolled || isMenuOpen ? 'mf-nav--solid' : ''}`}>
        <div className="mf-nav__inner">
          <Link to="/" className="mf-wordmark" aria-label="DiamondEcho home" onClick={() => setIsMenuOpen(false)}>
            <span className="mf-wordmark__mark"><Diamond aria-hidden="true" /></span>
            <span>
              <strong>DIAMOND ECHO</strong>
              <small>PRIVATE REAL ESTATE</small>
            </span>
          </Link>

          <nav className="mf-nav__links" aria-label="Primary navigation">
            {navItems.map((item) => (
              <NavLink key={item.label} to={item.to}>{item.label}</NavLink>
            ))}
          </nav>

          <div className="mf-nav__actions">
            <button className="mf-nav__portal" onClick={() => navigate('/search')}>
              <LayoutGrid size={14} /> Client portal
            </button>
            <button
              className="mf-nav__burger"
              onClick={() => setIsMenuOpen((open) => !open)}
              aria-expanded={isMenuOpen}
              aria-controls="mf-overlay-menu"
              aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
            >
              {isMenuOpen ? <X /> : <Menu />} {isMenuOpen ? 'Close' : 'Menu'}
            </button>
          </div>
        </div>
      </header>

      {isMenuOpen && (
        <div id="mf-overlay-menu" className="mf-menu" role="dialog" aria-label="Site menu">
          <div className="mf-menu__primary">
            {menuItems.map((item) => (
              <a
                key={item.label}
                href={item.to}
                onClick={(event) => { event.preventDefault(); closeAndNavigate(item.to); }}
              >
                <span>{item.index}</span>{item.label}<ArrowUpRight />
              </a>
            ))}
          </div>
          <div className="mf-menu__secondary">
            <div>
              <h4>Self-service portal</h4>
              <nav>
                <button onClick={() => closeAndNavigate('/search')}>Search the collection</button>
                <button onClick={() => closeAndNavigate('/investment-calculator')}>Run a deal analysis</button>
                <button onClick={() => { setIsMenuOpen(false); window.dispatchEvent(new CustomEvent('open-diamond-assistant')); }}>
                  Ask the concierge
                </button>
                <button onClick={() => closeAndNavigate('/agents')}>Request representation</button>
              </nav>
            </div>
            <div className="mf-menu__contact">
              <h4>Contact</h4>
              <p><a href="mailto:concierge@diamondecho.com">concierge@diamondecho.com</a></p>
              <p><a href="tel:+12125550188">+1 212 555 0188</a></p>
              <p>New York · Miami · Los Angeles</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Navbar;
