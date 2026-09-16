# Revenant Systems / From the Grave website preview
Created 2026-09-14. Local design proposal; not a production deployment.

## Open
From M:\Projects\Exhume run:
```powershell
node site-preview/server.mjs
```
Open http://127.0.0.1:4321. Stop the terminal process to stop the preview.
PREVIEW_PORT may override the default if the port is occupied.
No dependencies are added or installed.

## What is implemented
- A responsive, emerald-and-gold homepage with an interactive sacred-geometry map.
- All 35 crypts from the existing worker/levels.js campaign, across six worlds.
- Local playable integration with the original Worker, forced to its scripted mock provider.
- Original game endpoints and filters, a redesigned conversation and reveal interface.
- Separate exhume.preview storage namespace.
- Pausable decorative geometry; reduced-motion support; native buttons, forms and modal dialogs.
- All 17 confirmed offerings: 15 paid offers and 2 free downloads, searchable by category through filters.
- Product details and original live checkout/download links. These links are real.
- After-win routes to continue, inspect relevant products, or contact Revenant Systems.
- Existing mission, resources and contact pages remain linked.
- Local preview events, capped at 200, accessible as window.revenantPreviewEvents.
  No prompt, reply, name or email appears in these events. Nothing is sent to PostHog.
- The redesign lives in site-preview. Follow-up message-limit changes also update the shared Worker and the original interface; see below.

## Design direction
The landing page offers a challenge immediately. The 35 nodes give the campaign physical presence.
Gold marks the available and selected crypt; jade marks completion. A restrained moving geometric
layer supplies atmosphere without moving the interactive targets.

The product sequence is a hypothesis: security and AI tools may fit players better than a
Windows-customization-led pitch. It needs measurement. It does not establish why existing sales
are zero. The catalog still contains all offerings, with desktop and free paths one filter away.

Recruiting copy invites a conversation about method. It makes no promise of hiring and does not
treat a mock-game completion as validated ability. There is no applicant form or applicant database.

## Before public launch
1. Agree the visual direction and public game name.
2. Replace the mock recruitment assessment with a validated real-model campaign.
   Existing Worker limitations include client-owned progress and per-level limits, untrusted history,
   static provider-model mapping, non-atomic KV counters, and unfinished adaptive-boss behavior.
   G0 also needs correction for real-provider play. Do not publish the preview server.
3. Design durable, server-verified attempts, signed sessions, abuse controls and budget enforcement.
   Separate practice from scored attempts; version models and challenge conditions.
4. Define the hiring review rubric, actual opportunities, consent and retention policy.
   Capture approach and reproducibility with opt-in contact rather than inferring merit from a word.
5. Confirm storefront ownership/deployment path, product compatibility, license/refund terms,
   all checkout totals, and paid-download fulfillment. The existence of links is not checkout testing.
6. Add useful product previews, included-skill detail and installation guidance to replace generic
   descriptions. No invented customer reviews, conversion claims or research success statistics.
7. Connect to the site's existing analytics after choosing consent behavior.
   Proposed funnel: landing_view -> game_start -> game_complete/game_exit -> product_view ->
   product_outbound -> server-confirmed purchase. Track recruiting separately.
   Do not count outbound checkout clicks as purchases. Current preview events stay in memory.
8. Complete live-browser keyboard, form, mobile and end-to-end purchase/fulfillment checks before release.

## Reference sources
- Live site: https://www.revenantsystems.net/ and /software.html (reviewed 2026-09-14).
- Local live-site snapshot: M:\Projects\www-revenantsystems-net\public_html.
- Existing game: M:\Projects\Exhume\worker and public/curriculum.
- Sacred-geometry asset copied without modification from the canonical branding assets:
  B:\The-Ossuary\Revenant-Systems\Branding-Marketing\revenantsystems-net\assets\MetaVegvisirTron'sCube_GOLD.png
- Design guidance selectively loaded from B:\AI-Armory, including frontend-design,
  design-system, web-design-guidelines and accessibility references.

## Follow-up changes: message limits and the crypt experience
- Crypts 1-4 now have no game-level character cap. Crypts 5-35 allow 4,000 characters.
- The shared Worker publishes the limit and rejects over-limit messages before spending a candle.
  It no longer silently truncates prompts. Both interfaces show a count and the current limit.
- The local preview retains a 128 KiB full-request transport ceiling, which includes conversation
  history and JSON overhead. Exceeding it gives an explicit error; it does not truncate the message.
- The word-entry action now says "Speak the word".
- A persistent campaign seal shows the active crypt and cleared crypts while playing. It responds
  to pending requests, defense blocks, answers, and successful words. Replies have a short staggered
  word entrance, with no voice. Both map and play screens offer a motion pause; reduced motion
  disables the animation.
- Validation: 42 original self-tests plus 8 new message-limit regression tests passed.
  New tests verify intact 12,000-character-plus messages in crypts 1-4, rejection at 4,001 on crypt 5
  without spending or logging an attempt, acceptance at 4,000, and rejection of empty input.
  Run the new tests with: node worker/message-limits.test.mjs.
- The localhost server was restarted to load the shared Worker changes. A browser refresh is
  needed for the new client; progress persists, unsent drafts do not.

## Hosting constraint from Dave
No usage bill and no public access to Dave's computer. Local Ollama is not a public hosting plan.
Proposed fit: Cloudflare Workers AI on Workers Free, with a free-plan-compatible model, explicit
quota-exhausted state, no paid-provider fallback and a storefront that remains accessible.
This is a recommendation, not a deployed connection or an account-plan verification.
Current official documentation states a 10,000-neuron daily free allocation and failure of further
requests when exhausted on Workers Free. Paid overages require Workers Paid. Verify the account's
actual Workers plan before enabling real-model access.
Sources checked 2026-09-14:
https://developers.cloudflare.com/workers-ai/platform/pricing/
https://developers.cloudflare.com/workers-ai/platform/errors/
No hosted provider, paid plan, credit purchase or public tunnel was enabled.
