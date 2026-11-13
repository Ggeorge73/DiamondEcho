# Backup and restore of the database

Written 2026-11-13 by the SRE infrastructure role (an AI collaborator). No
command here has been run. **A restore has never been tested** (DE-28); the
drill below is for Gbenga to run. Until it has been run, the honest answer to
"can we get the requests back?" is "probably, not proven".

## What is stored, and why it matters

The database is Firestore `(default)` in `diamondecho-prod`, `us-east1`. It
holds the inquiries (collection `inquiries`) and the API's own small records
(`status_checks`; the podcast and market brief collections exist in the code
but are taken as switched off in production, see
[architecture.md](architecture.md)). The arrival email carries no visitor
detail, so **the database is the only copy of a request**. Losing it loses
the request.

## What protects it today

As recorded in `docs/de13-production-setup.md`:

| Protection | State |
| --- | --- |
| Daily backup schedule | On since 2026-10-05, kept 7 days. First backups read `READY` at 2026-10-05T23:57:56Z and 2026-10-07T00:07:16Z |
| Delete protection | On since 2026-10-07 02:25 UTC. The database cannot be deleted until someone switches it off |
| Point-in-time recovery | Off (it has a cost and was not asked for) |
| Restore tested | **No.** The owner decided on 2026-10-07 to launch without it; it moved to DE-28 |

## How much could be lost, and how long it would take

- **Recovery point** (how much recent data a restore loses): up to about one
  day. The backup runs once a day, around midnight UTC judging by the two
  recorded backups, so a request that arrived after the last backup is not in
  it. With point-in-time recovery switched on, this would shrink to minutes;
  see "Options" below.
- **Oldest point you can go back to**: 7 days. A problem noticed later than
  that cannot be undone from backups.
- **Recovery time** (how long until the data is back): **not known.** It has
  never been measured. The drill measures it; write the result here.

## The restore drill

Goal: prove a backup can be restored, and measure how long it takes, without
touching the live database. A Firestore restore always creates a **new**
database; it cannot overwrite an existing one. So the drill restores into a
scratch database named `restore-drill-<date>` in the same project. The API
only ever reads `(default)`, so nothing visitors use changes.

The scratch database is a copy of real visitor requests. Treat it like the
real one: only Gbenga opens it, nothing from it is copied out, and it is
deleted at the end.

Who: **Gbenga**, in Cloud Shell. When: a quiet hour. Cost: a restore is billed
per GiB restored and the copy is billed for storage until deleted; for a
database this small both are expected to be cents (not measured).

Each step that creates or deletes something **needs Gbenga's yes**; the drill
as a whole can be one yes.

1. **Read-only.** See the schedule and the backups that exist:
   ```bash
   gcloud firestore backups schedules list --database="(default)" --project diamondecho-prod
   gcloud firestore backups list --location=us-east1 --project diamondecho-prod --format="table(name.basename(),snapshotTime,expireTime,state)"
   ```
   Healthy: one daily schedule with 7-day retention, and up to seven backups,
   each `READY`. Write down the newest backup's ID (the first column) and its
   `snapshotTime`.

2. **Read-only.** Count the requests in the live database, so there is a
   number to compare. This prints a count, nothing else:
   ```bash
   count() { curl -sS -X POST \
     -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "Content-Type: application/json" \
     "https://firestore.googleapis.com/v1/projects/diamondecho-prod/databases/$1/documents:runAggregationQuery" \
     -d '{"structuredAggregationQuery":{"structuredQuery":{"from":[{"collectionId":"inquiries"}]},"aggregations":[{"alias":"n","count":{}}]}}' \
     | grep -o '"integerValue": *"[0-9]*"'; }
   count "(default)"
   ```
   Note the number. Requests that arrived after the backup's `snapshotTime`
   will be in this count but not in the copy.

3. **Needs Gbenga's yes.** Start the clock and restore the newest backup into
   the scratch database (replace `BACKUP_ID` and the date):
   ```bash
   date -u +%FT%TZ
   gcloud firestore databases restore \
     --source-backup=projects/diamondecho-prod/locations/us-east1/backups/BACKUP_ID \
     --destination-database=restore-drill-20261120 \
     --project diamondecho-prod
   ```

4. **Read-only.** Wait until it is ready, then stop the clock:
   ```bash
   gcloud firestore databases describe --database=restore-drill-20261120 --project diamondecho-prod --format="value(name,createTime)"
   gcloud firestore operations list --database=restore-drill-20261120 --project diamondecho-prod --format="table(name.basename(),done,metadata.endTime)"
   date -u +%FT%TZ
   ```
   Ready when the restore operation shows `done` True. If this gcloud version
   does not accept `--database` on `operations list`, watch the database in
   the Firebase console instead (Firestore, database list) until its data
   appears, and note the time. This step's exact form has not been tried.

5. **Read-only.** Count the requests in the copy:
   ```bash
   count restore-drill-20261120
   ```
   Pass: the count equals the live count minus the requests that arrived after
   the backup's `snapshotTime`. Optionally open the copy in the Firebase
   console (Firestore, choose the database `restore-drill-20261120`) and check
   that one request you know of, by its reference, is there and readable. Do
   not copy anything out.

6. **Needs Gbenga's yes.** Delete the scratch database. It was created
   without delete protection, so this works directly:
   ```bash
   gcloud firestore databases delete --database=restore-drill-20261120 --project diamondecho-prod
   ```
   Then confirm only `(default)` is left:
   ```bash
   gcloud firestore databases list --project diamondecho-prod --format="value(name)"
   ```

7. **Record** in DE-28 and in this file: the date, the backup's
   `snapshotTime`, the time from step 3 to step 4 (the measured recovery
   time), the two counts, and anything that did not go as written. Never the
   contents of a request.

## A real recovery

What to do if requests are actually lost or damaged. Every step changes
production and **needs Gbenga's yes**; follow
[database-unavailable.md](runbooks/database-unavailable.md) first to make sure
the problem is the data and not Firestore being unreachable.

1. **Stop further harm:** close the form so no new request is lost while the
   data is being restored (`docs/de13-production-setup.md`, "Undo", made safe
   for a service that may be pinned after a rollback), with `VALUE` = `false`:
   ```bash
   bash scripts/sre/cloudrun/status.sh            # note the image of the revision at 100 percent
   curl -sS https://diamondecho-api-180189726732.us-east1.run.app/api/   # note its commit, if it names one
   gcloud run services update diamondecho-api --region us-east1 --project diamondecho-prod \
     --image SERVING_IMAGE --update-env-vars INQUIRY_STAFF_QUEUE_ENABLED=VALUE,APP_COMMIT=SERVING_COMMIT
   bash scripts/sre/cloudrun/status.sh            # the newest revision: SERVING_IMAGE, ready
   ```
   `VALUE` is `false` to close, `true` to reopen. Leave out `APP_COMMIT=…` if
   `/api/` names no commit. Passing the serving revision's image matters: after
   a rollback the service is pinned and its template names the broken image.
   If the newest revision is not at 100 percent (the service was pinned), and
   only then, move the traffic to it:
   ```bash
   gcloud run services update-traffic diamondecho-api --to-latest --project diamondecho-prod --region us-east1
   ```
   Worked when: `status.sh` shows the new revision at 100 percent, and the
   monitor's `inquiry-queue` check fails (closed) or passes (open) on its next
   run.
   The form then answers "unavailable" and stores nothing.
2. **Restore the newest good backup into a new database**, as in drill step 3,
   named for example `restore-20261120`.
3. **Bring the missing requests back into `(default)`.** The API reads only
   `(default)`, and Firestore cannot restore over an existing database. The
   way that keeps every newer request is to export the `inquiries` collection
   from the restored copy and import it into `(default)`. An import adds the
   missing documents and overwrites documents with the same ID with their
   backed-up version; it does not remove anything. It needs a storage bucket
   in `us-east1` that only Gbenga can read (a cost while it exists).
   The commands are `gcloud firestore export gs://BUCKET/restore-20261120 --database=restore-20261120 --collection-ids=inquiries --project diamondecho-prod`
   and then `gcloud firestore import gs://BUCKET/restore-20261120 --database="(default)" --project diamondecho-prod`.
   This path has not been tried; try it on staging first if there is time.
4. **Reopen the form**: the same commands as step 1 with `VALUE` = `true`
   (read `status.sh` again first: the serving image may have changed), then
   check the staff queue shows the restored requests.
5. Delete the restored database and the bucket when the data is confirmed.

Replacing `(default)` outright (switch off delete protection, delete it,
restore into the name `(default)`) loses every request since the backup and
is not recommended.

## Options

Each needs Gbenga's yes.

| Option | What it gives | Cost |
| --- | --- | --- |
| Run the drill above, then once a quarter | A measured recovery time and proof that backups restore | Cents per drill (estimate) |
| Point-in-time recovery | Go back to any minute in the last 7 days; recovery point drops from a day to minutes | Billed by stored size; low for a small database (estimate) |
| Longer backup retention (for example 14 or 30 days) | A problem noticed after a week can still be undone | Billed by stored size per backup |
| A weekly export to a storage bucket | A copy outside the database's own backup system | Bucket storage; another place visitor data lives, which needs the same care |

`gcloud firestore databases update --database="(default)" --enable-pitr --project diamondecho-prod`
switches on point-in-time recovery (needs Gbenga's yes).
