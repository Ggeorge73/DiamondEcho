import React from 'react';
import { Link } from 'react-router-dom';
import { Diamond } from 'lucide-react';
import { BROKERAGE, OFFICE } from '../lib/contact';
import { assistantAvailable, openAssistant } from '../lib/assistant';

const Footer = () => (
  <footer className="mf-footer">
    <div className="mf-footer__top">
      <div className="mf-footer__brand">
        <span className="mf-footer__mark"><Diamond /></span>
        <strong>DIAMOND ECHO</strong>
        <small>PRIVATE REAL ESTATE</small>
        <p>
          Georgia MLS property search, deal analysis, and ways to begin
          a buying or selling conversation.
        </p>
      </div>

      <div className="mf-footer__col">
        <h4>Divisions</h4>
        <nav>
          <Link to="/search">Residences</Link>
          <Link to="/search?status=rent">Rentals</Link>
          <Link to="/investment-calculator">Investments</Link>
          <Link to="/agents">Advisory</Link>
        </nav>
      </div>

      <div className="mf-footer__col">
        <h4>Explore</h4>
        <nav>
          <Link to="/search">Search Georgia MLS</Link>
          <Link to="/investment-calculator">Deal studio</Link>
          <Link to="/inquire?type=buyer">Buyer inquiry</Link>
          <Link to="/inquire?type=seller">Seller consultation</Link>
          {assistantAvailable() && (
            <button onClick={openAssistant}>
              Ask the concierge
            </button>
          )}
          <Link to="/about">The firm</Link>
        </nav>
      </div>
    </div>

    <div className="mf-offices">
      <div className="mf-offices__brokerage">
        <h3>Brokerage</h3>
        <p>{BROKERAGE.name}</p>
        <a href={BROKERAGE.phoneHref}>Office {BROKERAGE.phone}</a>
      </div>
      <div>
        <h3>Georgia office</h3>
        <p>8735 Dunwoody Place<br />GA 30350, USA</p>
        <a href={OFFICE.phoneHref}>Direct {OFFICE.phone}</a>
        <a href={OFFICE.emailHref}>{OFFICE.email}</a>
      </div>
    </div>

    <div className="mf-footer__legal">
      <span>© {new Date().getFullYear()} DiamondEcho Private Real Estate · Brokerage: {BROKERAGE.name} — All rights reserved</span>
      <span>
        Equal Housing Opportunity · <Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms of use</Link>
      </span>
    </div>
  </footer>
);

export default Footer;
