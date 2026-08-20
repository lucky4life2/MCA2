# Frontend & Mobile Test Plan — Congress Module

The pgTAP suite (`congress_voting.pgtap.sql`) proves the database will
never accept an illegal state. This plan covers what only runs in the
browser: does the UI actually call the right RPC, render the result
correctly, and stay usable on a phone. These are written as a
Playwright test outline (structure + assertions), not runnable code —
standing up Playwright, seed users, and auth tokens is real setup work
that belongs in its own follow-up task, not squeezed into this pass.

## Why this file is an outline, not executable code

`congress.html` is a single 78K inline-script page with no build step
and no existing frontend test harness in the repo. Writing genuine
Playwright specs against it means: standing up a `playwright.config.ts`,
seeding auth users via the Supabase Admin API, wiring a `.env.test`
against a branch DB, and running headless Chromium — none of which can
be verified without a live environment. Below is what those specs
should assert, precise enough to implement directly, so nothing is
lost in translation for whoever wires up the harness.

## 1. Discussion input sanitization (render-time)

The DB round-trips debate post bodies unescaped by design (see the
pgTAP suite, section 13) — `congress.html`'s `esc()` (line 323) is the
only thing standing between a stored `<script>` payload and it firing.

- [ ] Post a debate reply containing `<img src=x onerror=alert(1)>`.
      Assert `document.querySelector('[data-post-body]').innerHTML`
      contains the HTML-escaped entities (`&lt;img ...`), not a live
      `<img>` tag, and assert no `alert` dialog fires.
- [ ] Same for a reply body containing `<script>`.
- [ ] Repeat for the **edit** path (line 1160,
      `<textarea>${esc(post.body)}</textarea>`) — confirm the textarea
      shows the raw escaped text back to the *author* for editing
      (correct: textareas render text content safely regardless) while
      the read-only rendered view above it stays escaped.

## 2. Vote submission UI

- [ ] As an eligible member, open a live roll call, select "Yea",
      submit. Assert the UI reflects the recorded choice without a
      full page reload and that the vote button becomes a "change
      your vote" affordance (or is disabled, per `allow_vote_changes`).
- [ ] As an ineligible member (no chamber seat), assert the vote UI is
      either hidden or renders a clear, non-generic reason ("You are
      not eligible to vote on this question") rather than a raw
      Postgres/PostgREST error string leaking to the user.
- [ ] Attempt a vote via `fetch()` directly against the roll-call RPC
      while logged out (no session) — assert a 401/permission error,
      not a silently-accepted anonymous vote. (This exercises the
      real anon-role RLS boundary flagged in the security advisor
      output — see the final report's "Remaining risks.")

## 3. Quorum / threshold display

- [ ] Load a certified roll call and assert the displayed tally
      (yea/nay/present/abstain counts, quorum met/not met, threshold
      met/not met) matches `congress_roll_call_tally()`'s output
      exactly — this is a good target for a snapshot test seeded from
      the same fixture data as the pgTAP suite's section 7.

## 4. Loading / validation / success feedback states

- [ ] Submitting a vote shows a loading indicator on the button
      (disabled + spinner or text change) for the duration of the
      RPC call, and the button is not double-clickable (would
      otherwise rely entirely on the DB's uniqueness constraint,
      which is correct-but-unfriendly — the user should see a fast
      "already submitted" state, not wait for a rejected request).
- [ ] A failed vote (e.g. closed roll call) shows a visible,
      non-color-only error message near the vote control, using
      `role="alert"` or `aria-live="assertive"` so screen readers
      announce it immediately — check the DOM for this attribute
      pattern on whatever container congress.html uses for inline
      errors (currently no consistent pattern found — see report).

## 5. Critical mobile workflows

Viewport: 375×667 (iPhone SE) and 390×844 (iPhone 14), Playwright's
built-in device presets, both light and dark mode (nav.js reads
`localStorage.mca_theme`).

- [ ] Congress landing page → measure list → measure detail → cast a
      vote, entirely by tap, with no horizontal scrolling required at
      any step.
- [ ] The nav's Community/About dropdown (nav.js, `nav-has-dropdown`)
      opens and closes correctly by tap, not just hover — hover-only
      dropdowns are a common mobile-breakage pattern; confirm the
      existing dropdown JS uses click/tap handlers, not CSS `:hover`.
- [ ] Debate thread reply composer stays usable with the on-screen
      keyboard open (textarea doesn't get hidden behind the keyboard;
      submit button remains reachable).
- [ ] The admin product-image modal (fixed in this pass — see report)
      is dismissible by tap on the ✕ and doesn't trap focus once
      closed.

## 6. Accessibility (automated portion)

Run `axe-core` (via `@axe-core/playwright`) against `congress.html`,
`admin.html`, and `index.html` in both the "logged out" and "logged
in as congress_member" states, and fail the build on any `critical` or
`serious` violation. This will catch classes of issue a manual pass
can miss at this codebase's size (220KB `admin.html`) — in particular
icon-only buttons and dynamically-injected modals that weren't part of
the manual sample checked in this pass (see "Remaining risks").
