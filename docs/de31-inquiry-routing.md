# DE-31: where a request goes, who is told, and how fast it is answered

Written 2026-10-05 by the Operations agent. Every term in the first table was decided by Gbenga in chat on 2026-10-05 and is recorded on DE-31. This document puts them in one place for his approval. It describes **staging**. Production has none of this yet (see "Repeating this in production").

## The terms

| Term | Decision |
| --- | --- |
| When a request can be sent | At any hour, every day |
| Where a request lands | The staff queue. The queue is the record |
| Who is told | `realtor@diamondecho.com`, by email, when a request is accepted |
| Business hours | Monday to Saturday, 9:00 to 17:00 Eastern |
| Response time | Within 4 business hours |
| Out of hours | The request is accepted and the alert still goes out. The visitor is told on screen that a reply comes in business hours. Answered the next business day; Gbenga may answer sooner |
| Public holidays | Requests are received as on any day. The reply comes when the office is next open |
| Away or closed notices | None. The site never says the office or the responder is away; it is always open for requests |
| Emailed auto-reply to the visitor | None. Gbenga decided against it on 2026-10-05 |
| Backup responder | None at launch |

## How a request travels

1. A visitor sends the buyer, seller or tour form.
2. The request service stores it and answers `201`. The visitor sees "DiamondEcho received your request", a line about business hours (see "What the visitor is told") and a reference. No email is sent to the visitor.
3. Google Cloud sees the `201` in the service's request log and emails the realtor inbox: "a new request is waiting in the queue".
4. The responder opens the staff page, signs in with password and authenticator code, reads the request and presses **Acknowledge**.
5. The responder answers the visitor by the email address or phone number the visitor gave.

The alert email is a prompt. It carries no name, message or contact detail from the form, so the request can only be read in the queue, behind the staff sign-in.

## What the visitor is told

Gbenga asked on 2026-10-05 that requests stay open round the clock and that a visitor who writes outside business hours is told a reply will come in business hours. The wording below is the Operations agent's; it is his to change.

| Where | When | Words |
| --- | --- | --- |
| Under the Submit button | Always | "Requests can be sent at any hour. We reply during business hours: Monday to Saturday, 9:00 AM to 5:00 PM Eastern." |
| On the receipt | Request arrived in business hours | "We reply during business hours: Monday to Saturday, 9:00 AM to 5:00 PM Eastern." |
| On the receipt | Request arrived outside business hours | "Your request arrived outside our business hours. We reply Monday to Saturday, 9:00 AM to 5:00 PM Eastern, and will be in touch once we reopen." |

- Open or closed is judged from the time the request service recorded, read on the office's Eastern clock. The visitor's own clock and time zone play no part.
- The words promise a reply in business hours, not within a number of hours. The 4-business-hour figure is an internal target and is not shown to visitors.
- The hours live in one place, `HOURS` in `frontend/src/lib/contact.js`.
- Public holidays: by Gbenga's decision of 2026-10-05 the site keeps no holiday calendar and no "away" setting. A request is received as on any day and the reply comes when the office is next open. On a holiday inside the usual hours the visitor sees the in-hours line, which names the hours and promises nothing about today.
- This is a notice on the screen, **not an email**. A visitor who closes the page has no copy of it. See item 4 under "Not proven, and open".

## The responder's routine

Proposed by the Operations agent to make the terms above workable. It becomes the routine when Gbenga approves this document.

- **On each alert email:** open the queue.
- **At 9:00 on each business day:** open the queue whether or not an email came. This is the safety net; see "When the alert does not ring".
- **Acknowledge** means "I have read this and I am answering it". Press it when you take the request, not after you have answered.
- **Answer within 4 business hours** of the "Submitted" time shown on the request. The staff page shows that time, and a requested tour time, in Eastern time with the zone named (for example "Mon, Oct 5, 2026, 12:45 PM EDT"), whatever clock the device keeps. Before the pull request that added this document it showed them in UTC, four or five hours ahead of Eastern, which would have misled both the response clock and a tour appointment.

## What "4 business hours" means

The clock runs only inside business hours. This is the Operations agent's reading of the two decisions above, set out so that it can be approved or corrected.

| Request arrives | Answer is due by |
| --- | --- |
| Tuesday 10:00 | Tuesday 14:00 |
| Tuesday 15:30 | Wednesday 11:30 (1.5 hours on Tuesday, 2.5 on Wednesday) |
| Saturday 16:00 | Monday 12:00 (1 hour on Saturday, 3 on Monday) |
| Sunday, any time | Monday 13:00 |
| Any day after 17:00 | 13:00 on the next business day |

Public holidays and days when the responder is away are not counted or announced by the site. The examples above assume an ordinary week; on such a day the reply comes when the office is next open.

## The alert on staging

Two objects in Google Cloud project `diamondecho-staging`, created 2026-10-05 from Cloud Shell under Gbenga's sign-in, after his "Yes, all three" to the listed changes.

| Object | Detail |
| --- | --- |
| Notification channel | Email, enabled, named "DiamondEcho request alerts", to `realtor@diamondecho.com` |
| Alerting policy | "DiamondEcho staging: new request received", a log-match policy, enabled |

There is no code change, no secret, no DNS record and no new permission for the service's own account.

### The policy

```json
{
  "displayName": "DiamondEcho staging: new request received",
  "documentation": {
    "subject": "DiamondEcho staging: a new request is waiting in the queue",
    "mimeType": "text/markdown",
    "content": "A visitor request was accepted by the DiamondEcho staging service and is waiting in the staff queue.\n\nOpen the queue, sign in, read it and acknowledge it: https://diamondecho-staff-staging.pages.dev\n\nThis email is a prompt only. It is sent at most once every 5 minutes and at most 20 times a day, so one email can stand for several requests. The queue is the record."
  },
  "conditions": [
    {
      "displayName": "Request accepted (201) on POST /api/v1/inquiries",
      "conditionMatchedLog": {
        "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"diamondecho-api-staging\" AND logName=\"projects/diamondecho-staging/logs/run.googleapis.com%2Frequests\" AND httpRequest.requestMethod=\"POST\" AND httpRequest.status=201 AND httpRequest.requestUrl:\"/api/v1/inquiries\""
      }
    }
  ],
  "combiner": "OR",
  "enabled": true,
  "alertStrategy": {
    "notificationRateLimit": { "period": "300s" },
    "autoClose": "1800s"
  },
  "notificationChannels": ["CHANNEL_NAME_FROM_THE_FIRST_COMMAND"]
}
```

Only a stored request rings. A repeat of the same submission (`200`), a conflict (`409`), a refusal (`422`, `429`, `503`) and every staff action do not match.

### Commands as used

```bash
gcloud beta monitoring channels create --project diamondecho-staging \
  --display-name="DiamondEcho request alerts" \
  --description="Email sent when a visitor request is accepted" \
  --type=email --channel-labels=email_address=realtor@diamondecho.com \
  --quiet --format='value(name)'

# Put the name printed above into the policy file, then:
gcloud monitoring policies create --project diamondecho-staging \
  --policy-from-file=policy.json --quiet --format='value(name)'
```

To check the filter without changing anything, count the log lines it matches and compare with the number of stored requests:

```bash
gcloud logging read "PASTE_THE_FILTER" --project diamondecho-staging \
  --freshness=2d --limit 50 --quiet --format='value(timestamp)' | wc -l
```

### Cost

Nothing today. Google's pricing page says alerting will be charged "no sooner than September 1, 2027", at $0.35 a month for each alerting policy condition. This policy has one condition. Gbenga was told this figure before he approved.

## Test (2026-10-05)

| Time (UTC) | Event | Result |
| --- | --- | --- |
| before | Filter checked read-only | Matched 6 log lines; the database held the same 6 synthetic requests |
| 16:39:06 | Policy created | Listed as enabled |
| 16:39:37 | Synthetic request 1 | Answered `201`. **No alert**, checked three times over four minutes and on the console |
| 16:45:19 | Synthetic request 2 | Answered `201` |
| 16:45:49 | Alert opened | 30 seconds after the request |
| later | Email | Gbenga reported it received, from Google Cloud alerting, with a "View Incident" link |
| 20:48 | A request sent by Gbenga through the staging form | Alert email received; he sent a picture of it. Its start time reads "Oct 5, 2026 at 8:48PM UTC" |

Approval was for one synthetic request. A second was sent because the first proved nothing; this was reported to Gbenga and recorded on DE-31.

## What the alert email contains

Read from the picture of a real alert email that Gbenga sent on 2026-10-05, for a request he had made through the staging form. From the top of the email to the end of the policy wording, it shows:

| Part | Content |
| --- | --- |
| Notice | "This is an automated notification set up by a Google Cloud user, not an official message from Google." |
| Banner | "Log alert fired", "No severity", and "Cloud Run Revision with a log matching the query has appeared" |
| Start time | The moment the request was accepted, in UTC |
| Policy, project, condition | The names given in "The policy" above |
| Labels | `configuration_name`, `location`, `project_id`, `revision_name`, `service_name`. All describe the service, none the visitor |
| Policy documentation | The wording written for the policy, with the link to the staff page |

- **No visitor detail appears in that part:** no IP address, no browser string, no web address of the request, nothing from the form.
- The only web address in it is the link to the staff sign-in page.
- The banner is red and reads like a fault. It is not one: for this policy "Log alert fired" means a request has arrived.
- Limit: the picture stops at the end of the policy wording. Anything Google places below that was not seen.

## When the alert does not ring

The alert can miss a request. The 9:00 look at the queue is what catches it.

| Cause | What happens | Source |
| --- | --- | --- |
| Several requests within 5 minutes | One email for all of them | Google's limit; not driven here |
| More than 20 alerts in a day | No email for the rest of that day | Google's limit; not driven here |
| A request soon after the policy is created or changed | No email | Seen in the test above. Google documents no figure for the delay |
| The email is filtered as spam or the mailbox is full | No email reaches the responder | Not tested |
| The policy or channel is disabled or deleted | No email | Not tested |
| The request service is down or the queue is off | The visitor is told the request was not confirmed; nothing is stored and there is nothing to alert on | Refusal tested in DE-33 |

To see what is waiting, sign in to the staff page: every request that still shows an **Acknowledge** button has not been taken.

## Not proven, and open

1. **Whether the email shows a visitor's IP address or a raw log line: it does not, in the part of the email that has been seen.** See "What the alert email contains". The picture Gbenga sent ends at the policy wording; whatever follows it (he earlier mentioned a "View Incident" link) was not in the picture.
2. **Production.** Nothing in this document exists there.
3. **The two Google limits** in the table above were read from Google's documentation, not driven.
4. **No acknowledgement email goes to the visitor, by decision.** The receipt on screen, with its business-hours line, is the only confirmation they get. Gbenga decided on 2026-10-05 that no emailed auto-reply is wanted, so no mail provider, key or DNS record is needed.
5. **The site does not know public holidays or absences, by decision.** Nothing on it changes on such a day.
6. **How long requests are kept**, and who deletes them, is not decided (DE-26).
7. **Nothing measures the response time.** The queue shows when a request arrived and whether it has been acknowledged. It does not show when it was acknowledged, and whether the visitor was answered within 4 business hours is not recorded anywhere.
8. **The business-hours wording has been used on staging by Gbenga** (2026-10-05, a request sent at 4:48 PM Eastern on a Monday; he reported the receipt as working). The out-of-hours line has been seen only in the repository's tests and in headless Chromium, not on staging.
9. **The Eastern-time display has been seen on the deployed staff page.** Gbenga's screenshot of 2026-10-05 shows "Submitted: Mon, Oct 5, 2026, 4:48 PM EDT" for a request he had just sent; the alert email for the same request gives its start as 8:48 PM UTC, the same moment.

## Repeating this in production

Each step is a change to a Google Cloud project and needs Gbenga's yes at the time.

1. Create the email channel in the production project.
2. Create the policy from the file above with three things changed: the project in `logName`, the Cloud Run service name, and the staff page address and the word "staging" in the wording.
3. Wait at least five minutes.
4. Send one synthetic request through the site's own form and confirm the email arrives.
5. Read that email in full, to the bottom, and compare it with "What the alert email contains". Production carries real visitors, so confirm again that no visitor detail appears.
6. Acknowledge the synthetic request in the queue so it is not mistaken for a visitor.

Done on 2026-10-05, with one difference from step 4: the synthetic request was sent from Cloud Shell, not through the site's form. The alert opened 57 seconds after it; Gbenga received the email and acknowledged the request in the production queue the next day. Times, names and what is still unproven are in `docs/de13-production-setup.md`, section 4.

## Undo

On the Alerting page of project `diamondecho-staging`, disable or delete the policy, then the channel. Nothing else depends on them. Requests continue to reach the queue.

## Sources

- Google Cloud, "Configure log-based alerting policies"
- Google Cloud, "Cloud Monitoring quotas and limits" (20 notifications a day; 5 minutes between notifications)
- Google Cloud, "Google Cloud Observability pricing" (alerting charges and their start date)
- Google Cloud, "Create and manage notification channels"
