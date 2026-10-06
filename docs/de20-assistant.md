# DE-20: the Ask DiamondEcho assistant

What the assistant does after this change, how each acceptance criterion was
checked, and what is left for Gbenga. The assistant is still a fixed set of
written answers chosen by word matching. No language model is called, nothing
is stored, and it does no arithmetic and quotes no rates.

## The six criteria

| Criterion | What was wrong | What happens now | Where it is tested |
| --- | --- | --- | --- |
| Buyer quick prompt gets buyer guidance | "Help me plan a home purchase" matched no topic ("purchase" was not a buyer word) and got the opening menu. "Analyze a rental property" got tenant advice | Topics are matched as whole words, with "purchase" and "analyze" among them. The three buttons get the buyer, deal-analysis and loan answers | `test_assistant_conversation.py`, first three tests |
| Seller location follow-up continues the conversation | The answer asked "is this a primary home, rental, or commercial property, and where is it located?" The reply "A primary home in Atlanta, Georgia" named no topic, so the opening menu came back. The question itself was never shown in the panel | A reply that names no topic of its own is read against the last question. The state is read from the reply, kept for later questions, and filled into the panel's state box | `test_a_sellers_reply_…`, `test_the_state_is_remembered_…`; panel test "the reply is sent with the conversation so far" |
| Dates match source metadata | The panel printed "Sources · reviewed" followed by today's date | Each source shows its publisher and its own review date from the catalogue | `test_citation_numbers_…`; panel test "a source shows its own review date" |
| Human handoff reaches approved intake | The service set a flag; the panel showed nothing | Answers that call for a person carry a link to the request form (`/inquire`), buyer, seller or tour. That form is the only way details reach the staff queue. The chat is not sent with it, and the panel says so | `test_asking_for_a_person_…`; panel test "the way to a person opens the request form" |
| Service errors recover | One notice, no way forward but retyping | The notice says the question was not lost and offers "Try again", which asks the same question again, and the request form. The failed notice is never sent back as conversation | panel tests under "when the service does not answer" |
| Safety paraphrases are handled with neutral reframing | Two short word lists: "families with children" was caught, "families with kids" was not (DE-25 finding F7) | Any message that mentions a protected characteristic and is about choosing a place, or choosing who gets housing, is turned towards neutral criteria. Requests to rate a place ("safe", "good schools", crime) are pointed to published figures | `test_assistant_safety.py`, 42 phrasings |

Also from DE-25 finding F7: a Georgia closing-cost question got the loan
comparison answer. It now gets a closing-cost answer that cites the CFPB and,
for Georgia only, the Department of Revenue's transfer tax page.

## How a message is read

1. **Safety first** (`backend/ai/safety.py`). Card, account and Social Security
   numbers are refused. Then fair housing, described below.
2. **A person** (`intent.wants_human`): "talk to an agent", "call me", "a
   human". The answer explains the request form and links to it.
3. **Thanks**: answered as thanks.
4. **Topic** (`backend/ai/intent.py`), first match wins: deal analysis, closing
   costs, loans, selling, renting, buying. Whole words only: "current" is not
   "rent", "lawn" is not "law".
5. **A reply**. If the message has no topic once words such as "rental",
   "commercial", "home" and "land" are set aside, and an earlier message had
   one, the earlier topic continues. That is how "It is a rental in Tampa, FL"
   stays a selling conversation instead of becoming a renting one.
6. **Details**: the state (a name, or a code written as "Atlanta, GA" or "in
   GA"), the kind of property, the kind of deal.

The page sends the last eight messages with each question. The service keeps
nothing between requests.

## Fair housing

The check is deliberately broad. It asks two things: does the message mention a
protected characteristic (race, colour, religion, sex, disability, families and
children, national origin, and the usual stand-ins such as "people like me"),
and is it about choosing a place to live or choosing a tenant or buyer? If
both, the visitor is told what the assistant can compare instead. Someone
choosing a tenant is also told to use the same written criteria for every
applicant.

Colour and nationality words count only beside a word for people or a place,
so "white kitchen" and "Indian restaurant" pass. "My kids need their own rooms"
passes; "best neighborhood for my kids" does not.

A request to rate a place is treated the same way, because "safe" and "good"
so often stand in for who lives there. "Is Norcross safe?" is told apart from
"Is asbestos dangerous?" only by the capital letter of the place name, so
"is norcross safe" in lower case is not caught. Nothing harmful follows: the
assistant has no answer that rates a place.

**This is still word matching.** A determined or simply unusual phrasing will
get past it. What makes that tolerable is that there is no answer in the
assistant that recommends or rates a neighbourhood, so a miss produces a
general answer, not a steering one.

## What an answer may contain

- **Sources**, numbered in the order the text mentions them, each with its own
  review date. A new one was added: Georgia Department of Revenue, "Real Estate
  Transfer Tax", read on 2026-10-06. The other eight keep 2026-07-09, the date
  already in the catalogue; they were not re-read for this change.
- **Links to this site only**: Deal Studio, the Mortgage Simulator, the Seller
  Net Sheet, the Georgia MLS search and its rental search. The panel refuses any
  path that is not on this site.
- **The request form**, when a person is the right next step.

## Statements about DiamondEcho that the answers now make

These are new sentences a visitor can read. They follow what the site already
says, but they are Gbenga's to approve or change:

1. "DiamondEcho’s office is in Georgia, so for a property in [state] the right
   person is an agent licensed there." No request link is offered for a property
   outside Georgia.
2. "DiamondEcho is not a lender; send a pre-approval request and an agent can
   introduce you to one." (The wording of the pre-approval page, DE-40.)
3. "You can reach a DiamondEcho agent with the request form on this site. It
   goes to the staff queue, and a team member can follow up using the contact
   details you give."
4. The two fair-housing replies, in `backend/ai/safety.py`. They state the
   federal protected classes and say DiamondEcho does not sort housing that
   way. The broker may want to read them.

## Going live

Two halves, and they do not have to arrive together:

- **The panel** (source dates, shown questions, links, request link, Try again)
  goes live when the pull request is merged. It works with the service as
  deployed today: sources already carry their review dates, and an answer
  flagged for a person gets the buyer request form.
- **The service** (topics, continued conversations, closing costs, the new
  fair-housing check) goes live only when the API is redeployed, which needs
  Gbenga's yes. Until then production keeps the old answers.

## Checked in a browser

Chromium, 1280 px and 390 px wide, the built site against a local copy of the
service: the buyer button, a selling question, the reply "A primary home in
Atlanta, Georgia" (state box filled with GA; net sheet and seller request
offered; two sources with their own dates), a schools question (reframed), a
closing-cost question with the connection cut (notice, Try again, the same
question answered once), "Can I talk to an agent?" (seller request link,
opened by keyboard, lands on the seller form, panel closed). Nothing in the
panel is wider than the panel and the page does not scroll sideways.

On a phone the panel's title and Close button used to sit under the site
header. The panel is now shorter by the height of the header.

## Not done

- No real phone, Safari, Firefox or screen reader.
- Not checked on a deployed service; previews have no service address, so the
  assistant is not offered there at all.
- State sources. Only Georgia's transfer tax has a reviewed source. For any
  other state, and for Georgia landlord and tenant law, the answer says it has
  no reviewed source and gives no figure.
- A request sent from the chat itself. By design the visitor opens the form.
