import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { properties } from '../data/mockData';
import InquiryForm from '../components/InquiryForm';
import './Inquire.css';

const copy = {
  buyer: { eyebrow: 'Buyer inquiry', title: 'Tell us what you are looking for.', intro: 'Share your goals and an advisor can follow up about available residences and next steps.' },
  seller: { eyebrow: 'Seller consultation', title: 'Start a selling conversation.', intro: 'Tell us about your property and goals. An advisor can review your request and follow up.' },
  tour: { eyebrow: 'Tour request', title: 'Request a property tour.', intro: 'Suggest a date and time. Your request does not reserve or confirm a tour.' },
};

const Inquire = () => {
  const [params] = useSearchParams();
  const requestedKind = params.get('type');
  const kind = Object.prototype.hasOwnProperty.call(copy, requestedKind) ? requestedKind : 'buyer';
  const property = properties.find((item) => String(item.id) === params.get('listing'));
  const content = copy[kind];

  return (
    <main className="de-inquiry-page">
      <div className="de-inquiry-wrap">
        <div className="de-inquiry-intro">
          <p className="eyebrow">{content.eyebrow}</p>
          <h1>{content.title}</h1>
          <p>{content.intro}</p>
          <div className="de-inquiry-switch" aria-label="Inquiry type">
            <Link to="/inquire?type=buyer" aria-current={kind === 'buyer' ? 'page' : undefined}>Buying</Link>
            <Link to="/inquire?type=seller" aria-current={kind === 'seller' ? 'page' : undefined}>Selling</Link>
          </div>
        </div>
        <InquiryForm key={kind + '-' + (property?.id || '')} kind={kind} property={property} />
      </div>
    </main>
  );
};

export default Inquire;
