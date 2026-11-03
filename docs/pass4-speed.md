# Pass 4 — speed checklists (load-time reel + 31-tip reel)

Branch: `compliance-20-2026-11-02`. Unmerged, no PR. No live DB writes, DNS
changes, emails, posts, deletions, load tests, or monitoring subscriptions.
No live browser run was done in this pass; everything below is code inspection
of the branch. Deduplicated against passes 1–3: items already covered there are
marked ALREADY-OK and were not redone.

## Done in code (this commit)

- `news.js` — banner-only pages (every page except news.html, which has the
  index) now run a featured-only query instead of fetching every published
  article, and skip the coauthor round-trip there. The news index query is
  unchanged. This also removes the need to strip `news.js` from login.html:
  login's banner fetch is now featured-only, and the banner still appears.
- `nav.js` + `index.page.js` + `index.html` — the homepage reuses nav's
  `site_config` fetch (`window._siteConfig`, set before nav's config-ready
  promise resolves) instead of fetching the same row a second time. Falls back
  to its own fetch when nav hasn't loaded or nav's fetch came back empty, so
  stats keep their hardcoded fallbacks in every failure path. `index.page.js`
  changed from classic to module script so it runs after nav's module.
- `supabase.js` — `hasPermission()` dedupes only concurrent identical RPCs
  (in-flight map, deleted in `finally`). No time-based memo: a cached
  permission could outlive a demotion or a role-preview change.
- `stocks.page.js` — the six company-page reads now run via one
  `Promise.all` instead of six sequential round trips. Values identical.
- `leadership.page.js` — the club-presidents fetch starts before the
  leadership fetch and is awaited in its own try block, so the two run in
  parallel with error handling preserved.
- `slideshow.js` — warms the cache for slides 2+ after parsing (they are
  `display:none` with `loading="lazy"`, so the first auto-advance could
  otherwise show a blank slide). No DOM or timing changes.
- `index.html` — `decoding="async"` on the two lazy below-fold images.
- `shop.page.js` — `loading="lazy" decoding="async"` on product-card and
  cart-item images; `decoding="async"` on the detail-modal main image.
- `account.html` — QR library (`vendor/qrcode.min.js`) is now `defer`; it is
  only used inside a 2FA click handler, never at load.
- `_headers` — every served JS file now has the same 300s
  `max-age=300, must-revalidate` tier as `style.css`/`nav.js` (unhashed
  files, so nothing is `immutable`). `sw.js`/`manifest.json` stay `no-cache`.
- Timeouts added (all inside existing try/catch): `nav.js` site_config and
  site-lock sign-in portal (15s), `index.page.js` fallback fetch (15s),
  `login.page.js` sign-in fetch (15s), `leadership.page.js` both fetches
  (15s), `history.page.js` (15s), `server-status.js` mcstatus.io poll (8s).
  Pass 3's checkout/billing 15s timeouts were already in place, not redone.

## Already OK (verified, not changed)

- Per-page module scripts (code splitting); Turnstile `async defer`;
  `esm.sh` Supabase pinned at 2.112.4; no Stripe.js (redirect checkout).
- Fonts: Google Fonts Open Sans with `display=swap` + both preconnects,
  no `@import`. (Adding weight 700 was considered and skipped: it would add
  a font download on many pages for a rendering nicety, not speed.)
- Loading states everywhere (spinners/text, never blank); no true skeleton
  shimmer anywhere — building one would be new UI, not a minimal edit.
- All live `<img>` tags carry width/height; slideshow/cart/detail image
  heights are CSS-fixed; nav is `position:fixed`, so late nav/footer
  injection does not push content.
- Search inputs filter client-side (news, stocks, archive, admin); no
  per-keystroke network calls, so debouncing would only add input lag.
- No N+1: member-name lookups are single batched `.in()` queries; shop
  detail uses in-memory rows with a single-row fallback only.
- Boots already parallel: stocks, tasks (9 queries), congress/court,
  account club, nav auth/gate checks.
- Service worker is shell-only, network-first, same-origin only — correct
  for fresh data; it is an offline fallback, not an HTTP-cache substitute.
- `localStorage` holds UI state only (theme, cookie dismissal, cart,
  banner dismissals) — never API data, prices, membership, or permissions.
- Indexes: prepared-not-applied in `docs/pass3-index-drafts.sql`, referenced
  here, not duplicated.

## Not applicable (with reason)

- Streaming AI answers: no AI feature exists.
- Component re-render avoidance: vanilla JS, no framework; renders are
  full-list `innerHTML` rebuilds on filter, which is inherent to this code.
- Load balancing, server colocation, connection pooling, background
  queues, Redis: no app server in-repo; browsers call Supabase directly.
  Any pooling/caching there is a Supabase-dashboard setting, not code.
- List virtualization: not warranted for a club-scale archive; pagination
  remains the right answer if volume ever justifies it (see gap below).
- CDN / Brotli / GZIP: no in-repo file controls compression; the deploy
  shape is Cloudflare Workers Static Assets (`wrangler.jsonc`,
  observability already on). Verify compression and edge caching in the
  Cloudflare dashboard / response headers after deploy, not from the repo.
- Fleet real-user monitoring: no vendor is wired in-repo, and
  `cookies.html` states no third-party analytics scripts load. Any RUM
  vendor is Kyden's decision plus a policy-text update.

## Prepared, NOT applied (binary or measurement limits)

- Image conversions (binaries cannot go through this text-only push):
  `images/widelogo-light.png`, `images/widelogo-dark.png`,
  `images/logo-light.png`, `images/logo-dark.png`, `images/logo.png` →
  WebP. Do NOT convert `og:image` (`widelogo.png`) — crawlers want PNG/JPG.
  Commented-out images (`hero-bg.jpg`, `about-banner.jpg`, nation flags)
  convert only if un-commented. Resized variants needed before any
  `srcset`: nav logo ~120px wide (displayed 36px), slideshow ~1200px and
  ~800px (currently 2000/1920px).
- Font self-hosting: would need binary woff2 files; same push limit. The
  current Google Fonts setup (swap + preconnect) is already good.
- Featured-banner layout shift: the banner starts `display:none` and is
  injected after the news fetch, pushing the hero down. No guessed
  `min-height` was written — banner height varies with title wrapping, so
  this needs a browser measurement of rendered height first.
- Early-hide LCP delay is intentional (site-lock guarantee: pages stay
  `visibility:hidden` until nav's lock checks resolve, 14s failsafe).
  Do not remove it casually.

## Documented gaps (not fixed in this pass)

- News pagination: still a two-query refactor (banner query + paged index
  query), because client-side search depends on the full list. The F1
  banner-only query above shrinks the cost but does not paginate news.
- Same load-all + client-filter shape on tasks, congress, court, archive,
  and admin lists; server-side search/filter is not a minimal safe edit.
- Congress/court calendar fetches all non-cancelled events then drops past
  ones client-side; a server-side date filter needs a PostgREST `or()`
  quoting check first.
- Account profile row is fetched by both nav and `account.page.js` with
  different columns; sharing it would be racy without an ordering refactor.
- Shop `INITIAL_SESSION` re-init deliberately left alone: the listener is
  an explicit guarantee for the admin bar when `_mcaAuthReady` resolves
  via its timeout path; skipping it could strand the admin bar.
- Remaining untimed fetches (same 15s pattern, each needs its own
  error-handling check before applying): `nations.js` (3 REST fetches),
  `login.page.js` password-reset/signup/verify/resend, `account.page.js`
  age-check/email/password paths, `parental-consent.page.js`,
  `admin.page.js` notify calls, `news-publish.page.js` notify call.
  `supabase.js` keepalive beacon intentionally has no timeout.

## Lighthouse / slow-connection procedure (run AFTER deploy)

NOT MEASURED — nothing below was run in this pass. Use the deployed branch
URL (not a local file), Lighthouse Navigation / Mobile / Simulated Slow 4G,
plus a DevTools Slow 4G + 4x CPU reload watching the Supabase waterfall.
Pages, each its own run: `index.html`, `news.html`, `shop.html`,
`stocks.html` (one company page), `congress.html`, `account.html`
(signed in with Kyden's own account — no test accounts), `server.html`.
Record per page, before vs after: LCP, INP, CLS, Total Blocking Time,
Speed Index, transferred KB, request count, Supabase request count.
Pass bar (Kyden's call): no page regresses vs its own before run, and
`index.html` shows fewer Supabase requests and less transferred data.

## Open questions for Kyden

1. `script.js` is unreferenced by any HTML page and polls mcstatus.io every
   5s — delete it or leave it?
2. Audit-filter cap: the filter query is now capped at 1,000 rows. If
   filter completeness past 1,000 audit rows matters more than the bound,
   that needs a server-side distinct-values query instead.
3. Any fleet RUM vendor (see above)? If yes, `cookies.html` needs updating.
4. Confirm the featured-banner height measurement approach (browser
   measurement before any reserved-space CSS).
