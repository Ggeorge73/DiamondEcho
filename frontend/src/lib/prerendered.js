// The build saves each public page as ready-made HTML (scripts/prerender.mjs),
// so the words are on the page before any script has loaded. This says whether
// the HTML the browser was given is the page the address is asking for.
//
// It is not when the address carries something that changes what the page
// shows: /inquire?type=seller arrives with the HTML of the buyer request, and
// /property/123 with the HTML of the search page. Then the saved HTML is
// thrown away and the page is drawn from nothing, as it always was. Campaign
// tags that advertisers and social networks add change nothing on the page,
// so they are let through.
//
// Keep this function free of imports and of anything it reads from outside
// itself: the build also writes it, as text, into every saved page, so the
// wrong page can be cleared before the browser paints it.
export function prerenderMatches(container, location) {
  var marker = container && container.getAttribute && container.getAttribute('data-prerendered');
  if (!marker || !container.firstChild) return false;
  var path = String(location.pathname || '').replace(/\/+$/, '') || '/';
  if (path !== marker) return false;
  var query = String(location.search || '').replace(/^\?/, '');
  if (!query) return true;
  return query.split('&').every(function (part) {
    return /^(utm_[a-z0-9_]+|gclid|gbraid|wbraid|fbclid|msclkid|dclid)(=|$)/i.test(part);
  });
}
