/* Standalone staff surface. No frameworks, analytics, recorder, or client-side storage. */
(() => {
  'use strict';

  const config = window.DIAMOND_ECHO_STAFF_CONFIG;
  const $ = (id) => document.getElementById(id);
  const alert = $('alert');
  const notice = $('notice');
  const signin = $('signin-section');
  const queue = $('queue-section');
  const credentialInput = $('credential');
  const signinButton = $('signin-button');
  const refreshButton = $('refresh-button');
  const list = $('inquiries');
  let accessKey = '';
  let accessEpoch = 0;
  let busy = false;

  const apiBase = (() => {
    if (!config || config.enabled !== true || typeof config.apiBase !== 'string') return null;
    try {
      const url = new URL(config.apiBase);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.hostname.endsWith('.invalid')) return null;
      return url.origin;
    } catch { return null; }
  })();

  function showError(message) {
    notice.hidden = true;
    alert.textContent = message;
    alert.hidden = false;
    alert.focus();
  }

  function clearMessages() {
    alert.textContent = '';
    alert.hidden = true;
    notice.textContent = '';
    notice.hidden = true;
  }

  function clearAccess() {
    accessEpoch += 1;
    accessKey = '';
    credentialInput.value = '';
    list.replaceChildren();
    $('count').textContent = '';
    queue.hidden = true;
    signin.hidden = false;
    busy = false;
    signinButton.disabled = false;
    refreshButton.disabled = false;
  }

  function errorMessage(response) {
    if (response?.status === 401 || response?.status === 403) return 'Access denied. Use your approved DiamondEcho staff account credential.';
    if (response?.status === 503) return 'The staff queue is not configured or temporarily unavailable. Contact the operations owner.';
    return 'The staff queue could not be reached. Try again later.';
  }

  function dateLabel(value) {
    if (!value) return 'Not provided';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Not provided' : date.toLocaleString();
  }

  function field(dl, label, value) {
    if (value === undefined || value === null || value === '') return;
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = String(value);
    row.append(dt, dd);
    dl.append(row);
  }

  async function acknowledge(requestId, button) {
    if (!accessKey || busy) return;
    const epoch = accessEpoch;
    busy = true;
    clearMessages();
    refreshButton.disabled = true;
    try {
      const response = await fetch(`${apiBase}/api/v1/inquiries/staff/${encodeURIComponent(requestId)}/acknowledge`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessKey}`, Accept: 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      if (epoch !== accessEpoch) return;
      if (response.status === 401 || response.status === 403) {
        clearAccess();
        showError(errorMessage(response));
        return;
      }
      if (!response.ok) throw new Error(errorMessage(response));
      const receipt = await response.json();
      if (epoch !== accessEpoch) return;
      if (receipt.request_id !== requestId || receipt.status !== 'acknowledged') throw new Error('The acknowledgement could not be verified. Refresh before trying again.');
      notice.textContent = `Request ${requestId} acknowledged.`;
      notice.hidden = false;
      button.textContent = 'Acknowledged';
      button.disabled = true;
      button.closest('.inquiry').querySelector('.inquiry-head span').textContent = 'acknowledged';
    } catch (error) {
      if (epoch === accessEpoch) showError(error.message || 'The request could not be acknowledged. Refresh before trying again.');
    } finally {
      if (epoch === accessEpoch) { busy = false; refreshButton.disabled = false; }
    }
  }

  function render(items) {
    list.replaceChildren();
    $('count').textContent = `${items.length} ${items.length === 1 ? 'request' : 'requests'}`;
    for (const item of items) {
      if (!item || typeof item.request_id !== 'string') continue;
      const card = document.createElement('li');
      card.className = 'inquiry';
      const head = document.createElement('div');
      head.className = 'inquiry-head';
      const title = document.createElement('h2');
      title.textContent = `${item.kind || 'Visitor'} inquiry`;
      const status = document.createElement('span');
      status.textContent = item.status || 'queued';
      head.append(title, status);
      const dl = document.createElement('dl');
      field(dl, 'Reference', item.request_id);
      field(dl, 'Submitted', dateLabel(item.submitted_at));
      field(dl, 'Name', item.full_name);
      field(dl, 'Email', item.email);
      field(dl, 'Phone', item.phone);
      field(dl, 'Property', item.property_address);
      field(dl, 'Listing ID', item.property_id);
      if (item.preferred_tour_time) field(dl, 'Requested tour time (not confirmed)', dateLabel(item.preferred_tour_time));
      field(dl, 'Message', item.message);
      field(dl, 'Consent recorded', dateLabel(item.consent_at));
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.status === 'acknowledged' ? 'Acknowledged' : 'Acknowledge request';
      button.disabled = item.status === 'acknowledged';
      button.addEventListener('click', () => acknowledge(item.request_id, button));
      card.append(head, dl, button);
      list.append(card);
    }
  }

  async function loadQueue(key) {
    if (busy) return;
    const epoch = ++accessEpoch;
    busy = true;
    signinButton.disabled = true;
    refreshButton.disabled = true;
    clearMessages();
    try {
      const response = await fetch(`${apiBase}/api/v1/inquiries/staff?limit=50`, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      if (epoch !== accessEpoch) return;
      if (!response.ok) throw response;
      const payload = await response.json();
      if (epoch !== accessEpoch) return;
      if (!Array.isArray(payload.items)) throw new Error('The staff queue returned an invalid response.');
      accessKey = key;
      credentialInput.value = '';
      render(payload.items);
      signin.hidden = true;
      queue.hidden = false;
    } catch (error) {
      if (epoch !== accessEpoch) return;
      clearAccess();
      showError(error instanceof Error ? error.message : errorMessage(error));
    } finally {
      if (epoch === accessEpoch) {
        busy = false;
        signinButton.disabled = false;
        refreshButton.disabled = false;
      }
    }
  }

  $('signin-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!apiBase) { showError('The staff queue is disabled until its isolated site and API are configured.'); return; }
    const key = credentialInput.value.trim();
    if (!key) { showError('Enter your approved staff credential.'); return; }
    loadQueue(key);
  });
  refreshButton.addEventListener('click', () => { if (accessKey) loadQueue(accessKey); });
  $('signout-button').addEventListener('click', () => { clearAccess(); clearMessages(); credentialInput.focus(); });
  window.addEventListener('pagehide', clearAccess);
  if (!apiBase) {
    signinButton.disabled = true;
    showError('The staff queue is disabled until its isolated site and API are configured.');
  }
})();
