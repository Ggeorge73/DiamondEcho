import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import InquiryForm from '../components/InquiryForm';
import './Inquire.css';

const copy = {
  buyer: { eyebrow: 'Buyer inquiry', title: 'Tell us what you are looking for.', intro: 'Share your goals and an advisor can follow up about available residences and next steps.' },
  seller: { eyebrow: 'Seller consultation', title: 'Start a selling conversation.', intro: 'Tell us about your property and goals. An advisor can review your request and follow up.' },
  tour: { eyebrow: 'Tour request', title: 'Request a property tour.', intro: 'Enter the property address and suggest a date and time. Georgia MLS selections are not transferred here, and your request does not reserve or confirm a tour.' },
};

// What the page says while no inquiry service is connected to this build.
const closedCopy = {
  buyer: { title: 'Buyer inquiries are not open yet.', what: 'buyer inquiries' },
  seller: { title: 'Seller consultations are not open yet.', what: 'seller consultation requests' },
  tour: { title: 'Tour requests are not open yet.', what: 'tour requests' },
};

// Requests are delivered by the DiamondEcho service. A build with no service
// address has nowhere to send one, so it must not offer a form.
export const inquiryServiceConfigured = () => Boolean((process.env.REACT_APP_BACKEND_URL || '').trim());

const InquiryClosed = ({ kind }) => (
  <section className="de-inquiry-card de-inquiry-closed" aria-labelledby="inquiry-closed-title">
    <p className="eyebrow">Online requests</p>
    <h2 id="inquiry-closed-title">Online requests are not open yet.</h2>
    <p>
      DiamondEcho is not yet taking {closedCopy[kind].what} through this website, so
      nothing can be sent from this page. No details are collected here.
    </p>
    <h3>Georgia office</h3>
    <p>8735 Dunwoody Place<br />GA 30350, USA</p>
    <div className="de-inquiry-closed__actions">
      <Link className="mf-btn mf-btn--solid" to="/search">Search Georgia MLS</Link>
      <Link className="mf-btn" to="/investment-calculator">Open Deal Studio</Link>
    </div>
  </section>
);

const Inquire = () => {
  const [params] = useSearchParams();
  const requestedKind = params.get('type');
  const kind = Object.prototype.hasOwnProperty.call(copy, requestedKind) ? requestedKind : 'buyer';
  const open = inquiryServiceConfigured();
  const content = open ? copy[kind] : { ...copy[kind], title: closedCopy[kind].title, intro: `This page will take ${closedCopy[kind].what} once online requests open.` };

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
            <Link to="/inquire?type=tour" aria-current={kind === 'tour' ? 'page' : undefined}>Tour request</Link>
          </div>
        </div>
        {open ? <InquiryForm key={kind} kind={kind} /> : <InquiryClosed kind={kind} />}
      </div>
    </main>
  );
};

export default Inquire;
