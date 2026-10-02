import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, MessageCircle } from 'lucide-react';

const paths = [
  {
    title: 'Explore properties',
    detail: 'Browse the Georgia MLS search and choose the location and property criteria that matter to you.',
    action: 'Search properties',
    to: '/search',
  },
  {
    title: 'Consider a deal',
    detail: 'Use Deal Studio to model assumptions and compare possible outcomes before making a decision.',
    action: 'Open Deal Studio',
    to: '/investment-calculator',
  },
  {
    title: 'Start a conversation',
    detail: 'Describe your buying or selling goals in an inquiry. A submitted request is not an appointment or representation agreement.',
    action: 'Make an inquiry',
    to: '/inquire?type=buyer',
  },
];

const Agents = () => {
  const navigate = useNavigate();

  return (
    <div className="mf-page">
      <section className="mf-page-hero">
        <div className="mf-page-hero__inner">
          <div>
            <p className="eyebrow">04 — Advisory</p>
            <h1>Real estate,<br /><em>thoughtfully explored.</em></h1>
            <p className="mf-page-hero__lede">
              Search Georgia MLS, work through the numbers, and tell DiamondEcho
              what you need. Individual advisor profiles will appear only after
              their identities and contact details are verified.
            </p>
          </div>
        </div>
      </section>

      <div className="mf-advisors">
        {paths.map((path) => (
          <article key={path.title} className="mf-advisor">
            <div className="mf-advisor__body">
              <h3>{path.title}</h3>
              <p>{path.detail}</p>
              <button className="mf-btn" onClick={() => navigate(path.to)}>{path.action}</button>
            </div>
          </article>
        ))}
      </div>

      <section className="mf-contact" style={{ minHeight: 480 }}>
        <div className="mf-contact__image" />
        <div className="mf-contact__veil" />
        <div className="mf-contact__content">
          <p className="eyebrow">Not sure where to begin?</p>
          <h2>Start a conversation,<br /><em>on your terms.</em></h2>
          <div className="mf-contact__actions">
            <button className="mf-btn mf-btn--solid" onClick={() => window.dispatchEvent(new CustomEvent('open-diamond-assistant'))}>
              <MessageCircle size={15} /> Ask the concierge
            </button>
            <button className="mf-btn" onClick={() => navigate('/inquire?type=buyer')}>
              <Building2 size={15} /> Ask about buying
            </button>
            <button className="mf-btn" onClick={() => navigate('/inquire?type=seller')}>
              <Building2 size={15} /> Discuss selling
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Agents;
