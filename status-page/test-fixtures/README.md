# Test data for the status page

Everything in this folder is made up for the tests in
`status-page/render.test.mjs` and for looking at the page in a browser. None
of it was measured, and none of it is ever published: the monitor workflow
copies only the files named in `status-page/publish-manifest.txt` to the
`sre-status` branch, and the real `status.json`, `uptime/daily.json`,
`incidents.json` and `slo.json` there are written by the monitoring scripts.

Each folder is one situation, in the shapes of `scripts/sre/README.md`, as it
would stand at 2026-11-12T15:05:00Z:

| Folder | Situation |
| --- | --- |
| `healthy/` | Everything working, six weeks of history with a few bad days and one day without data, one resolved incident inside the last 30 days and one older |
| `incident/` | The website is down, the calculators are degraded, two open incidents with updates |
| `first-day/` | Monitoring was switched on a few hours ago: no hourly result yet, one day of history, nothing measured long enough to report |

Incident texts start with "TEST DATA" so that a screenshot cannot be mistaken
for a real incident.

The fixtures are hand-made. `status-page/pipeline.test.mjs` checks the page
against the real thing as well: it runs `state.mjs`, `slo-calc.mjs` and
`alert.mjs` on made-up runs in a temporary folder and renders what they
wrote.
