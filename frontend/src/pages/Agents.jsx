import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Mail, MessageCircle, Phone } from 'lucide-react';
import { agents } from '../data/mockData';

const Agents = () => {
  const navigate = useNavigate();

  return (
    <div className="mf-page">
      <section className="mf-page-hero">
        <div className="mf-page-hero__inner">
          <div>
            <p className="eyebrow">04 — Advisory</p>
            <h1>Private <em>advisors.</em></h1>
            <p className="mf-page-hero__lede">
              Senior advisors coordinating financing, diligence, negotiation, and closing —
              one relationship across your entire real estate life. Begin with self-service;
              escalate to full representation the moment it matters.
            </p>
          </div>
          <div className="mf-page-hero__meta">
            <strong>{agents.reduce((sum, agent) => sum + agent.listings, 0)}</strong>
            <span>Active mandates</span>
          </div>
        </div>
      </section>

      <div className="mf-advisors">
        {agents.map((agent) => (
          <article key={agent.id} className="mf-advisor">
            <div className="mf-advisor__media">
              <img src={agent.photo} alt={agent.name} loading="lazy" />
              <span>{agent.listings} active listings</span>
            </div>
            <div className="mf-advisor__body">
              <h3>{agent.name}</h3>
              <small>{agent.title}</small>
              <p>{agent.bio}.</p>
              <div className="mf-advisor__contacts">
                <a href={`tel:${agent.phone.replace(/[^\d+]/g, '')}`}><Phone /> {agent.phone}</a>
                <a href={`mailto:${agent.email}`}><Mail /> {agent.email}</a>
              </div>
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
            <button className="mf-btn" onClick={() => navigate('/search')}>
              <Building2 size={15} /> Browse the collection
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Agents;
