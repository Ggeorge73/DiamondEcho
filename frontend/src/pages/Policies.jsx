import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { OFFICE } from '../lib/contact';
import { inquiryServiceConfigured } from './Inquire';
import './Policies.css';

// Plain-language drafts for Gbenga's review (DE-18). They describe what this
// site does today and claim no legal certification. Keep them in step with
// frontend/public/index.html: a script added there must be described here.
export const POLICIES_UPDATED = 'October 3, 2026';

const usePageTitle = (title) => {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => { document.title = previous; };
  }, [title]);
};

const ContactBlock = () => (
  <address className="de-policy__contact">
    DiamondEcho<br />
    {OFFICE.addressLines[0]}<br />
    {OFFICE.addressLines[1]}<br />
    <a href={OFFICE.phoneHref}>{OFFICE.phone}</a><br />
    <a href={OFFICE.emailHref}>{OFFICE.email}</a>
  </address>
);

const PolicyPage = ({ eyebrow, title, lede, children }) => (
  <main className="mf-page de-policy">
    <section className="mf-page-hero" aria-labelledby="policy-title">
      <div className="mf-page-hero__inner"><div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 id="policy-title">{title}</h1>
        <p className="mf-page-hero__lede">{lede}</p>
        <p className="de-policy__updated">Last updated {POLICIES_UPDATED}</p>
      </div></div>
    </section>
    <div className="de-policy__body">{children}</div>
  </main>
);

export const Privacy = () => {
  usePageTitle('Privacy | DiamondEcho');
  const requestsOpen = inquiryServiceConfigured();

  return (
    <PolicyPage
      eyebrow="Privacy"
      title="What this site does with your information."
      lede="A plain account of what DiamondEcho's website collects, what it does not, and which other companies are involved when you use it."
    >
      <section>
        <h2>The short version</h2>
        <ul>
          <li>DiamondEcho's own pages do not use advertising trackers, analytics or session recording, and they do not set cookies.</li>
          <li>You do not need an account to use this site.</li>
          <li>The property search is provided by Georgia MLS inside a frame. What you do in that frame is handled by Georgia MLS.</li>
          <li>We do not sell personal information.</li>
        </ul>
      </section>

      <section>
        <h2>Requests you send us</h2>
        {requestsOpen ? (
          <>
            <p>
              When you send a buyer inquiry, a seller consultation request or a tour request,
              we receive what you enter: your name, email address, phone number if you give
              one, the property address or preferred time if you add them, and your message.
            </p>
            <p>
              We use these details to reply to you about that request, and for no other
              purpose. Please do not put financial account numbers, government ID numbers
              or other sensitive information in a request. To ask what we hold about you,
              or to have it deleted, email <a href={OFFICE.emailHref}>{OFFICE.email}</a>.
            </p>
          </>
        ) : (
          <p>
            Online request forms are not open yet, so this site does not currently collect
            your name, email address or phone number. Before the forms open, this page will
            say what they collect, why, and how to have it deleted.
          </p>
        )}
        <p>
          If you call or email us, we use what you tell us to respond to you.
        </p>
      </section>

      <section>
        <h2>Property search (Georgia MLS)</h2>
        <p>
          The search on the home page and the Search page is supplied by Georgia MLS and
          shown in a frame loaded from georgiamls.com. Searches you run, listings you open
          and any contact form you fill in inside that frame go to Georgia MLS, not to
          DiamondEcho's pages. Georgia MLS may set its own cookies. Its own privacy
          terms apply to that frame.
        </p>
      </section>

      <section>
        <h2>Deal Studio</h2>
        <p>
          The figures you enter in Deal Studio are used only to calculate the results you
          see. The calculation runs in your browser or on DiamondEcho's analysis service.
          The figures are not saved to an account or a database.
        </p>
        <p>
          Where the address lookup is available, the address you type is sent to mapping
          and property-record providers (Mapbox and RentCast) to suggest addresses and
          fill in public record details. Routine server logs may record that a lookup was
          made, including the address.
        </p>
      </section>

      <section>
        <h2>Ask DiamondEcho assistant</h2>
        <p>
          Questions you type into the assistant, and the state you choose, are sent to
          DiamondEcho's service to produce an answer. They are not used to build a
          profile of you. Please do not type personal or financial details into it.
        </p>
      </section>

      <section>
        <h2>Companies that help deliver this site</h2>
        <ul>
          <li><strong>Cloudflare</strong> hosts the site. Like any web host, it receives your IP address and basic browser details in order to send you the pages.</li>
          <li><strong>Google Fonts</strong> supplies the typefaces, and <strong>Unsplash</strong> supplies some illustrative photographs. Your browser fetches these directly, so those companies receive your IP address.</li>
          <li><strong>Georgia MLS</strong> supplies the property search, as described above.</li>
        </ul>
      </section>

      <section>
        <h2>Changes to this page</h2>
        <p>
          If what this site collects changes, this page will be updated first and the
          date at the top will change.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>Questions about privacy can be sent to:</p>
        <ContactBlock />
        <p><Link to="/terms">Read the terms of use</Link></p>
      </section>
    </PolicyPage>
  );
};

export const Terms = () => {
  usePageTitle('Terms of use | DiamondEcho');

  return (
    <PolicyPage
      eyebrow="Terms of use"
      title="How to read and use this site."
      lede="What the information on DiamondEcho's website is, and what it is not."
    >
      <section>
        <h2>What this site is</h2>
        <p>
          This site offers a Georgia MLS property search, a deal analysis tool and ways
          to contact DiamondEcho. It is provided for general information. Nothing on it
          is an offer to buy, sell or lease property.
        </p>
        <p>
          Using this site, or contacting us through it, does not by itself create a
          client or brokerage relationship. That happens only by a separate written
          agreement.
        </p>
      </section>

      <section>
        <h2>Listings</h2>
        <p>
          Listing information comes from Georgia MLS and is shown as Georgia MLS supplies
          it. It is believed to be reliable but is not guaranteed. Prices, availability
          and details can change or contain errors, so confirm anything important before
          you rely on it.
        </p>
      </section>

      <section>
        <h2>Deal Studio</h2>
        <p>
          Deal Studio produces estimates from the figures you enter and the assumptions
          shown on the page. Results are illustrations, not predictions or promises of
          any return. They are not financial, investment, tax or legal advice. Speak to
          a qualified professional before making a decision.
        </p>
      </section>

      <section>
        <h2>Assistant</h2>
        <p>
          The Ask DiamondEcho assistant gives general real estate information. It can be
          wrong or out of date, and it is not legal, tax, lending or investment advice.
        </p>
      </section>

      <section>
        <h2>Requests and tours</h2>
        <p>
          A request sent through this site asks us to get in touch. A tour request is a
          request, not a booking: it does not reserve a property or a time until we
          confirm it with you.
        </p>
      </section>

      <section>
        <h2>Equal housing opportunity</h2>
        <p>
          DiamondEcho supports equal housing opportunity.
        </p>
      </section>

      <section>
        <h2>Other companies' content</h2>
        <p>
          The property search and some images come from other companies. DiamondEcho does
          not control their content or their sites.
        </p>
      </section>

      <section>
        <h2>Changes and contact</h2>
        <p>
          These terms may be updated; the date at the top shows the latest version.
          Questions can be sent to:
        </p>
        <ContactBlock />
        <p><Link to="/privacy">Read the privacy page</Link></p>
      </section>
    </PolicyPage>
  );
};
