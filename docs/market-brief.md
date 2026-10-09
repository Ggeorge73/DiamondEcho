# Daily audio brief: welcome, site tour and Georgia market

Requested by Gbenga on 2026-10-09. Built by Claude, acting as the Engineering agent.

## What a visitor gets

A section directly below the home page's opening hero, "Today's Georgia market. Read aloud.", and a small audio bar fixed at the bottom left of the screen. On phones the bar sits above the concierge button.

1. A soft two-note chime, made in the browser.
2. The welcome and site tour, in a soft female voice. It begins "Welcome to DiamondEcho Realty" and explains how to use the site.
3. The day's Georgia market brief: mortgage rates and current Georgia housing figures. Each figure is read with its publisher and the period it covers.

Each figure also appears as a card with a link to its publisher. A transcript gives the same words as text.

### How it starts, and why not on its own

Chrome, Safari and Firefox do not let a page play sound before the visitor has clicked, tapped or pressed a key on it. No site can override this. The player:

- tries to start at once, which some browsers allow for sites a visitor uses often;
- otherwise shows "Tap anywhere to hear your welcome to DiamondEcho" and starts on the visitor's first click, tap or key press anywhere on the page.

Pause, play, "Today's market" (skip the tour) and close are always on screen. A visitor who pauses, closes or finishes the brief is not played it again during that visit. Session storage keeps that note until the tab is closed. Leaving the home page stops the sound.

## Where the figures come from

`backend/market_brief/sources.py`. Every figure carries its publisher, link and date. A figure is spoken only while it is current: 21 days for weekly series, 120 for monthly and 270 for quarterly. A source that cannot be read is left out and listed under `unavailable`. Nothing is estimated or filled in.

| Figure | Publisher | Read from | How often it changes |
| --- | --- | --- | --- |
| 30-year and 15-year fixed mortgage rates, national average, change from the week before | Freddie Mac Primary Mortgage Market Survey | FRED `MORTGAGE30US` and `MORTGAGE15US`. If that fails, `freddiemac.com/pmms/docs/PMMS_history.csv` (which refuses Google Cloud: HTTP 403 on staging) | Weekly (Thursdays) |
| Georgia median listing price, change from a year earlier | Realtor.com | FRED `MEDLISPRIGA` | Monthly |
| Georgia number of active listings, change from a year earlier | Realtor.com | FRED `ACTLISCOUGA` | Monthly |
| Georgia median days on market | Realtor.com | FRED `MEDDAYONMARGA` | Monthly |
| Atlanta metro median listing price, change from a year earlier | Realtor.com | FRED `MEDLISPRI12060` | Monthly |
| Georgia house price index, change from a year earlier (the index level is not read) | Federal Housing Finance Agency | FRED `GASTHPI` | Quarterly |
| Georgia new housing units authorized by building permits | U.S. Census Bureau | FRED `GABPPRIVSA` | Monthly |
| Georgia unemployment rate | U.S. Bureau of Labor Statistics | FRED `GAUR` | Monthly |

**Daily, but not all new each day.** The brief is rebuilt every day, Eastern time, and says the day's date. Mortgage rates change weekly. Most Georgia housing figures change monthly, so on most days some figures repeat until the publisher releases new ones.

**Not used yet:** Georgia Realtors monthly market reports and FMLS market statistics. Gbenga asked for them. Their terms of use for republishing on this site were not confirmed, and some FMLS reports need a member sign-in. They are listed in `DISABLED_SOURCES`, so the decision stays visible. Turning one on needs Gbenga's confirmation that the terms allow it, plus a reader for its format.

**Not checked from the build session:** the build session could not reach freddiemac.com, FRED or Google. The file formats and FRED series names were coded from the publishers' documented formats and tested against sample files. The first run with network access must confirm that each series returns a value, by checking the `unavailable` list in `GET /api/v1/market-brief`.

## The voice

Google Cloud Text-to-Speech, voice `en-US-Neural2-F` at 0.95 speed. Set `MARKET_BRIEF_VOICE` to use another Google voice name. The API service calls it with its own Cloud Run identity, so there is no key to store. Only the script is sent to Google, nothing about the visitor.

Cost: about 2,000 characters for the tour, made once and made again only if its wording or the voice changes, plus about 1,500 characters a day for the market part. That is about 50,000 characters a month, inside the 1 million characters a month Google gives free for this voice type.

## How it is served

| Request | Answer |
| --- | --- |
| `GET /api/v1/market-brief` | The day's brief as JSON: tour script and audio address, market script, figures, unavailable sources, sources not used. Cached for 10 minutes |
| `GET /api/v1/market-brief/audio/<date or tour-key>.mp3` | The MP3. Tour audio is cached for a day and a dated brief for an hour |

The first request of each Eastern-time day reads the sources and has the voice read the script. Visitors hear the tour first, so this happens while the tour is still playing.

A complete brief, with figures and audio, is kept in Firestore in the collection `market_briefs`: one document per date, plus one for the tour. Google's MP3 for a two-minute script is about 1 MB, more than one Firestore document can hold (found on staging, 2026-10-09: 1,008,192 bytes). Each recording is therefore stored in parts of up to 700,000 bytes, each its own document named after its build, and joined again when played. Later visitors and other instances reuse it. An incomplete brief (no figures, or the voice failed) is kept in memory only, and built again after 15 minutes.

Firestore rules already deny all browser access, and the service uses the Admin SDK.

## Switching it on (Gbenga's approval needed for each step)

1. Enable the Text-to-Speech API in `diamondecho-prod` (and in staging first).
2. On the `diamondecho-api` Cloud Run service, set `MARKET_BRIEF_ENABLED=true`. `FIREBASE_PROJECT_ID` is already set.
3. Redeploy the API from the merged commit, and the public site from the same commit.
4. Check `GET /api/v1/market-brief`: confirm figures are present, `unavailable` is empty or explained, and both audio addresses play.

Until step 2 the service answers 503 and the home page shows nothing new.

**Undo:** set `MARKET_BRIEF_ENABLED=false`. The section and the bar disappear on the next page load. The stored documents in `market_briefs` hold no visitor data, and deleting them is optional.

## Rules followed

- **AGENTS.md:** no fictional metrics. Every number comes from a named publisher with its period, and an unavailable source is left out rather than estimated.
- **DE-17:** no market claims of DiamondEcho's own. The tour describes only what the site has.
- **DE-18 privacy:** the Privacy page has a "Daily audio brief" section, and its date moved to October 9, 2026.
- **WCAG 1.4.2:** sound that starts can be paused or stopped at once, and a transcript is provided.
