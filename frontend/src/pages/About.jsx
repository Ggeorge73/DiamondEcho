import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Award, Heart, Shield } from 'lucide-react';

const values = [
  {
    icon: Heart,
    title: 'Client-first',
    copy: 'Every decision and transaction begins with the client’s goals — and ends only when they are met. Priorities are stated, agreed, and protected.',
  },
  {
    icon: Shield,
    title: 'Integrity',
    copy: 'Transparency and candor guide every interaction — the numbers we present are the numbers we would act on ourselves.',
  },
  {
    icon: Award,
    title: 'Excellence',
    copy: 'From market analysis to closing logistics, we hold a single standard: work we would put our own name on, because we do.',
  },
];

const About = () => {
  const navigate = useNavigate();

  return (
    <div className="mf-page">
      <section className="mf-page-hero">
        <div className="mf-page-hero__inner">
          <div>
            <p className="eyebrow">05 — The Firm</p>
            <h1>Operating privately.<br /><em>Leading with intelligence.</em></h1>
            <p className="mf-page-hero__lede">
              DiamondEcho brings Georgia MLS property search, deal analysis,
              and ways to begin a buying or selling conversation into one place.
            </p>
          </div>
        </div>
      </section>

      <div className="mf-story">
        <div>
          <p className="eyebrow">Our philosophy</p>
          <h2>Real estate,<br /><em>intelligently considered.</em></h2>
          <p>
            DiamondEcho is built around a simple idea: property decisions deserve
            clear assumptions and room to consider the risks. Deal Studio presents
            model inputs and results for you to review, not a promise of returns.
          </p>
          <p>
            Explore available properties through Georgia MLS, examine potential
            scenarios, and tell us about your buying or selling goals.
          </p>
          <button className="mf-btn mf-btn--solid" style={{ marginTop: 16 }} onClick={() => navigate('/agents')}>
            Explore advisory
          </button>
        </div>
        <div className="mf-story__media">
          <img src="https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1600&q=84" alt="Illustrative residential architecture" />
        </div>
      </div>

      <div style={{ paddingBottom: 40 }}>
        <div className="mf-values">
          {values.map(({ icon: Icon, title, copy }) => (
            <article key={title}>
              <Icon />
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
};

export default About;
