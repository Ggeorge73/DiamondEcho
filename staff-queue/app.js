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
  const SVG = "http://www.w3.org/2000/svg";
  function hideSetup() {
    el("secret").textContent = ""; el("secret").hidden = true;
    el("secret-label").textContent = ""; el("secret-label").hidden = true;
    el("qr").replaceChildren(); el("qr-block").hidden = true;
  }
  // Draws the setup address as a QR code out of plain SVG shapes. This page's
  // content policy allows no images and no inline styles, so there is no <img>,
  // no canvas export and no style attribute: one white square and one black path.
  // Returns false, and shows nothing, if the code cannot be made.
  function drawQr(text) {
    let grid = null;
    try { grid = text && window.DIAMOND_ECHO_STAFF_QR ? window.DIAMOND_ECHO_STAFF_QR(text) : null; } catch { grid = null; }
    if (!Array.isArray(grid) || !grid.length) return false;
    const quiet = 4, size = grid.length + quiet * 2;
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 " + size + " " + size);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "QR code to scan with your authenticator app");
    svg.setAttribute("shape-rendering", "crispEdges");
    const paper = document.createElementNS(SVG, "rect");
    paper.setAttribute("width", size); paper.setAttribute("height", size); paper.setAttribute("fill", "#ffffff");
    let squares = "";
    grid.forEach((row, r) => row.forEach((dark, c) => { if (dark) squares += "M" + (c + quiet) + " " + (r + quiet) + "h1v1h-1z"; }));
    const ink = document.createElementNS(SVG, "path");
    ink.setAttribute("d", squares); ink.setAttribute("fill", "#000000");
    svg.append(paper, ink);
    el("qr").replaceChildren(svg); el("qr-block").hidden = false;
    return true;
  }
  function clear() {
    el("inquiries").replaceChildren(); el("count").textContent = "";
    el("episodes").replaceChildren(); el("podcast-panel").hidden = true;
    el("podcast-open").setAttribute("aria-expanded", "false"); el("podcast-open").textContent = "Show podcast episodes";
    el("podcast-form").reset(); el("podcast-progress").hidden = true;
    hideSetup();
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
    for (const id of ["signin-button", "mfa-button", "refresh-button", "podcast-upload", "podcast-open"]) el(id).disabled = value;
  }
  async function request(path, method = "GET", body) {
    const generation = epoch;
    const token = await auth.getToken();
    if (generation !== epoch) return null;
    const headers = { Authorization: "Bearer " + token };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(config.apiBase + path, {
      method, headers, cache: "no-store", credentials: "omit", redirect: "error",
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    if (generation !== epoch) return null;
    if (response.status === 401 || response.status === 403) {
      await logout(); throw Object.assign(new Error("Access denied. Sign in with the approved staff account and authenticator."), { queueError: true });
    }
    if (!response.ok) throw Object.assign(new Error("The queue is temporarily unavailable. No action was confirmed."), { queueError: true, status: response.status });
    const data = await response.json();
    return generation === epoch ? data : null;
  }
  const api = (path, method = "GET") => request("/api/v1/inquiries/staff" + path, method);
  // The business keeps Eastern time, and the response time is counted in it. Show
  // every time that way and name the zone, whatever clock the device in use keeps.
  const eastern = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short",
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  function when(value) {
    const date = new Date(value);
    return value && Number.isFinite(date.getTime()) ? eastern.format(date) : value;
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
        ["Tour time", when(item.preferred_tour_time)], ["Submitted", when(item.submitted_at)],
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
  // Podcast episodes. The file goes straight from this browser to Cloud Storage
  // through an upload session the API opens for this staff site only; the API
  // then checks the whole file arrived before it publishes the episode.
  const PODCAST = "/api/v1/podcast/staff/episodes";
  const AUDIO_TYPES = { mp3: "audio/mpeg", m4a: "audio/mp4" };
  function audioType(file) {
    if (["audio/mpeg", "audio/mp4", "audio/x-m4a"].includes(file.type)) return file.type;
    return AUDIO_TYPES[(file.name.split(".").pop() || "").toLowerCase()] || "";
  }
  function sendFile(url, file, type) {
    return new Promise((resolve, reject) => {
      const xhr = new window.XMLHttpRequest();
      xhr.open("PUT", url);
      xhr.setRequestHeader("Content-Type", type);
      xhr.upload.onprogress = event => { if (event.lengthComputable) el("podcast-progress").value = Math.round(event.loaded / event.total * 100); };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("upload " + xhr.status)));
      xhr.onerror = () => reject(new Error("upload failed"));
      xhr.send(file);
    });
  }
  function renderEpisodes(items) {
    el("episodes").replaceChildren();
    if (!items.length) {
      const li = document.createElement("li"); li.className = "hint"; li.textContent = "No episodes yet.";
      el("episodes").append(li); return;
    }
    for (const item of items) {
      const li = document.createElement("li"); li.className = "inquiry";
      const heading = document.createElement("h2"); heading.textContent = item.title; li.append(heading);
      const dl = document.createElement("dl");
      for (const [label, value] of [["Status", { published: "Published", hidden: "Unpublished", uploading: "Upload not finished" }[item.status] || item.status],
        ["Published", when(item.published_at)], ["Uploaded", when(item.created_at)], ["Description", item.description]]) {
        if (!value) continue;
        const dt = document.createElement("dt"); dt.textContent = label;
        const dd = document.createElement("dd"); dd.textContent = value;
        dl.append(dt, dd);
      }
      li.append(dl);
      const actions = document.createElement("div"); actions.className = "episode-actions";
      const action = item.status === "published" ? "unpublish" : "publish";
      const button = document.createElement("button");
      button.textContent = action === "publish" ? (item.status === "uploading" ? "Try publishing again" : "Publish") : "Unpublish";
      button.addEventListener("click", async () => {
        if (busy) return; toggle(true); button.disabled = true;
        try {
          const result = await request(PODCAST + "/" + encodeURIComponent(item.id) + "/" + action, "POST");
          if (result) { message(action === "publish" ? "Episode published." : "Episode unpublished. It no longer shows on the public site.", true); await loadEpisodes(); }
        } catch (error) {
          message(error.status === 409 ? "The audio file has not finished uploading. Upload the episode again." : error.message);
        } finally { toggle(false); button.disabled = false; }
      });
      actions.append(button);
      li.append(actions);
      el("episodes").append(li);
    }
  }
  async function loadEpisodes() {
    const data = await request(PODCAST);
    if (data) renderEpisodes(data.items);
  }
  el("podcast-open").addEventListener("click", async () => {
    if (busy) return;
    const opening = el("podcast-panel").hidden;
    el("podcast-panel").hidden = !opening;
    el("podcast-open").setAttribute("aria-expanded", String(opening));
    el("podcast-open").textContent = opening ? "Hide podcast episodes" : "Show podcast episodes";
    if (!opening) return;
    toggle(true);
    try { await loadEpisodes(); } catch (error) { message(error.message); } finally { toggle(false); }
  });
  el("podcast-form").addEventListener("submit", async event => {
    event.preventDefault(); if (busy) return;
    const file = el("podcast-file").files[0];
    const type = file ? audioType(file) : "";
    if (!file || !type) { message("Choose an MP3 or M4A audio file."); return; }
    if (file.size > 300 * 1024 * 1024) { message("That file is over 300 MB. Export it at a lower bitrate and try again."); return; }
    toggle(true);
    el("podcast-progress").value = 0; el("podcast-progress").hidden = false;
    try {
      const started = await request(PODCAST, "POST", { title: el("podcast-title").value.trim(),
        description: el("podcast-description").value.trim(), content_type: type, size_bytes: file.size });
      if (!started) return;
      await sendFile(started.upload_url, file, type);
      const published = await request(PODCAST + "/" + encodeURIComponent(started.id) + "/publish", "POST");
      if (!published) return;
      el("podcast-form").reset();
      message("Episode uploaded and published.", true);
      await loadEpisodes();
    } catch (error) {
      message(error.queueError ? error.message : "The upload did not finish. Check your connection and try again; nothing was published.");
      try { await loadEpisodes(); } catch { /* the list refreshes next time */ }
    } finally { el("podcast-progress").hidden = true; toggle(false); }
  });
  async function handle(result) {
    // A step has succeeded, so anything said about an earlier failed attempt is stale.
    el("alert").hidden = true; el("notice").hidden = true;
    if (result.type === "ready") { hideSetup(); await refresh(); return; }
    if (result.type === "enrolled") {
      clear(); message("Authenticator enrolled. Sign in again with your password and authenticator.", true); return;
    }
    mode = result.type; el("signin-form").hidden = true; el("mfa-form").hidden = false;
    if (mode === "enroll") {
      const drawn = drawQr(result.uri);
      el("secret-label").textContent = drawn ? "Cannot scan? Enter this setup key in the app instead:" : "Enter this setup key in the app:";
      el("secret-label").hidden = false;
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
    } catch (error) {
      message(error.queueError ? error.message : mode === "enroll"
        ? "Verification failed. Check that the setup key in your authenticator matches the one shown, then retry with the current code. Or cancel and sign in again for a new key."
        : "Verification failed. Retry the current authenticator code or cancel and sign in again.");
    }
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
