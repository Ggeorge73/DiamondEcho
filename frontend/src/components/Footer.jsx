import React from 'react';
import { Link } from 'react-router-dom';
import { Diamond } from 'lucide-react';

const offices = [
  {
    city: 'New York',
    address: '432 Park Avenue, Suite 1800\nNew York, NY 10022',
    phone: '+1 212 555 0188',
    email: 'newyork@diamondecho.com',
  },
  {
    city: 'Miami',
    address: '1450 Brickell Avenue, 23rd Floor\nMiami, FL 33131',
    phone: '+1 305 555 0123',
    email: 'miami@diamondecho.com',
  },
  {
    city: 'Los Angeles',
    address: '9601 Wilshire Boulevard\nBeverly Hills, CA 90210',
    phone: '+1 310 555 0456',
    email: 'losangeles@diamondecho.com',
  },
];

const Footer = () => (
  <footer className="mf-footer">
    <div className="mf-footer__top">
      <div className="mf-footer__brand">
        <span className="mf-footer__mark"><Diamond /></span>
        <strong>DIAMOND ECHO</strong>
        <small>PRIVATE REAL ESTATE</small>
        <p>
          Global perspective. Local intelligence. Representation without compromise —
          across residences, rentals, investments, and advisory.
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
        <h4>Portal</h4>
        <nav>
          <Link to="/search">Search the collection</Link>
          <Link to="/investment-calculator">Deal studio</Link>
          <button onClick={() => window.dispatchEvent(new CustomEvent('open-diamond-assistant'))}>
            Ask the concierge
          </button>
          <Link to="/about">The firm</Link>
        </nav>
      </div>
    </div>

    <div className="mf-offices">
      {offices.map((office) => (
        <div key={office.city}>
          <h3>{office.city}</h3>
          <p style={{ whiteSpace: 'pre-line' }}>{office.address}</p>
          <a href={`tel:${office.phone.replace(/\s/g, '')}`}>P : {office.phone}</a>
          <a href={`mailto:${office.email}`}>{office.email}</a>
        </div>
      ))}
    </div>

    <div className="mf-footer__legal">
      <span>© {new Date().getFullYear()} DiamondEcho Private Real Estate — All rights reserved</span>
      <span>Equal Housing Opportunity · Privacy · Terms of use</span>
    </div>
  </footer>
);

export default Footer;
