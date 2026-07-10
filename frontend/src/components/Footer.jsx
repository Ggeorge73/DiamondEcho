import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Diamond, Instagram, Linkedin } from 'lucide-react';

const Footer = () => (
  <footer className="maison-footer">
    <div className="maison-footer__lead">
      <p className="eyebrow eyebrow--light">THE DIAMOND ECHO MAISON</p>
      <h2>A singular address<br />for every move.</h2>
      <Link to="/agents">Begin a private conversation <ArrowUpRight /></Link>
    </div>

    <div className="maison-footer__grid">
      <div className="maison-footer__brand">
        <span className="maison-footer__mark"><Diamond /></span>
        <strong>DIAMOND ECHO</strong>
        <p>Global perspective. Local intelligence.<br />Representation without compromise.</p>
      </div>

      <div>
        <small>DISCOVER</small>
        <Link to="/search">Private residences</Link>
        <Link to="/search?status=rent">Curated rentals</Link>
        <Link to="/investment-calculator">Deal intelligence</Link>
      </div>
      <div>
        <small>THE MAISON</small>
        <Link to="/about">Our philosophy</Link>
        <Link to="/agents">Private advisors</Link>
        <a href="mailto:concierge@diamondecho.com">Concierge</a>
      </div>
      <div>
        <small>CONNECT</small>
        <a href="mailto:concierge@diamondecho.com">concierge@diamondecho.com</a>
        <a href="tel:+12125550188">+1 212 555 0188</a>
        <span className="maison-footer__social"><Instagram /><Linkedin /></span>
      </div>
    </div>

    <div className="maison-footer__legal">
      <span>© {new Date().getFullYear()} DiamondEcho Private Real Estate</span>
      <span>Equal Housing Opportunity · Privacy · Terms</span>
      <span>New York · Miami · Los Angeles · Global</span>
    </div>
  </footer>
);

export default Footer;
