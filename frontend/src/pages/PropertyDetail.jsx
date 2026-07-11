import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Bath, Bed, Calculator as CalcIcon, Calendar, Heart,
  MapPin, Mail, Phone, Share2, Square,
} from 'lucide-react';
import { properties, agents } from '../data/mockData';

const formatPrice = (price) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
}).format(price);

const tabs = ['Overview', 'Features', 'Neighborhood', 'History'];

const PropertyDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [selectedImage, setSelectedImage] = useState(0);
  const [activeTab, setActiveTab] = useState('Overview');
  const property = properties.find((p) => p.id === parseInt(id, 10));
  const agent = agents[0];

  if (!property) {
    return (
      <div className="mf-page">
        <div className="mf-empty" style={{ paddingTop: 220 }}>
          <h3>Residence not found</h3>
          <p>This listing may have been withdrawn or privately placed.</p>
          <button className="mf-btn mf-btn--solid" onClick={() => navigate('/search')}>Back to the collection</button>
        </div>
      </div>
    );
  }

  const monthly = (property.price * 0.8 * (0.075 / 12)) / (1 - Math.pow(1 + 0.075 / 12, -360));

  return (
    <div className="mf-page">
      <div className="mf-detail">
        <button className="mf-back" onClick={() => navigate('/search')}>
          <ArrowLeft /> Back to the collection
        </button>

        <div className="mf-detail__layout">
          <div>
            {/* Gallery */}
            <div className="mf-gallery__main">
              <img src={`${property.images[selectedImage]}?auto=format&fit=crop&w=1800&q=86`} alt={property.title} />
              <span className="mf-gallery__status">{property.status}</span>
            </div>
            <div className="mf-gallery__thumbs">
              {property.images.map((image, index) => (
                <button
                  key={image}
                  className={selectedImage === index ? 'is-active' : ''}
                  onClick={() => setSelectedImage(index)}
                  aria-label={`View image ${index + 1}`}
                >
                  <img src={`${image}?auto=format&fit=crop&w=600&q=70`} alt={`View ${index + 1}`} loading="lazy" />
                </button>
              ))}
            </div>

            {/* Header */}
            <div className="mf-detail__header">
              <div>
                <p className="eyebrow eyebrow--bare">{property.propertyType} — {property.city}, {property.state}</p>
                <h1>{formatPrice(property.price)}</h1>
                <p><MapPin /> {property.address}, {property.city}, {property.state} {property.zip}</p>
              </div>
            </div>

            {/* Specs */}
            <div className="mf-specs">
              <div><Bed /><strong>{property.beds}</strong><span>Bedrooms</span></div>
              <div><Bath /><strong>{property.baths}</strong><span>Bathrooms</span></div>
              <div><Square /><strong>{property.sqft.toLocaleString()}</strong><span>Sq ft</span></div>
              <div><Calendar /><strong>{property.yearBuilt}</strong><span>Year built</span></div>
            </div>

            {/* Tabs */}
            <div className="mf-tabs">
              <div className="mf-tabs__list" role="tablist">
                {tabs.map((tab) => (
                  <button
                    key={tab}
                    role="tab"
                    aria-selected={activeTab === tab}
                    className={activeTab === tab ? 'is-active' : ''}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              <div className="mf-tabs__panel">
                {activeTab === 'Overview' && (
                  <>
                    <h3>Description</h3>
                    <p>{property.description}</p>
                    <h3>Property details</h3>
                    <div className="mf-kv">
                      <div><span>Property type</span><strong>{property.propertyType}</strong></div>
                      <div><span>Year built</span><strong>{property.yearBuilt}</strong></div>
                      {property.lotSize && (
                        <div><span>Lot size</span><strong>{property.lotSize.toLocaleString()} sqft</strong></div>
                      )}
                      <div><span>Price / sqft</span><strong>${Math.round(property.price / property.sqft)}</strong></div>
                    </div>
                  </>
                )}

                {activeTab === 'Features' && (
                  <>
                    <h3>Property features</h3>
                    <ul className="mf-features">
                      {property.features.map((feature) => <li key={feature}>{feature}</li>)}
                    </ul>
                  </>
                )}

                {activeTab === 'Neighborhood' && (
                  <>
                    <h3>Neighborhood intelligence</h3>
                    <div className="mf-kv">
                      <div><span>School rating</span><strong>{property.schoolRating}/10</strong></div>
                      <div><span>Walk score</span><strong>{property.walkScore}/100</strong></div>
                    </div>
                  </>
                )}

                {activeTab === 'History' && (
                  <>
                    <h3>Price history</h3>
                    <div className="mf-kv">
                      {property.priceHistory.map((entry) => (
                        <div key={entry.date}><span>{entry.date} — {entry.event}</span><strong>{formatPrice(entry.price)}</strong></div>
                      ))}
                    </div>
                    <h3 style={{ marginTop: 30 }}>Tax history</h3>
                    <div className="mf-kv">
                      {property.taxHistory.map((entry) => (
                        <div key={entry.year}><span>{entry.year}</span><strong>{formatPrice(entry.amount)}</strong></div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div>
            <div className="mf-agent-panel">
              <div className="mf-agent-panel__head">
                <img src={agent.photo} alt={agent.name} />
                <div>
                  <strong>{agent.name}</strong>
                  <small>{agent.title}</small>
                </div>
              </div>
              <div className="mf-agent-panel__actions">
                <a className="mf-btn mf-btn--solid" href={`tel:${agent.phone.replace(/[^\d+]/g, '')}`} style={{ justifyContent: 'center' }}>
                  <Phone size={15} /> Call advisor
                </a>
                <a className="mf-btn" href={`mailto:${agent.email}`} style={{ justifyContent: 'center' }}>
                  <Mail size={15} /> Send email
                </a>
                <button className="mf-btn" style={{ justifyContent: 'center' }}>
                  <Calendar size={15} /> Schedule tour
                </button>
              </div>
              <div className="mf-agent-panel__links">
                <button onClick={() => navigate('/investment-calculator')}>
                  <CalcIcon /> Analyze as investment
                </button>
                <button><Heart /> Save residence</button>
                <button><Share2 /> Share</button>
              </div>
            </div>

            <div className="mf-mortgage">
              <h3><CalcIcon /> Mortgage estimate</h3>
              <div className="mf-mortgage__body">
                <label>
                  <span>Purchase price</span>
                  <input type="text" value={formatPrice(property.price)} readOnly />
                </label>
                <label>
                  <span>Down payment (20%)</span>
                  <input type="text" value={formatPrice(property.price * 0.2)} readOnly />
                </label>
                <label>
                  <span>Interest rate</span>
                  <input type="text" value="7.5%" readOnly />
                </label>
              </div>
              <div className="mf-mortgage__total">
                <div>
                  <span>Est. monthly payment</span>
                  <strong>{formatPrice(monthly)}</strong>
                </div>
                <small>Principal &amp; interest only. Model the full deal in the Deal Studio.</small>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PropertyDetail;
