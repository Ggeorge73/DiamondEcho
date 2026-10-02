# DE-19 / audit DE-13: mobile navigation

The launch audit found that the menu's lower items could be obscured and that
Escape did not dismiss it. This fix gives the menu one scrollable surface at
desktop and mobile widths instead of independently scrolling columns. It opens
as a labeled modal dialog, moves focus to its close button, keeps Tab inside,
  closes on Escape or the button, and returns focus to the menu opener. Route
  links still navigate to their original targets. The concierge menu action
  now moves focus into the opened assistant rather than losing keyboard focus.

## Evidence

- Frontend suite: 61 tests passed, including new menu focus, keyboard,
  concierge handoff and navigation regressions.
- Production frontend build passed.
- Local Chromium smoke at 320×568, 390×844, 768×750 and 1280×720: last primary
  and secondary actions reachable, no horizontal menu overflow, Escape closes
  and returns focus. At the first three widths, the menu scrolls as intended.

These are implementation checks, not Tiara's release-candidate acceptance.
Tiara should repeat on the exact deployed build in supported browsers,
including keyboard-only and screen-reader checks, and attach build/URL,
device, browser and results to DE-19. Leave DE-19 In Progress until a named
reviewer accepts that evidence.

## Technical Project Manager note

The CSS issue and keyboard issue were related: an overlay that clips controls
can also trap a visitor without a reliable way to leave it. A unit test checks
the focus contract; a real viewport check tests reachability. Both are needed.
This fixes the host menu only; it does not resolve the separate Georgia MLS
IDX blocker, DE-32, or prove the provider's embedded controls work.
