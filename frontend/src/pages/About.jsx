import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Award, Heart, Shield, Target, TrendingUp, Users } from 'lucide-react';

const stats = [
  { label: 'Residences sold', value: '2,500+', icon: TrendingUp },
  { label: 'Clients represented', value: '1,800+', icon: Users },
  { label: 'Years of practice', value: '15+', icon: Award },
  { label: 'Investment mandates', value: '450+', icon: Target },
];

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
              DiamondEcho is a private real estate house managing exceptional residences and
              investment assets across America’s signature markets — one standard, every asset class.
            </p>
          </div>
        </div>
      </section>

      <div className="mf-values" style={{ gridTemplateColumns: 'repeat(4, 1fr)', borderLeft: '1px solid var(--line)' }}>
        {stats.map(({ label, value, icon: Icon }) => (
          <article key={label}>
            <Icon />
            <h3 style={{ fontFamily: 'Sora, sans-serif', fontWeight: 200, fontSize: 40 }}>{value}</h3>
            <p style={{ letterSpacing: '.18em', textTransform: 'uppercase', fontSize: 10, fontWeight: 600 }}>{label}</p>
          </article>
        ))}
      </div>

      <div className="mf-story">
        <div>
          <p className="eyebrow">Our philosophy</p>
          <h2>Real estate,<br /><em>intelligently considered.</em></h2>
          <p>
            Founded on the belief that property decisions deserve institutional rigor and private-bank
            discretion, DiamondEcho pairs senior human advisors with a proprietary intelligence layer.
            Clients see every assumption behind every number — and decide with clarity.
          </p>
          <p>
            From a first home to a national portfolio, the firm coordinates search, underwriting,
            financing, diligence, negotiation, and closing as a single, accountable relationship.
          </p>
          <button className="mf-btn mf-btn--solid" style={{ marginTop: 16 }} onClick={() => navigate('/agents')}>
            Meet the advisors
          </button>
        </div>
        <div className="mf-story__media">
          <img src="https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1600&q=84" alt="Signature DiamondEcho residence" />
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
