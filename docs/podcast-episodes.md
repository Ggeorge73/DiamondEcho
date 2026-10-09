# Podcast episodes

Requested by Gbenga on 2026-10-09. Built by Claude, acting as the Engineering agent. Builds on the daily audio brief (`docs/market-brief.md`).

## What it does

- **Staff site (`staff.diamondecho.com`).** After sign-in with password and authenticator, **Show podcast episodes** opens an upload form: title, short description, MP3 or M4A file up to 300 MB. **Upload and publish** sends the file and publishes the episode. Each episode in the list has **Unpublish** (hide it from the public site) or **Publish** (show it again).
- **Home page.** Directly below the daily brief, a "Latest episode" card plays the newest published episode and links to all episodes. Nothing shows before the first episode is published.
- **`/podcast` page.** Every published episode, newest first, each with its own player. The page is in the header menu, the phone menu, the footer and the sitemap. Before the first episode it says one is on its way.
- **One sound at a time.** Starting an episode pauses the daily brief and any other episode.

## How an upload travels

1. The staff page asks the API to start an episode (`POST /api/v1/podcast/staff/episodes`, staff sign-in required).
2. The API opens a Cloud Storage upload session, using its own Cloud Run identity, for the staff site's address only. No storage key ever reaches the browser.
3. The browser sends the file straight to Cloud Storage. It does not pass through the API, which cannot accept requests over 32 MB.
4. The staff page asks the API to publish. The API checks that the whole file arrived (same size) before it marks the episode published.

Episode details are kept in Firestore under `podcast_episodes`. Files live in the bucket named by `PODCAST_BUCKET`, at `episodes/<id>.mp3` or `.m4a`.

The public list (`GET /api/v1/podcast/episodes`) gives only published episodes: title, description, date and the file address. It is cached for 5 minutes.

## Switching it on (Gbenga's approval needed for each step)

Staging first. For production, use `diamondecho-prod`, `diamondecho-api`, the bucket `diamondecho-podcast` and the production staff site.

```bash
PROJECT=diamondecho-staging; SERVICE=diamondecho-api-staging; BUCKET=diamondecho-podcast-staging
# 1. A bucket for episode files, in the API's region
gcloud storage buckets create gs://$BUCKET --project $PROJECT --location us-east1 --uniform-bucket-level-access
# 2. Anyone may play episode files (they are public by design); nobody may list or change them
gcloud storage buckets add-iam-policy-binding gs://$BUCKET --member=allUsers --role=roles/storage.objectViewer
# 3. The API's own identity may write episode files
SA=$(gcloud run services describe $SERVICE --region us-east1 --project $PROJECT --format='value(spec.template.spec.serviceAccountName)')
gcloud storage buckets add-iam-policy-binding gs://$BUCKET --member=serviceAccount:$SA --role=roles/storage.objectAdmin
# 4. Tell the API which bucket to use (redeploy from the merged commit at the same time)
gcloud run services update $SERVICE --region us-east1 --project $PROJECT --update-env-vars PODCAST_BUCKET=$BUCKET
```

Step 2 can be refused if the organization enforces "public access prevention". In that case the episodes cannot be played publicly from this bucket; tell Claude, and the files can be served another way.

**The staff site must be rebuilt** after this change merges. Its content policy now allows uploads to `https://storage.googleapis.com` and nowhere else new.

**Cost:** storage at about 2 cents per GB per month, plus internet download charges at about 12 cents per GB played. A 30-minute MP3 is about 30 MB, so 100 plays cost about 36 cents.

## Undo

- **Hide an episode:** press **Unpublish** on the staff site. The file stays in the bucket.
- **Turn the podcast off:** remove `PODCAST_BUCKET` from the API. The home card disappears and the Podcast page shows its "on its way" message.
- **Remove the files:** deleting them from the bucket, or deleting the bucket, is Gbenga's action.

## Not proven yet

The upload has been tested only with stand-ins for Cloud Storage and the API, because the build session has no Google Cloud access. Three things are verified on staging after the steps above:
- a real upload from the staff site on a phone and on a computer;
- playback on the home page and the Podcast page;
- that an unpublished episode disappears within the 5-minute cache.
