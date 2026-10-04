# static-portal/src — NUUTS-Shell static site (published)

Source of truth for the Shell static site: runtime assets, terms, privacy. Built and
published through GAS-Core's shared `gas-static` package, configured by
`scripts/static-pages.js` — see that file's header and
`packages/gas-static/README.md` (GAS-Core) for the stamping/publish mechanics.

- `assets/product-details/` — runtime images referenced by `src/Constants.js` and `appsscript.json`
  (`logoUrl`); ported byte-identical from GActionSheet (one-time, `nuuts-hua`).
  The Action Item team portal `index.html` is NOT published: it lives in `../act-portal/`.
- `privacy/`, `terms/` — OAuth-consent-screen-linked pages for NUUC-Dispatch's
  identity-verification scope (`openid email`, no Drive/Doc access) — carried
  over verbatim from the original spike content, not specific to this page's
  own functionality.
- `icon-{32,48,96,128}.png` — visual identity, copied from GActionSheet's
  `assets/store-details/`.
- `consent-screen-text.md` — the exact text/links pasted into the GCP OAuth
  consent screen form for NUUC-Dispatch.

Published to the sibling `Static` repo (`local.settings.json`'s
`staticPortalRepoPath`) — SIT to `pub/shell-sit/`, PROD to `pub/shell/` — as the
automatic last step of `pnpm run deploy:test` / `pnpm run deploy:prod`. For a
standalone build or a recovery publish:
`node -e "require('./scripts/static-pages.js').build('sit')"` /
`.publish('sit', { yes: true })`.
