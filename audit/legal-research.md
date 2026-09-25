# Phase 4 legal research: subagent findings (2026-09-24), not legal advice

Condensed from the legal-researcher run (opus). [uncertain] marks unverified points. minecraft.net, the Discord policy page, and the ND statute PDF could not be fetched directly and were cited via search results.

## Applicability screen
| Law | Status | Why |
|---|---|---|
| COPPA (16 CFR 312, amended; compliance date 2026-04-22) | Unclear, treat as applying | The FTC Act §5 nonprofit exemption is uncertain while MCA is incorporating and selling $12 memberships. **Blocking under-13s is allowed only for a general-audience site** (FTC FAQ D.4/H.3). privacy.html:38, :112 and terms.html:44 currently present the site as serving children under 13. |
| CalOPPA | Applies [uncertain] | Missing a Do Not Track statement, a third-party tracking statement, and Stripe in the processor list. |
| Colorado minors' provisions (SB24-041, C.R.S. 6-1-1308.5) | Applies | No volume threshold and no nonprofit exemption. Needs a data protection assessment and data minimization/retention. |
| OR / DE / MN / NJ / MD comprehensive privacy laws | Below threshold | Re-check Delaware (10k consumers) after 2027-01-01. |
| CA / MD Age-Appropriate Design Codes | Exempt | Both cover for-profit businesses only; CA's is also enjoined. |
| Utah, Louisiana | Below the 5M threshold, and enjoined or struck down | |
| Florida HB3 | Not covered | Its definition requires algorithmic feeds. |
| Texas SCOPE (ch. 509) | Likely applies | Age registration; purchase limits for known minors (whether §509.052 is enjoined is [uncertain]). |
| Tennessee (47-18-5701) | Likely applies, not enjoined [uncertain] | **Age verification plus parental consent for everyone under 18.** |
| Mississippi HB1126 | Likely applies [uncertain] | Same as Tennessee. |
| Georgia SB 351 | Enjoined | |
| ND breach notification (NDCC 51-30) | Applies | Needs an incident runbook. |
| IRS 501(c)(3) | Applies once exempt | No campaign intervention; written acknowledgment for gifts of $250+; disclosure for quid pro quo payments over $75. |
| ND charitable solicitation (NDCC 50-22) | Applies if donations are taken | License required before soliciting. |
| CAN-SPAM | Applies to promotional email | Postal address plus opt-out. |
| PCI DSS | SAQ A | Stripe hosted Checkout. |
| Minecraft EULA / Usage Guidelines | Applies, highest practical risk | Server access fees are OK only if the same price for everyone. Comped memberships and role-based bypass are risky. Using "Minecraft" as the dominant name likely breaches the guidelines. |
| Discord terms | Applies | Users 13+; OAuth currently runs before the age screen. |
| ADA / WCAG | Unclear | Aim for 2.1 AA and add an accessibility statement. |

## Technical fixes proposed
- Rewrite the privacy/terms audience copy to 13+ **before** launching the under-13 block.
- Run the age screen before email or OAuth. On an under-13 result, create nothing, set a persistent browser flag, and delete any OAuth identity already created.
- Add an "if we learn a user is under 13" clause.
- Publish a retention schedule: failed screens stored as a count only; account data while active plus 7 days; orders 7 years [uncertain]; audit_log 12 months; support messages 24 months; published content kept with the author anonymized.
- CalOPPA: add Payments (Stripe), Do Not Track, and third-party tracking sections.
- Terms: operator "MCA Inc., a North Dakota nonprofit corporation"; 13+; Payments, Membership & Refunds; ND governing law; nonpartisanship clause.
- Footer: add "NOT AN OFFICIAL MINECRAFT WEBSITE. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.", change © to MCA Inc., and remove "Official … merchandise".
- Limit membership exemptions to real server administrators.

## Open questions for counsel
Whether the COPPA nonprofit exemption applies; general-audience vs child-directed; handling of legacy under-13 accounts; whether TN/MS/TX require keeping parental consent for 13–17 or state-based gating; which states need charitable registration; the Minecraft name/domain and Mojang approval; auto-renewal law.

## Sources
ecfr.gov part 312; ftc.gov COPPA FAQ; leginfo.legislature.ca.gov BPC 22575; leg.colorado.gov SB24-041; doj.state.or.us; delcode.delaware.gov 12D; capitol.texas.gov HB18; billstatus.ls.state.ms.us HB1126; opn.ca6.uscourts.gov 26a0250p-06; netchoice.org (11th Cir. HB3; NetChoice v. Carr); leg.state.fl.us 501.1736; ndlegis.gov t51c30 and t50c22; sos.nd.gov charitable organizations; irs.gov (political campaign intervention, written acknowledgments, quid pro quo); ftc.gov CAN-SPAM guide; docs.stripe.com/security/guide; minecraft.net usage-guidelines and EULA; discord.com/terms; support-dev.discord.com Developer Policy; ada.gov web guidance.
