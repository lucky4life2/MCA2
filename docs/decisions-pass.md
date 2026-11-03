# Decisions pass (2026-11-02) — answers applied to the compliance branch

Kyden's answers to the consolidated questions, applied here as code. Items
that need a dashboard, a panel, or a value only he can supply are listed at
the bottom as still-open — nothing below was guessed.

## Applied in code

### 1. Refund wording — identical everywhere
- Membership refunds: within **7 days** of signing up. Merchandise refunds:
  within **14 days** of delivery.
- Added sentence, verbatim: "Defective or wrong items are always replaced
  or refunded."
- Locations: `refund.html` (merchandise list), `terms.html` (Purchases
  section), `shop.html` (cart footer note — the site's checkout text; the
  Stripe Checkout page itself is hosted by Stripe and can't carry this text).
- Legal-review note (from the answer): a quick review is worthwhile once
  the nonprofit is incorporated. Not done here — no lawyer was involved.

### 2. Social card — purpose-built 1200x630, NOT yet in the repo
- `images/widelogo.png` is 500x198 (2.53:1), not the ~1.91:1 social size.
- A purpose-built card was built: 1200x630 PNG (85 KB, under the 5 MB
  limit), solid white background, MCA logo centered, "Minecraft Club of
  America" in brand blue, homepage subheading as the tagline, ~100px safe
  margins. File: `mca-social-card-1200x630.png` (delivered alongside this
  branch, needs a manual push — see below).
- Binary push blocked: the GitHub connector's push path accepts UTF-8 text
  only (`push-files` refuses non-UTF-8 input; the single-file API takes a
  text string the server base64-encodes). No binary can round-trip through
  it, so the card is NOT in this commit.
- Fallback applied instead, and it does not lie: all 28 pages carrying
  `og:image` now also carry the TRUE widelogo dimensions
  (`og:image:width` 500, `og:image:height` 198).
- When the card is pushed manually to `images/social-card-1200x630.png`,
  repoint every `og:image` to it and change the dimensions to 1200x630.

### 3. Spending caps in code (supersede pass 3's looser caps)
- Max **10 per item**: `shop.page.js` `maxQty` 99 -> 10, and the checkout
  function clamps server-side to 10 (was 99). Subscriptions stay at 1.
- Max **$500 order total**: enforced in `create-checkout-session` from the
  server-side line totals (mockLines mirror the Stripe lines exactly).
- Max **3 orders per member per day**: enforced in `create-checkout-session`
  by counting the member's `orders` rows created today (UTC); fail-closed
  on a query error. Applies to test-checkout orders too (they are real rows).
- Pass 3's 100-distinct-item cap is unchanged (it closes the webhook's
  single-page line-item limit, a different constraint).

### 4. Upload optimization (images only)
- New `optimizeImageFile(file, maxEdge = 2048)` in `supabase.js`, wired
  into every real image-upload path:
  - News photos (`news-publish.page.js` `uploadNewsImage`).
  - Product photos (`admin.page.js` `pmUploadPendingImages`).
  - Message attachments (`uploadMsgAttachments` in `account.page.js` and
    `admin.page.js` — covers contact-form photos and thread replies).
- Behavior: raster images are resized to a 2048px max long edge, converted
  to WebP at quality 80 (JPEG at 80 on browsers without a WebP encoder, and
  the original file kept when the image has alpha and WebP is unavailable,
  so transparency is never silently lost). Drawing through a canvas drops
  ALL EXIF, including GPS. Decode failures throw a clear error rather than
  silently uploading an unprocessed original.
- Deliberately NOT optimized: archive documents (they are documents, not
  images — converting them would corrupt them), SVGs (vector), GIFs
  (animation would collapse to one frame). Avatars don't exist on the site,
  so the 512px avatar size has no call site yet.
- UI lines added where images upload (news hero hint, contact-form hint,
  product dropzone note, both message-reply forms): photos are optimized
  on upload.

### 5. Error logging — server-side first, scrubbed, gated
- A `reportError` helper is wired into the catch blocks of all three
  in-repo Edge Functions (`create-checkout-session`,
  `create-billing-portal-session`, `stripe-webhook` — 6 catch blocks total).
- Gated on a `SENTRY_DSN` secret: with no DSN set it is a complete no-op
  and `console.error` remains the only log. No Sentry project or DSN exists
  yet — see the dashboard step below.
- Scrubbed before sending: emails, JWTs/tokens, Stripe keys
  (`sk_/pk_/rk_/whsec_`), Bearer tokens, card-like digit runs. Bodies, user
  emails, and payment data are never sent — only the scrubbed message and
  the call site. Delivery uses the Sentry envelope API with `waitUntil`
  where the runtime offers it, so reporting never delays a webhook reply.
- Browser error logging is NOT added (held until a privacy review).

## Dashboard / panel checklist (not repo code — needs a human in a panel)
- **Stripe Radar:** block on CVC fail; block on postal-code fail; require
  3DS at elevated risk; velocity rule blocking >3 failed attempts per
  card/IP/hour.
- **Supabase spend alerts:** keep the spend cap on; usage alerts at 50%,
  80%, and 100%.
- **Sentry:** create a Sentry project, set `SENTRY_DSN` as a Supabase
  secret for the three functions above. Server-side only; browser SDK stays
  off until the privacy review.
- **Stripe receipt wording:** the "identical everywhere" refund wording
  covers the site pages and checkout text; Stripe receipt wording is a
  Stripe dashboard setting and was not changed here.
- **Test-checkout verification (still owed):** confirm live keys start
  with `sk_live_`/`pk_live_`, the webhook signing secret is from the live
  endpoint, no test/debug flag is set in production env vars, then run one
  real small purchase and refund it.
- **Uptime alerts:** dedicated `alerts@`-style alias forwarding to a
  personal inbox and phone, plus a second address on a different domain so
  alerts survive a site-mail outage. No addresses were supplied.
- **Backups:** check Dashboard -> Database -> Backups. Free tier has no
  usable backups; paid plans have daily backups with short retention and
  point-in-time recovery is a paid add-on. If taking real payments, Pro +
  PITR is the recommendation. Staging restore test within two weeks, then
  quarterly. Plan/PITR status is not visible from the repo and was not
  verified live.
- **Cloudflare WAF rate limits (per IP):** login/signup 5/min, checkout
  creation 10/min, contact/forms 5/10 min, uploads 10/min, general API
  100/min; managed challenge first, then block repeat offenders. Free plan
  allows only one rule — prioritize login + checkout.

## Still open (missing values, not code)
- **Postal address:** no value was supplied. A P.O. Box (real USPS box or
  registered private mailbox) or the North Dakota registered agent address
  works for CAN-SPAM; never a home address. Nothing was added to the
  footer or email templates, and no placeholder was invented.
- **Highest normal price:** needed to tune the spending caps; not supplied.
- **Uptime alert addresses:** not supplied.
- **Backup plan / PITR status:** not verified (dashboard check owed).
- **Legal review of refund terms:** worthwhile once incorporated (see §1).
