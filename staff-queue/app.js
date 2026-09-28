(() => {
  "use strict";
  const config = window.DIAMOND_ECHO_STAFF_CONFIG || {};
  const auth = window.DIAMOND_ECHO_STAFF_AUTH;
  const configured = config.enabled && auth && window.location.origin === config.staffOrigin;
  const el = id => document.getElementById(id);
  let epoch = 0, mode = "", busy = false;
  function message(text, notice = false) {
    el("alert").hidden = true; el("notice").hidden = true;
    const target = el(notice ? "notice" : "alert");
    target.textContent = text; target.hidden = false;
    if (!notice) target.focus();
  }
  function clear() {
    el("inquiries").replaceChildren(); el("count").textContent = "";
    el("secret").textContent = ""; el("secret").hidden = true;
    el("code").value = ""; el("password").value = "";
    el("enrollment").hidden = true; el("mfa-form").hidden = true;
    el("signin-form").hidden = false; el("signin-section").hidden = false;
    el("queue-section").hidden = true; mode = "";
  }
  async function logout() {
    epoch++; clear();
    try { await auth?.signOut(); } catch { /* Local data is already cleared. */ }
  }
  function toggle(value) {
    busy = value;
    for (const id of ["signin-button", "mfa-button", "refresh-button"]) el(id).disabled = value;
  }
  async function api(path, method = "GET") {
    const generation = epoch;
    const token = await auth.getToken();
    if (generation !== epoch) return null;
    const response = await fetch(config.apiBase + "/api/v1/inquiries/staff" + path, {
      method, headers: { Authorization: "Bearer " + token }, cache: "no-store",
      credentials: "omit", redirect: "error"
    });
    if (generation !== epoch) return null;
    if (response.status === 401 || response.status === 403) {
      await logout(); throw Object.assign(new Error("Access denied. Sign in with the approved staff account and authenticator."), { queueError: true });
    }
    if (!response.ok) throw Object.assign(new Error("The queue is temporarily unavailable. No action was confirmed."), { queueError: true });
    const data = await response.json();
    return generation === epoch ? data : null;
  }
  function render(items) {
    el("inquiries").replaceChildren();
    el("count").textContent = items.length + " recent request(s)";
    for (const item of items) {
      const li = document.createElement("li"); li.className = "inquiry";
      const heading = document.createElement("h2"); heading.textContent = item.kind + " — " + item.status; li.append(heading);
      const dl = document.createElement("dl");
      for (const [label, value] of [
        ["Reference", item.request_id], ["Name", item.full_name], ["Email", item.email],
        ["Phone", item.phone], ["Message", item.message], ["Property", item.property_address || item.property_id],
        ["Tour time", item.preferred_tour_time], ["Submitted", item.submitted_at],
        ["Consent version", item.consent_version]]) {
        if (!value) continue;
        const dt = document.createElement("dt"); dt.textContent = label;
        const dd = document.createElement("dd"); dd.textContent = value;
        dl.append(dt, dd);
      }
      li.append(dl);
      if (item.status === "queued") {
        const button = document.createElement("button"); button.textContent = "Acknowledge";
        button.addEventListener("click", async () => {
          if (busy) return; toggle(true); button.disabled = true;
          try {
            const result = await api("/" + encodeURIComponent(item.request_id) + "/acknowledge", "PATCH");
            if (result) { message("Request acknowledged.", true); await refresh(); }
          } catch (error) { message(error.message); } finally { toggle(false); button.disabled = false; }
        });
        li.append(button);
      }
      el("inquiries").append(li);
    }
  }
  async function refresh() {
    const data = await api("?limit=50");
    if (!data) return;
    render(data.items);
    el("signin-section").hidden = true; el("queue-section").hidden = false;
  }
  async function handle(result) {
    if (result.type === "ready") { el("secret").textContent = ""; await refresh(); return; }
    if (result.type === "enrolled") {
      clear(); message("Authenticator enrolled. Sign in again with your password and authenticator.", true); return;
    }
    mode = result.type; el("signin-form").hidden = true; el("mfa-form").hidden = false;
    if (mode === "enroll") {
      el("secret").textContent = result.secret; el("secret").hidden = false; el("enrollment").hidden = false;
    }
    el("code").focus();
  }
  el("signin-form").addEventListener("submit", async event => {
    event.preventDefault(); if (busy || !configured) return;
    toggle(true); const generation = ++epoch;
    const password = el("password").value; el("password").value = "";
    try {
      const result = await auth.signIn(el("email").value.trim(), password);
      if (generation !== epoch) { await auth.signOut(); return; }
      await handle(result);
    } catch (error) { await logout(); message(error.queueError ? error.message : "Sign-in failed. Check your credentials, verified email and staff configuration."); }
    finally { toggle(false); }
  });
  el("mfa-form").addEventListener("submit", async event => {
    event.preventDefault(); if (busy) return; toggle(true);
    const generation = epoch, code = el("code").value; el("code").value = "";
    try {
      const result = mode === "enroll" ? await auth.completeEnrollment(code) : await auth.completeMfa(code);
      if (generation !== epoch) { await auth.signOut(); return; }
      await handle(result);
    } catch (error) { message(error.queueError ? error.message : "Verification failed. Retry the current authenticator code or cancel and sign in again."); }
    finally { toggle(false); }
  });
  el("refresh-button").addEventListener("click", async () => {
    if (busy) return; toggle(true);
    try { await refresh(); } catch (error) { message(error.message); } finally { toggle(false); }
  });
  for (const id of ["cancel-button", "signout-button"]) el(id).addEventListener("click", async () => { await logout(); message("Signed out.", true); });
  window.addEventListener("pagehide", () => { void logout(); });
  if (!configured) {
    el("signin-button").disabled = true;
    message("Staff access is disabled until the isolated deployment is configured.");
  }
})();
