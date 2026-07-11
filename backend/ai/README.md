# DiamondEcho Property Intelligence MVP

This package is the safe, auditable boundary for DiamondEcho's real-estate assistant.

## What the MVP does

- answers common buying, selling, renting, mortgage, tax, and investment questions;
- attaches authoritative citations to regulated-topic answers;
- requests a state/locality before making jurisdiction-sensitive claims;
- blocks protected-class housing steering and common sensitive credentials;
- routes deal arithmetic to deterministic mortgage, rental, fix-and-flip, and commercial calculators;
- marks estimates, professional-review needs, and handoff recommendations in structured API fields.

It intentionally does not quote live rates, claim MLS access, approve credit, value a property, draft a binding legal instrument, or replace a broker, appraiser, lender, attorney, or tax adviser.

## Integration

The root FastAPI module must include the router inside its existing `/api` router:

```python
from routes.assistant import router as assistant_router

api_router.include_router(assistant_router)
```

The React app shell can mount the floating assistant once, after the router content:

```jsx
import RealEstateAssistant from "./components/assistant/RealEstateAssistant";

<RealEstateAssistant />
```

The component uses the existing `REACT_APP_BACKEND_URL` and calls:

- `POST /api/assistant/chat`
- `POST /api/assistant/analyze`
- `GET /api/assistant/health`

## Production extension points

1. Replace the deterministic answer composer with a provider adapter that can only answer from the retrieved context and calculator tool results.
2. Store sources with publisher, URL, jurisdiction, effective/review dates, topic, license, and content hash. Add expiry policies and scheduled review.
3. Add state and locality primary sources (legislatures, regulators, courts where appropriate, recorder/assessor and zoning authorities) before enabling local-law answers.
4. Add licensed MLS/listing data only under the applicable data license; label listing facts separately from estimates.
5. Add consent-gated CRM handoff. Send only the user-approved contact fields and a concise purpose summary, with retention and deletion controls.
6. Add authentication, rate limiting, encrypted persistence, audit events, prompt-injection defenses for uploads, observability, and an incident kill switch.

## Required evaluation gates

- calculator golden tests and boundary/property tests;
- citation entailment, authority, freshness, and jurisdiction coverage;
- fair-housing steering and protected-class proxy tests;
- sensitive-data leakage and prompt-injection tests;
- legal/tax/mortgage escalation and missing-jurisdiction tests;
- hallucinated listing/rate/source tests;
- accessibility, mobile, latency, load, and graceful-failure tests.
