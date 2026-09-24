# DiamondEcho Sprint 1 delivery plan

Source: [DiamondEcho main](https://github.com/Ggeorge73/DiamondEcho/tree/902af81f818245eae93f2575df64c43a0afbc23e) at `902af81f818245eae93f2575df64c43a0afbc23e`. Jira: DE board 34, active sprint 36, **DE S1 - Stabilize** (ends September 29, 2026). This plan records the agent team and sequencing; it is not a claim of human staffing or confirmed capacity.

## Team and responsibilities

The DiamondEcho Launch Train uses these named teams. The agents below have been instantiated and given the indicated discovery assignments. Implementation assignments describe the next work types, subject to the stop and permission gate after each type.

| Team | Agent / SAFe role | Assigned Sprint 1 work |
| --- | --- | --- |
| North Star | `/root` — Product Manager, Product Owner, and train coordinator | Order work, maintain acceptance and release scope, bring decisions to Gbenga, coordinate Jira updates and end-of-type reports. Gbenga is the human business and release approver. |
| Sprint Compass | `/root/team_coach` — Scrum Master / Team Coach | Facilitate scope and capacity review, track dependencies and blockers, keep Jira evidence current after verified tasks, enforce Definition of Done, and run each permission gate. Own coordination of DE-24. |
| Foundation | `/root/solution_architect` — System Architect | Own architecture and integration design, review contracts across React/FastAPI/MongoDB, review DE-7 and DE-9 technical changes, and flag deployment dependencies. |
| Release Rail | `/root/quality_lead` — Quality Engineering and DevOps lead | Establish clean-checkout baseline, own DE-7 CI remediation and test gates, independently verify each issue and record build/environment evidence. |
| Deal Studio | `/root/frontend_lead` — Frontend engineering lead | Implement DE-8 then DE-10 (calculator safety and stale results), and DE-11 then DE-12 (listing context and autofill provenance), with regression evidence. |
| Lead Journey | `/root/backend_lead` — Backend engineering lead | Design and implement DE-9 intake API, durable persistence, idempotency, approved-recipient routing, failure handling, and backend tests after DE-6 scope approval. |
| Experience | `/root/experience_lead` — UX, content, and accessibility lead | Resolve DE-6 portal/seller claims with owner-approved scope; specify DE-9 buyer, seller, and tour paths, truthful confirmations, mobile and keyboard acceptance. |

Agents are implementation support, not Jira user accounts. **Gbenga is the human owner for all approvals and permissions, including reviewing team-created pull requests and merging them.** Adeoba is the Engineering owner, Tiara is the QA owner, and Lara is the Operations owner. Agents may prepare changes and review evidence, but they do not approve or merge on Gbenga's behalf. These named roles do not establish each person's availability, capacity, or Jira account access. Until those are confirmed, target dates remain planning targets and issue-level assignment remains open.

| Human owner | Accountability in Sprint 1 |
| --- | --- |
| Gbenga | Product and release decisions, permissions, PR review and merge approval. |
| Adeoba | Engineering execution ownership, technical estimates and implementation review. |
| Tiara | QA execution ownership, test strategy and acceptance evidence review. |
| Lara | Operations execution ownership, lead recipient/routing decision, support and deployment readiness. |

## Ordered types of work and permission gates

1. **Team mobilization and source baseline** — form the cross-functional agent team, verify the repository and Sprint 1 backlog, assign work streams, record dependencies and the current CI baseline. Stop and report. This type is complete when the team plan and Jira mobilization note are recorded; it does not close DE-24.
2. **Launch scope and accountable ownership** — obtain Gbenga's brokerage/inquiry versus authenticated-marketplace decision for DE-6; align public portal and seller claims with that decision. Confirm the named owners' availability, Jira access, recipient, capacity, estimates and escalation path for DE-24. Verify before closing either issue. Stop and report.
3. **Clean build and CI** — fix DE-7 from a clean checkout; require frontend install, frontend and backend tests, and production build in GitHub Actions. Stop and report.
4. **Critical site correctness** — fix DE-8's blank-screen strategy crash and DE-11's wrong-property context. These independent, high-impact defects have no product-scope dependency. Stop and report.
5. **Buyer, seller, and tour intake** — implement DE-9 after DE-6. Verify each request is persisted once, routed to the approved recipient, and accurately confirmed; test failures, mobile, keyboard and cleanup. Stop and report.
6. **Dependent calculator and property safeguards** — fix DE-10 after DE-8 and DE-12 after DE-11. Verify invalid/stale results and exports, and prevent prior-property assumptions from becoming new-property facts. Stop and report.

Within Type 4, the crash and listing-context streams can proceed in parallel when authorized. DE-9 is brought forward after its scope dependency because it is a Highest-priority missing customer journey and has substantial integration work. The user has asked for permission between types, so no later type begins automatically. Jira moves to Done only after issue-specific acceptance evidence and a named reviewer acceptance are recorded.

## Mobilization findings and open decisions

- All eight Sprint 1 issues (DE-6 through DE-12 and DE-24) were To Do and unassigned at baseline. DE-6 blocks DE-9; DE-8 blocks DE-10; DE-11 blocks DE-12.
- GitHub `main` is `902af81f818245eae93f2575df64c43a0afbc23e`. The current task branch `codex/de-sprint-1` starts there. A separate older local checkout exists, but this plan uses the confirmed GitHub source.
- Latest cited main CI run `33341391880` failed at frontend `npm ci`; backend tests passed, while frontend tests and build did not run. DE-7 requires a clean checkout reproduction and a green workflow after remediation.
- The website calls a public search link a “Client portal”; there is no account portal route. The tour button is inactive. The site has no on-site buyer/seller/tour request persistence or backend delivery route. DE-6 needs the site owner's scope decision and DE-9 needs an approved recipient and operations owner.
- Gbenga, Adeoba, Tiara and Lara now have named human roles. Their availability, engineering/QA/operations capacity, operational mailbox ownership, estimates and real Jira assignees remain DE-24 blockers to resolve in Type 2. A Jira account lookup for Adeoba, Tiara and Lara returned no matching assignable users, so issues were not assigned by guesswork.

## Audit traceability and learning reports

The Sprint 1 backlog cites the September 22 launch-readiness audit. The source audit file has not been located in the confirmed repository or connected Drive; Jira issue descriptions currently provide the audit register references and acceptance criteria. We will verify against the source file if Gbenga supplies it. The planned code work maps to the audit as follows:

| Audit finding | Jira issue | Direct site outcome when implemented and verified |
| --- | --- | --- |
| REL-01 | DE-24 | Accountable owners, capacity and release risk are visible; this is a delivery control, not a site code change. |
| DE-18 | DE-6 | Portal and seller promises match the approved launch capability. |
| DE-03 | DE-7 | Clean installation, automated tests and production build run in CI. |
| DE-02 | DE-8 | Switching calculator strategies after simulation no longer blanks the site. |
| DE-01 | DE-9 | Buyer, seller and tour requests persist and reach the approved recipient. |
| DE-08 | DE-10 | Invalid calculator inputs are rejected and changed inputs mark results stale. |
| DE-07 | DE-11 | A listing opens Deal Studio with that listing's correct identity and values. |
| DE-09 | DE-12 | Autofill does not carry another property's financial assumptions as facts. |

Type 1 created the team and source baseline only; it did **not** change the website or close an audit finding. For every later completed task, the end-of-type report will teach the technical project management reasoning in this order: **audit finding and user impact; decision/dependency; implementation and files; test and production/CI evidence; Jira status; residual risk; Gbenga's requested approval.** A green test alone will not stand in for user-journey evidence, and a prepared pull request will not be described as shipped until Gbenga reviews and merges it and the target environment is verified.

## Type 2 scope decision and capacity forecast

Gbenga approved a public brokerage and inquiry site for the October launch. Public browsing and buyer, seller-consultation, and tour-request paths are in scope. Authenticated accounts, a private client portal, and self-service seller listing tools are outside this approved launch scope. DE-6 must remove misleading portal claims; DE-9 must deliver real intake before the site claims those requests work. A tour request is not a booking confirmation.

At Gbenga's request, the following are provisional planning allocations for the four business days September 24, 25, 28, and 29; they are not a statement of each person's confirmed availability.

| Owner | Provisional allocation | Planning use |
| --- | --- | --- |
| Adeoba, Engineering | 24 hours | Technical decisions, implementation review, and integration. |
| Tiara, QA | 16 hours | Acceptance tests, regression evidence, and defect triage. |
| Lara, Operations | 8 hours | Intake destination, response process, deployment, and support review. |

Preliminary engineering effort across DE-6 through DE-12 is about 10.5–20 person-days, plus 3–5 QA person-days, before recipient/provider and hosting setup. The full eight-issue sprint is at risk against those allocations. Agent implementation helps, but does not prove human review capacity. All issues remain visible; any scope or date change requires Gbenga's decision rather than silent deferral.

Gbenga owns scope and release approval; Adeoba owns engineering execution; Tiara owns QA verification; Lara owns intake operations. Jira lookup found no matching assignable accounts for Adeoba, Tiara, or Lara, so issue assignees remain unset with an explicit access blocker. Lara is the intended operational recipient owner, but the actual monitored destination and delivery provider are unverified. DE-9 needs a real destination, production API and MongoDB, and evidence of recipient receipt before it can pass acceptance.
