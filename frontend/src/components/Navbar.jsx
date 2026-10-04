import React, { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Diamond, LayoutGrid, Menu, X } from 'lucide-react';
import { OFFICE } from '../lib/contact';

const navItems = [
  { label: 'Search homes', to: '/search' },
  { label: 'Rentals', to: '/search?status=rent' },
  { label: 'Intelligence', to: '/investment-calculator' },
  { label: 'Advisory', to: '/agents' },
  { label: 'The Firm', to: '/about' },
];

const menuItems = [
  { index: '01', label: 'Search homes', to: '/search' },
  { index: '02', label: 'Rentals', to: '/search?status=rent' },
  { index: '03', label: 'Deal Intelligence', to: '/investment-calculator' },
  { index: '04', label: 'Advisory', to: '/agents' },
  { index: '05', label: 'The Firm', to: '/about' },
];

const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const openerRef = useRef(null);
  const menuRef = useRef(null);
  const closeRef = useRef(null);
  const restoreFocusRef = useRef(false);
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
    if (!isMenuOpen) {
      if (restoreFocusRef.current) openerRef.current?.focus();
      restoreFocusRef.current = false;
      return undefined;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        restoreFocusRef.current = true;
        setIsMenuOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...menuRef.current.querySelectorAll('a[href], button:not([disabled])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !menuRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !menuRef.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isMenuOpen]);

  useEffect(() => { setIsMenuOpen(false); }, [pathname]);

  const closeAndNavigate = (to) => {
    restoreFocusRef.current = false;
    setIsMenuOpen(false);
    navigate(to);
  };

  return (
    <>
      <header className={`mf-nav ${isScrolled || isMenuOpen ? 'mf-nav--solid' : ''}`}>
        <div className="mf-nav__inner">
          <Link to="/" className="mf-wordmark" aria-label="DiamondEcho home" onClick={() => { restoreFocusRef.current = false; setIsMenuOpen(false); }}>
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
              <LayoutGrid size={14} /> Search homes
            </button>
            <button
              ref={openerRef}
              className="mf-nav__burger"
              onClick={() => {
                if (isMenuOpen) restoreFocusRef.current = true;
                setIsMenuOpen((open) => !open);
              }}
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
        <div id="mf-overlay-menu" ref={menuRef} className="mf-menu" role="dialog" aria-modal="true" aria-label="Site menu">
          <button ref={closeRef} className="mf-menu__close" type="button" onClick={() => { restoreFocusRef.current = true; setIsMenuOpen(false); }} aria-label="Close site menu">
            <X aria-hidden="true" /> Close menu
          </button>
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
              <h4>Explore DiamondEcho</h4>
              <nav>
                <button onClick={() => closeAndNavigate('/search')}>Search Georgia MLS</button>
                <button onClick={() => closeAndNavigate('/investment-calculator')}>Run a deal analysis</button>
                <button onClick={() => { restoreFocusRef.current = false; setIsMenuOpen(false); window.dispatchEvent(new CustomEvent('open-diamond-assistant')); }}>
                  Ask the concierge
                </button>
                <button onClick={() => closeAndNavigate('/agents')}>Explore advisory</button>
                <button onClick={() => closeAndNavigate('/inquire?type=buyer')}>Buyer inquiry</button>
                <button onClick={() => closeAndNavigate('/inquire?type=seller')}>Seller consultation</button>
              </nav>
            </div>
            <div className="mf-menu__contact">
              <h4>Georgia office</h4>
              <p>8735 Dunwoody Place<br />GA 30350, USA</p>
              <p>
                <a href={OFFICE.phoneHref}>{OFFICE.phone}</a><br />
                <a href={OFFICE.emailHref}>{OFFICE.email}</a>
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Navbar;
