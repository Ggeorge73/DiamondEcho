// TLS certificate checks for the four hosts visitors and staff reach: is the
// certificate valid for the name, how many days until it expires, and is the
// connection TLS 1.2 or newer. Cloudflare and Google renew these certificates
// by themselves, which is exactly why nobody watches them: when a renewal
// silently stops, every browser shows a full-page warning on the same day.
//
// The default transport opens a real TLS connection with node:tls and lets
// Node verify the certificate the way a browser would. It never switches
// verification off; a certificate Node refuses is reported as invalid with
// the reason Node gave.
import tls from "node:tls";
import { makeCheck } from "../lib/schema.mjs";

export const suites = ["slow"];

const DAY_MS = 86_400_000;
const CONNECT_TIMEOUT_MS = 10_000;

// Days left below which the check fails, most urgent first. 21 days is past
// the point where an automatic renewal should already have happened.
export const EXPIRY_LEVELS = [
  { under: 2, severity: "sev1" },
  { under: 7, severity: "sev2" },
  { under: 21, severity: "sev3" },
];
const PROTOCOL_RANK = { TLSv1: 10, "TLSv1.1": 11, "TLSv1.2": 12, "TLSv1.3": 13 };
const SEVERITY_ORDER = ["sev1", "sev2", "sev3", "sev4"];

// Errors that mean "the network did not let us look", not "the certificate
// is bad". Anything Node raises about the certificate itself has CERT,
// SELF_SIGNED, ALTNAME, ISSUER or SIGNATURE in its code.
const NETWORK_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH", "EPIPE", "ECONNABORTED", "EADDRNOTAVAIL"]);
const CERTIFICATE_CODE = /CERT|SELF_SIGNED|ALTNAME|ISSUER|SIGNATURE|INVALID_CA|INVALID_PURPOSE|HOSTNAME_MISMATCH/;
const HANDSHAKE_CODE = /^(ERR_SSL_|ERR_TLS_|EPROTO$)/;

// The default transport. Resolves with what the server presented once Node
// has verified it; rejects with Node's error (its `code` says why) otherwise.
// Verification and the TLS 1.2 floor are spelled out, not left to defaults, so
// an environment variable such as NODE_TLS_REJECT_UNAUTHORIZED cannot quietly
// turn this into a check that passes every certificate.
export function tlsConnect({ host, port = 443, timeoutMs = CONNECT_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: true, minVersion: "TLSv1.2" });
    const fail = (error) => {
      socket.destroy();
      if (!settled) { settled = true; reject(error); }
    };
    socket.setTimeout(timeoutMs, () => fail(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })));
    socket.on("error", fail);
    socket.once("secureConnect", () => {
      socket.setTimeout(0);
      const certificate = socket.getPeerCertificate();
      const info = {
        protocol: socket.getProtocol(),
        validFrom: toIso(certificate.valid_from),
        validTo: toIso(certificate.valid_to),
        altNames: String(certificate.subjectaltname ?? "").split(",").map((entry) => entry.trim()).filter((entry) => entry.startsWith("DNS:")).map((entry) => entry.slice(4)),
        commonName: certificate.subject?.CN ?? null,
        issuer: certificate.issuer?.O ?? certificate.issuer?.CN ?? null,
      };
      settled = true;
      socket.end();
      resolve(info);
    });
  });
}

function toIso(text) {
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

// Does the certificate cover this host? An exact name, or a wildcard that
// stands for exactly one label (*.example.com covers a.example.com only).
export function coversHost(host, names) {
  const wanted = host.toLowerCase();
  return names.some((entry) => {
    const name = String(entry).toLowerCase();
    if (name === wanted) return true;
    if (!name.startsWith("*.")) return false;
    const dot = wanted.indexOf(".");
    return dot > 0 && wanted.slice(dot + 1) === name.slice(2);
  });
}

// Every problem with what the server presented, each with its severity.
export function certificateProblems({ host, info, nowMs }) {
  const problems = [];
  const names = info.altNames?.length ? info.altNames : info.commonName ? [info.commonName] : [];
  if (!coversHost(host, names)) problems.push({ severity: "sev1", text: `the certificate is for ${names.slice(0, 3).join(", ") || "no name"}, not ${host}` });
  const from = Date.parse(info.validFrom);
  const to = Date.parse(info.validTo);
  if (Number.isNaN(to)) problems.push({ severity: "sev1", text: "the certificate's expiry date could not be read" });
  else {
    const daysLeft = (to - nowMs) / DAY_MS;
    const date = new Date(to).toISOString().slice(0, 10);
    if (daysLeft <= 0) problems.push({ severity: "sev1", text: `the certificate expired on ${date}` });
    else {
      const level = EXPIRY_LEVELS.find((entry) => daysLeft < entry.under);
      if (level) problems.push({ severity: level.severity, text: `the certificate expires on ${date}, in ${describeDays(daysLeft)}, and has not been renewed` });
    }
  }
  if (!Number.isNaN(from) && from > nowMs) problems.push({ severity: "sev1", text: `the certificate is not valid until ${new Date(from).toISOString().slice(0, 10)}` });
  const rank = PROTOCOL_RANK[info.protocol];
  if (!rank || rank < PROTOCOL_RANK["TLSv1.2"]) problems.push({ severity: "sev2", text: `the connection used ${info.protocol || "an unknown protocol"}, older than TLS 1.2` });
  return problems;
}

function describeDays(days) {
  if (days < 1) return "less than a day";
  const whole = Math.floor(days);
  return `${whole} day${whole === 1 ? "" : "s"}`;
}

// Sort a connection error into: the certificate is bad (sev1), the TLS
// handshake itself was refused (sev1), or we could not look (sev3). Only
// Node's short error code is kept: a message can carry the far side's words,
// and the detail is public.
export function classifyError(error) {
  const raw = String(error?.code ?? error?.cause?.code ?? "");
  const code = /^[A-Z][A-Z0-9_]{1,59}$/.test(raw) ? raw : "unknown error";
  if (NETWORK_CODES.has(code)) return { kind: "unreachable", severity: "sev3", code };
  if (CERTIFICATE_CODE.test(code)) return { kind: "invalid", severity: "sev1", code };
  if (HANDSHAKE_CODE.test(code)) return { kind: "handshake", severity: "sev1", code };
  return { kind: "unreachable", severity: "sev3", code };
}

// The clock for date arithmetic, in milliseconds since 1970. SRE_NOW (an ISO
// time) wins when set, so drills and tests can replay any day; production
// never sets it. If a caller ever passes a stopwatch-style now() instead,
// fall back to the system clock rather than call a certificate good for
// centuries. domain.mjs has the same rule.
export function wallClock(ctx) {
  const replay = Date.parse(ctx.env?.SRE_NOW ?? "");
  if (!Number.isNaN(replay)) return replay;
  const value = ctx.now();
  return value > 1e12 ? value : Date.now();
}

export function hostsFor(targets) {
  return [
    { id: "tls-public", origin: targets.publicOrigin },
    { id: "tls-www", origin: targets.wwwOrigin },
    { id: "tls-staff", origin: targets.staffOrigin },
    { id: "tls-api", origin: targets.apiOrigin },
  ].map(({ id, origin }) => ({ id, host: new URL(origin).hostname }));
}

async function checkHost(ctx, { id, host }) {
  const connect = ctx.tlsConnect ?? tlsConnect;
  const name = `Certificate for ${host}`;
  const started = ctx.now();
  let attempts = 0;
  let failure = null;
  let info = null;
  // One more try when the network, not the certificate, was the trouble.
  while (attempts < 2 && !info) {
    attempts += 1;
    try {
      info = await connect({ host, port: 443, timeoutMs: CONNECT_TIMEOUT_MS });
    } catch (error) {
      failure = classifyError(error);
      if (failure.kind !== "unreachable") break;
    }
  }
  const latency_ms = Math.max(0, ctx.now() - started);
  const base = { id, name, component: "tls", latency_ms, attempts, slis: [] };
  if (!info) {
    const detail = {
      unreachable: `Could not open a TLS connection to ${host} (${failure.code}), so the certificate was not seen. This is not proof of a certificate problem.`,
      invalid: `The certificate for ${host} is not valid (${failure.code}). Browsers will show a warning page.`,
      handshake: `${host} refused the TLS handshake (${failure.code}), for example because it offers nothing newer than TLS 1.1. Browsers cannot connect.`,
    }[failure.kind];
    return makeCheck({ ...base, ok: false, severity: failure.severity, detail });
  }
  const observed = {};
  if (info.validTo) observed.expires = info.validTo.slice(0, 10);
  if (info.issuer) observed.issuer = String(info.issuer).slice(0, 100);
  if (info.protocol) observed.protocol = String(info.protocol).slice(0, 100);
  const problems = certificateProblems({ host, info, nowMs: wallClock(ctx) });
  if (problems.length) {
    const severity = SEVERITY_ORDER.find((level) => problems.some((problem) => problem.severity === level));
    const text = problems.map((problem) => problem.text).join("; ");
    return makeCheck({ ...base, ok: false, severity, detail: `${host}: ${text}.`, observed });
  }
  const daysLeft = Math.floor((Date.parse(info.validTo) - wallClock(ctx)) / DAY_MS);
  // A passing check carries the first warning level it would fail at.
  return makeCheck({
    ...base, ok: true, severity: "sev3", observed,
    detail: `Valid until ${observed.expires} (${daysLeft} days left), ${info.protocol}${info.issuer ? `, issued by ${info.issuer}` : ""}.`,
  });
}

export async function run(ctx) {
  return Promise.all(hostsFor(ctx.targets).map((entry) => checkHost(ctx, entry)));
}
