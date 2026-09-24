import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';

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

const InquiryForm = ({ kind, property }) => {
  const [values, setValues] = useState(emptyValues);
  const [validation, setValidation] = useState({});
  const [error, setError] = useState('');
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
    setError('');
  };

  const validate = () => {
    const next = {};
    if (!values.fullName.trim()) next.fullName = 'Enter your full name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) next.email = 'Enter a valid email address.';
    if ((kind === 'buyer' || kind === 'seller') && !values.message.trim()) next.message = 'Tell us how an advisor can help.';
    if ((kind === 'seller' || (kind === 'tour' && !property)) && !values.propertyAddress.trim()) next.propertyAddress = 'Enter the property address.';
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
      ...(property ? {
        property_id: String(property.id),
        property_address: [property.address, property.city, property.state, property.zip].filter(Boolean).join(', '),
      } : values.propertyAddress.trim() ? { property_address: values.propertyAddress.trim() } : {}),
      ...(kind === 'tour' ? { preferred_tour_time: new Date(values.preferredTime).toISOString() } : {}),
    };
    const signature = JSON.stringify(payload);
    try {
      if (!submissionRef.current || submissionRef.current.signature !== signature) {
        submissionRef.current = { signature, key: createSubmissionKey() };
      }
      sendingRef.current = true;
      setPending(true);
      setError('');
      const response = await axios.post(backendUrl + '/api/v1/inquiries', payload, {
        headers: { 'X-Idempotency-Key': submissionRef.current.key },
      });
      if (![200, 201].includes(response.status) || response.data?.status !== 'routed' || !response.data?.request_id) {
        throw new Error('We could not confirm your request. Please retry.');
      }
      setReceipt(response.data);
    } catch (requestError) {
      const detail = requestError.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : requestError.message || 'We could not confirm your request. Please retry.');
    } finally {
      sendingRef.current = false;
      setPending(false);
    }
  };

  if (receipt) {
    return (
      <section className="de-inquiry-card de-inquiry-receipt" tabIndex={-1} ref={receiptRef} aria-labelledby="inquiry-receipt-title">
        <p className="eyebrow">Request submitted</p>
        <h2 id="inquiry-receipt-title">DiamondEcho received your request.</h2>
        <p>{kind === 'tour' ? 'This is a tour request. The visit is not booked or confirmed.' : 'An advisor can follow up using the contact details you provided.'}</p>
        <p className="de-inquiry-reference">Reference: {receipt.request_id}</p>
        <Link className="mf-btn mf-btn--solid" to={property ? '/property/' + property.id : '/search'}>Continue browsing</Link>
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
      {property && <p className="de-inquiry-property"><strong>{property.title}</strong><span>{property.address}, {property.city}, {property.state} {property.zip}</span></p>}
      <p className="de-inquiry-required">Fields marked * are required.</p>
      {error && <div className="de-inquiry-error" role="alert" tabIndex={-1} ref={errorRef}><strong>Request needs attention</strong><p>{error}</p><p>Your request has not been confirmed. You can retry below.</p></div>}
      <form onSubmit={submit} noValidate>
        {field('fullName', 'Full name *', <input {...attrs('fullName')} value={values.fullName} onChange={change('fullName')} autoComplete="name" required />)}
        {field('email', 'Email address *', <input {...attrs('email')} type="email" value={values.email} onChange={change('email')} autoComplete="email" required />)}
        {field('phone', 'Phone number (optional)', <input {...attrs('phone')} type="tel" value={values.phone} onChange={change('phone')} autoComplete="tel" />)}
        {(kind === 'seller' || (kind === 'tour' && !property)) && field('propertyAddress', 'Property address *', <input {...attrs('propertyAddress')} value={values.propertyAddress} onChange={change('propertyAddress')} autoComplete="street-address" required />)}
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
        <p className="de-inquiry-note">Submitting a request does not book a tour or establish representation.</p>
      </form>
    </section>
  );
};

export default InquiryForm;
