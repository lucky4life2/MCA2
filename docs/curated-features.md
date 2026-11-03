# Curated features pass (2026-11-03)

Branch `compliance-20-2026-11-02`, one batched commit, unmerged, no PR.
Applies ONLY the curated items from the reel's feature list. No live
browser run, no live DB writes, no payments, no analytics added.

## Done in code

- **Dark mode toggle — already existed; one gap filled.** The toggle
  (desktop + mobile, persisted in `localStorage` as `mca_theme`) and the
  full dark stylesheet already existed in `nav.js` / `style.css`. The
  only missing piece of the spec was the default: with no stored choice
  the site always started light. It now respects
  `prefers-color-scheme: dark` until the user picks explicitly.
- **Full-site search — new `search.html` + `search.page.js`.** Static
  index of the 20 real public pages (titles/descriptions copied from
  each page's own metadata) plus published news articles and archive
  documents fetched live. Gated/member pages (account, admin, tasks,
  publish dashboards, login, parental-consent, unsubscribe) are
  deliberately NOT indexed. Live queries degrade to pages-only on
  failure, with a note. Linked from the main nav and the footer.
- **Back-to-top button — new, site-wide via `nav.js`.** Appears after
  600px of scrolling, keyboard-focusable, honors reduced motion, sits
  clear of the cookie banner.
- **Print stylesheet — new `@media print` block in `style.css`.**
  Hides nav, footer, buttons, cookie banner, toasts, and the back-to-top
  button; expands content; underlines links; avoids breaking headings,
  images, and tables; prints article link URLs.
- **Copy-to-clipboard buttons — two deltas.** The article Share button
  already copied with "Copied!" feedback; its last-resort `prompt()`
  fallback now tries a temporary-field copy first and only prompts if
  that fails. New: a "Copy invite link" button beside the Discord link
  in the footer, copying the live invite URL with the same
  clipboard-then-field fallback and "Copied!" feedback (no false
  success). Existing email/server-address copy helpers untouched.
- **Password visibility toggle — new, site-wide via `nav.js`.** Every
  statically present password field (sign-in, signup, password reset,
  account change-password, delete-account re-auth) gets a Show/Hide
  button with `aria-pressed` and a visible label. The visible state is
  never persisted and values are never logged.
- **Confirmation modals — new shared `window.mcaConfirm` in `nav.js`.**
  Accessible dialog (role, aria-modal, labelledby/describedby, focus
  starts on Cancel so Enter never confirms, Escape and backdrop cancel,
  focus returns to the opener, Tab cycles within). Converted from
  native `confirm()` on delete paths ONLY: account deactivation; admin
  delete article, document, FAQ question, account, role, product,
  nation, leadership entry, history server, club president, and admin
  message; news-publish delete article; archive-publish delete
  document. Each double native confirm became one modal; the admin
  delete-account typed-name prompt is unchanged and still follows the
  modal. Unpublish actions were already one-click and reversible, so
  they were NOT given modals, and neither were reversible confirms
  (unlink, freeze, approve, publish, clear editor, and similar).
- **Last-updated dates — policies already-OK, articles done.**
  Privacy, Terms, Accessibility (September 4, 2026) and Cookies,
  Refund (September 16, 2026) already carry "Last updated" lines.
  Articles now render "Last updated …" from the real `updated_at`
  column (verified to exist on `news_articles`) and ONLY when it is
  later than `published_at`; otherwise only the published date shows.
  No date was invented anywhere.
- **Sitemap + llms.txt** gained the new `search.html` entry.

## Already-OK (audit-only trio, verified not redone)

- **Sticky headers:** the nav is `position: fixed; top: 0` (style.css),
  so the header stays visible while scrolling.
- **Mobile menus:** the hamburger toggle exists in `nav.js` with
  open/close, close-on-link-click, and close-on-outside-click.
- **Hover states:** 47 `:hover` rules in `style.css`, including nav,
  footer, buttons, and cards.

## Verified only (no blanket rework)

- **Form success/error states:** auth forms already carry dedicated
  error elements (sign-in, signup, consent, forgot-password, forgot
  code) and the account password form has `password-error`. No
  genuine gap found, so nothing was reworked.

## Explicitly skipped

- Cookie banner: already exists. Skip-to-content link: already added
  in pass 2. Loading states: already everywhere (passes 3–4).
- Scroll progress bars: cosmetic garnish, not an improvement here.
- UTM tracking: skipped on privacy grounds — the site deliberately
  loads no third-party analytics (cookies page states this), and
  tracking minors' traffic is the wrong direction.
- Expandable FAQ sections: skipped — no FAQ content exists, and
  inventing FAQ content is not a code fix.
- Floating contact button: skipped — contact is already reachable
  via navigation; a floating button adds clutter, especially mobile.

## Not verified live

No browser run was performed (subagent has no live browser). The
following still need a post-deploy browser check: dark-mode default on
a dark-OS device, search page results, back-to-top visibility,
password toggles on login/account, the confirm modal on one delete
path, print output on an article page, and the footer invite copy.
