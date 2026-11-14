import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { BROKERAGE, HOURS, OFFICE } from '../lib/contact';
import { isBusinessHours } from '../lib/hours';

const emptyValues = {
  fullName: '', email: '', phone: '', propertyAddress: '', message: '', preferredTime: '', consent: false,
};

const createSubmissionKey = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  }
  throw new Error('This browser cannot safely submit the request. Please try an updated browser.');
};

// How long the form waits for the service before it gives up and says so.
// The service answers a healthy submission in well under a second and gives
// up on its own storage within about 10 seconds; without a limit a stalled
// connection would leave "Sending request…" on screen for ever. A retry
// after the limit reuses the same submission key, so a request that did
// arrive is not stored twice.
export const INQUIRY_REQUEST_TIMEOUT_MS = 20000;

// The words a visitor reads when a request was not confirmed. They are
// written here: text from the service, the platform or the browser library
// is never shown.
export const INQUIRY_NOT_SENT = "We couldn't send your request. Please try again, or call or email us.";
export const INQUIRY_TOO_MANY = 'Too many requests were sent from this connection. Please wait a few minutes and try again, or call or email us.';
export const INQUIRY_CHECK_DETAILS = 'Some of your details need another look. Check the fields marked below, then submit again.';
const failure = (text = INQUIRY_NOT_SENT) => ({ title: 'Your request was not sent', text, contact: true });

// The service's names for the fields, and what to say beside each one it refuses.
const SERVICE_FIELDS = {
  full_name: ['fullName', 'Please check your full name.'],
  email: ['email', 'Enter a valid email address.'],
  phone: ['phone', 'Please check the phone number, or leave it empty.'],
  message: ['message', 'Please check your message.'],
  property_address: ['propertyAddress', 'Please check the property address.'],
  preferred_tour_time: ['preferredTime', 'Choose a future date and time.'],
  consent: ['consent', 'Please agree to be contacted about this request.'],
};
// Field problems from a 422 answer, as { formField: our sentence }. Empty when
// the answer names no field of this form.
const refusedFields = (response, kind) => {
  const detail = response?.status === 422 ? response.data?.detail : null;
  const found = {};
  for (const item of Array.isArray(detail) ? detail : []) {
    const name = (Array.isArray(item?.loc) ? item.loc : []).find((part) => Object.prototype.hasOwnProperty.call(SERVICE_FIELDS, part));
    if (!name) continue;
    const [fieldName, sentence] = SERVICE_FIELDS[name];
    const shown = (fieldName !== 'propertyAddress' || kind !== 'buyer') && (fieldName !== 'preferredTime' || kind === 'tour');
    if (shown) found[fieldName] = sentence;
  }
  return found;
};

// The service stores a request and answers 201 with its receipt, or 200 with
// the same receipt when the same submission key is sent again
// (backend/inquiries/router.py, models.InquiryReceipt). Anything else is not
// a stored request, whatever its status.
const storedReceipt = (response) => {
  const data = response?.data;
  return [200, 201].includes(response?.status) && data && typeof data === 'object'
    && data.status === 'queued' && typeof data.request_id === 'string' && data.request_id.trim() !== ''
    ? data : null;
};

// `initialMessage` starts the message box with a sentence the visitor can
// change, for a link that already says what the request is about.
const InquiryForm = ({ kind, initialMessage = '' }) => {
  const [values, setValues] = useState(() => ({ ...emptyValues, message: initialMessage }));
  const [validation, setValidation] = useState({});
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const sendingRef = useRef(false);
  const submissionRef = useRef(null);
  const fieldsRef = useRef({});
  const errorRef = useRef(null);
  const receiptRef = useRef(null);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'your local time zone';
  const backendUrl = (process.env.REACT_APP_BACKEND_URL || '').replace(/\/$/, '');

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (receipt) receiptRef.current?.focus(); }, [receipt]);

  const change = (name) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setValues((current) => ({ ...current, [name]: value }));
    setValidation((current) => ({ ...current, [name]: '' }));
    setError(null);
  };

  const validate = () => {
    const next = {};
    if (!values.fullName.trim()) next.fullName = 'Enter your full name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) next.email = 'Enter a valid email address.';
    if ((kind === 'buyer' || kind === 'seller') && !values.message.trim()) next.message = 'Tell us how an advisor can help.';
    if ((kind === 'seller' || kind === 'tour') && !values.propertyAddress.trim()) next.propertyAddress = 'Enter the property address.';
    if (kind === 'tour') {
      if (!values.preferredTime) next.preferredTime = 'Choose your preferred date and time.';
      else if (!Number.isFinite(new Date(values.preferredTime).getTime())) next.preferredTime = 'Choose a valid date and time.';
      else if (new Date(values.preferredTime).getTime() <= Date.now()) next.preferredTime = 'Choose a future date and time.';
    }
    if (!values.consent) next.consent = 'Please agree to be contacted about this request.';
    return next;
  };

  const submit = async (event) => {
    event.preventDefault();
    if (sendingRef.current || receipt) return;
    const nextValidation = validate();
    setValidation(nextValidation);
    if (Object.keys(nextValidation).length) {
      fieldsRef.current[Object.keys(nextValidation)[0]]?.focus();
      return;
    }

    const payload = {
      kind,
      full_name: values.fullName.trim(),
      email: values.email.trim(),
      consent: true,
      ...(values.phone.trim() ? { phone: values.phone.trim() } : {}),
      ...(values.message.trim() ? { message: values.message.trim() } : {}),
      ...(values.propertyAddress.trim() ? { property_address: values.propertyAddress.trim() } : {}),
      ...(kind === 'tour' ? { preferred_tour_time: new Date(values.preferredTime).toISOString() } : {}),
    };
    const signature = JSON.stringify(payload);
    try {
      // One key for one request: a retry of the same details sends the same
      // key, so the service answers with the stored receipt instead of
      // storing it again. Changed details are a different request and get a
      // new key (the service refuses a key reused for different details).
      if (!submissionRef.current || submissionRef.current.signature !== signature) {
        submissionRef.current = { signature, key: createSubmissionKey() };
      }
    } catch (keyError) {
      // Our own sentence from createSubmissionKey: this browser cannot make a key.
      setError(failure(keyError.message));
      return;
    }
    sendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const response = await axios.post(backendUrl + '/api/v1/inquiries', payload, {
        headers: { 'X-Idempotency-Key': submissionRef.current.key },
        timeout: INQUIRY_REQUEST_TIMEOUT_MS,
      });
      const stored = storedReceipt(response);
      if (!stored) {
        setError(failure());
        return;
      }
      submissionRef.current = null;
      setReceipt(stored);
    } catch (requestError) {
      const response = requestError?.response;
      const fields = refusedFields(response, kind);
      if (Object.keys(fields).length) {
        setValidation(fields);
        setError({ title: 'Please check your details', text: INQUIRY_CHECK_DETAILS, contact: false });
      } else {
        // The service says this key belongs to other details: start a new one.
        if (response?.status === 409) submissionRef.current = null;
        setError(failure(response?.status === 429 ? INQUIRY_TOO_MANY : INQUIRY_NOT_SENT));
      }
    } finally {
      sendingRef.current = false;
      setPending(false);
    }
  };

  if (receipt) {
    // The service's own record of when the request arrived, not the visitor's clock.
    const open = isBusinessHours(receipt.submitted_at);
    return (
      <section className="de-inquiry-card de-inquiry-receipt" tabIndex={-1} ref={receiptRef} aria-labelledby="inquiry-receipt-title">
        <p className="eyebrow">Request submitted</p>
        <h2 id="inquiry-receipt-title">DiamondEcho received your request.</h2>
        <p>Your request is in the DiamondEcho staff queue. {kind === 'tour' ? 'This is a tour request. The visit is not booked or confirmed.' : 'A team member can review it and follow up using the contact details you provided.'}</p>
        <p className="de-inquiry-hours">{open
          ? 'We reply during business hours: ' + HOURS.label + '.'
          : 'Your request arrived outside our business hours. We reply ' + HOURS.label + ', and will be in touch once we reopen.'}</p>
        <p className="de-inquiry-reference">Reference: {receipt.request_id}</p>
        <Link className="mf-btn mf-btn--solid" to="/search">Continue browsing</Link>
      </section>
    );
  }

  const field = (name, label, input) => (
    <div className="de-inquiry-field" key={name}>
      <label htmlFor={'inquiry-' + name}>{label}</label>
      {input}
      {validation[name] && <p className="de-inquiry-field-error" id={'inquiry-' + name + '-error'}>{validation[name]}</p>}
    </div>
  );
  const attrs = (name) => ({
    id: 'inquiry-' + name,
    ref: (node) => { fieldsRef.current[name] = node; },
    'aria-invalid': Boolean(validation[name]),
    'aria-describedby': validation[name] ? 'inquiry-' + name + '-error' : undefined,
  });

  return (
    <section className="de-inquiry-card" aria-labelledby="inquiry-form-title">
      <h2 id="inquiry-form-title">Your request</h2>
      <p className="de-inquiry-required">Fields marked * are required.</p>
      {error && (
        <div className="de-inquiry-error" role="alert" tabIndex={-1} ref={errorRef}>
          <strong>{error.title}</strong>
          <p>{error.text}</p>
          {error.contact && <>
            <p>Your request has not been confirmed. Everything you typed is still in the form, so you can submit it again.</p>
            <p className="de-inquiry-error__contact">
              {BROKERAGE.name}: <a href={BROKERAGE.phoneHref}>Office {BROKERAGE.phone}</a><br />
              DiamondEcho: <a href={OFFICE.phoneHref}>Direct {OFFICE.phone}</a> or <a href={OFFICE.emailHref}>{OFFICE.email}</a>
            </p>
          </>}
        </div>
      )}
      <form onSubmit={submit} noValidate>
        {field('fullName', 'Full name *', <input {...attrs('fullName')} value={values.fullName} onChange={change('fullName')} autoComplete="name" required />)}
        {field('email', 'Email address *', <input {...attrs('email')} type="email" value={values.email} onChange={change('email')} autoComplete="email" required />)}
        {field('phone', 'Phone number (optional)', <input {...attrs('phone')} type="tel" value={values.phone} onChange={change('phone')} autoComplete="tel" />)}
        {(kind === 'seller' || kind === 'tour') && field('propertyAddress', 'Property address *', <input {...attrs('propertyAddress')} value={values.propertyAddress} onChange={change('propertyAddress')} autoComplete="street-address" required />)}
        {kind === 'tour' && field('preferredTime', 'Preferred tour date and time *', <>
          <input {...attrs('preferredTime')} type="datetime-local" value={values.preferredTime} onChange={change('preferredTime')} required />
          <small>Entered in {timeZone}. Your preferred time is a request, not a booking.</small>
        </>)}
        {field('message', kind === 'buyer' ? 'What are you looking for? *' : kind === 'seller' ? 'What would you like to discuss? *' : 'Anything we should know? (optional)',
          <textarea {...attrs('message')} value={values.message} onChange={change('message')} rows={5} maxLength={2000} required={kind !== 'tour'} />)}
        <div className="de-inquiry-consent">
          <input {...attrs('consent')} type="checkbox" checked={values.consent} onChange={change('consent')} required />
          <label htmlFor="inquiry-consent">I agree that DiamondEcho may contact me by email or phone about this request. *</label>
        </div>
        {validation.consent && <p className="de-inquiry-field-error" id="inquiry-consent-error">{validation.consent}</p>}
        <button className="mf-btn mf-btn--solid de-inquiry-submit" type="submit" disabled={pending}>{pending ? 'Sending request…' : 'Submit request'}</button>
        <p className="de-inquiry-note">Requests can be sent at any hour. We reply during business hours: {HOURS.label}.</p>
        <p className="de-inquiry-note">Submitting a request does not book a tour or establish representation.</p>
      </form>
    </section>
  );
};

export default InquiryForm;
