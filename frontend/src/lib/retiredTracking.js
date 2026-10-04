// Earlier builds of this site loaded PostHog analytics. PostHog keeps a cookie,
// and sometimes a local-storage entry, in a visitor's browser for up to a year.
// Nothing on the site reads them any more, so remove them on arrival (DE-18).
const RETIRED_KEY = /^ph_.+_posthog$/;

const parentDomains = (hostname) => {
  const parts = hostname.split('.');
  const domains = [''];
  for (let index = 0; index < parts.length - 1; index += 1) {
    domains.push(`.${parts.slice(index).join('.')}`);
  }
  return domains;
};

export const clearRetiredTracking = (doc = document, hostname = window.location.hostname, storage = window.localStorage) => {
  let removed = 0;
  try {
    const names = doc.cookie.split(';').map((part) => part.split('=')[0].trim()).filter((name) => RETIRED_KEY.test(name));
    names.forEach((name) => {
      // The cookie may sit on this host or on a parent domain, so expire it on each.
      parentDomains(hostname).forEach((domain) => {
        doc.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain ? `; domain=${domain}` : ''}`;
      });
      removed += 1;
    });
  } catch {
    // Cookies can be blocked outright; there is then nothing to remove.
  }
  try {
    Object.keys(storage).filter((key) => RETIRED_KEY.test(key)).forEach((key) => {
      storage.removeItem(key);
      removed += 1;
    });
  } catch {
    // Storage can be unavailable in private windows.
  }
  return removed;
};
