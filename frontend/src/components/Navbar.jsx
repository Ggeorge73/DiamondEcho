import React, { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Diamond, Menu, Search, X } from 'lucide-react';

const navItems = [
  { label: 'Residences', to: '/search' },
  { label: 'Rentals', to: '/search?status=rent' },
  { label: 'Intelligence', to: '/investment-calculator' },
  { label: 'Advisors', to: '/agents' },
  { label: 'Maison', to: '/about' },
];

const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = isMenuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isMenuOpen]);

  const closeAndNavigate = (to) => {
    setIsMenuOpen(false);
    navigate(to);
  };

  return (
    <header className={`luxury-nav ${isScrolled || isMenuOpen ? 'luxury-nav--solid' : ''}`}>
      <div className="luxury-nav__inner">
        <Link to="/" className="luxury-wordmark" aria-label="DiamondEcho home">
          <span className="luxury-wordmark__mark"><Diamond aria-hidden="true" /></span>
          <span>
            <strong>DIAMOND ECHO</strong>
            <small>PRIVATE REAL ESTATE</small>
          </span>
        </Link>

        <nav className="luxury-nav__links" aria-label="Primary navigation">
          {navItems.map((item) => (
            <NavLink key={item.label} to={item.to}>{item.label}</NavLink>
          ))}
        </nav>

        <div className="luxury-nav__actions">
          <button className="icon-button" onClick={() => navigate('/search')} aria-label="Search properties">
            <Search size={18} />
          </button>
          <button className="nav-consultation" onClick={() => navigate('/agents')}>
            Private consultation <ArrowUpRight size={15} />
          </button>
        </div>

        <button
          className="luxury-nav__menu"
          onClick={() => setIsMenuOpen((open) => !open)}
          aria-expanded={isMenuOpen}
          aria-controls="mobile-navigation"
          aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
        >
          {isMenuOpen ? <X /> : <Menu />}
        </button>
      </div>

      {isMenuOpen && (
        <div id="mobile-navigation" className="mobile-luxury-menu">
          <p>Private real estate, precisely considered.</p>
          <nav aria-label="Mobile navigation">
            {navItems.map((item, index) => (
              <button key={item.label} onClick={() => closeAndNavigate(item.to)}>
                <span>0{index + 1}</span>{item.label}<ArrowUpRight />
              </button>
            ))}
          </nav>
          <button className="mobile-luxury-menu__cta" onClick={() => closeAndNavigate('/agents')}>
            Request a private consultation
          </button>
        </div>
      )}
    </header>
  );
};

export default Navbar;
