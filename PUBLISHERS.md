# nuuc-it/Static — published static front ends

This repo is a **static host**, served by GitHub Pages from `main`/root at
<https://nuuc-it.github.io/Static/>. Several project repos publish into it, each namespaced under
its own folder beneath `pub/`.

## Rules

1. **This repo holds built output only. It is never hand-edited.** Every file under `pub/` was
   written by a build in the project repo that owns it; an edit made here is lost at that project's
   next deploy.
2. **Each folder's content is owned 100 % by exactly one project repo.** No other repo ever writes
   into it. Because the paths are disjoint, two projects publishing at the same time can never
   produce a content conflict — a publish that finds the branch has moved rebases and pushes.
3. **A new folder is registered here first.** The publishing pipeline
   (GAS-Core's `gas-static`) reads the JSON block below and **refuses** to publish to a folder that
   is not listed, or one listed against a different project. Adding a folder is a deliberate,
   reviewed two-line edit in this repo — which is the point.
4. Source for any page lives in its owning project repo, not here.

## Who publishes what

| Folder | Owning project repo | Env | Live URL |
|---|---|---|---|
| `pub/AS` | NUUTS-Track (`scripts/portal-static.js` via `gas-static`, PROD build; cut over from GActionSheet 2026-10-11) | production | <https://nuuc-it.github.io/Static/pub/AS/> |
| `pub/AS-sit` | NUUTS-Track (`scripts/portal-static.js` via `gas-static`, chained off the Shell `deploy:test`) | test | <https://nuuc-it.github.io/Static/pub/AS-sit/> |
| `pub/ballot` | RankChoiceVoting (`tools/static-pages.js` via `gas-static`, NUUC build) | nuuc | <https://nuuc-it.github.io/Static/pub/ballot/> |
| `pub/pmix-sit` | PracticeMix (`tools/static-pages.js` via `gas-static`) | test | <https://nuuc-it.github.io/Static/pub/pmix-sit/> |
| `pub/pmix` | PracticeMix (same pipeline, PROD build) | prod | <https://nuuc-it.github.io/Static/pub/pmix/> |
| `pub/shell-sit` | NUUTS-Shell (`scripts/static-pages.js` via `gas-static`, chained off `deploy:test`) | test | <https://nuuc-it.github.io/Static/pub/shell-sit/> |
| `pub/shell` | NUUTS-Shell (same pipeline, PROD build) | production | <https://nuuc-it.github.io/Static/pub/shell/> |
| `pub/DL-sit` | NDocs (`tools/static-pages.js` via `gas-static`, SIT build) | test | <https://nuuc-it.github.io/Static/pub/DL-sit/> |
| `pub/DL` | NDocs (same pipeline, PROD build) | prod | <https://nuuc-it.github.io/Static/pub/DL/> |

`pub/pmix` went live on 2026-08-26 with PracticeMix v1.6.8 — its first PROD deploy. `pub/DL`/
`pub/DL-sit` registered 2026-09-12, ahead of NDocs's first publish (its Stage 2, still to build).

The OAuth-consent pages under `pub/AS*/privacy/` and `pub/AS*/terms/` are referenced by
NUUC-Dispatch's consent-screen configuration; they are published by the folder's owning project
(`pub/AS-sit`: NUUTS-Track; `pub/AS`: NUUTS-Track) along with the rest of that folder.

## Ownership map

The block below is read by `gas-static`'s publish guard (GAS-Core `adr/0003`). Keys are paths
relative to this repo's root; `project` must match the publishing project's declared `projectName`.
Keep it in step with the table above.

```json
{
  "pub/AS": { "project": "NUUTS-Track", "env": "production", "url": "https://nuuc-it.github.io/Static/pub/AS/" },
  "pub/AS-sit": { "project": "NUUTS-Track", "env": "test", "url": "https://nuuc-it.github.io/Static/pub/AS-sit/" },
  "pub/ballot": { "project": "RankChoiceVoting", "env": "nuuc", "url": "https://nuuc-it.github.io/Static/pub/ballot/" },
  "pub/pmix-sit": { "project": "PracticeMix", "env": "test", "url": "https://nuuc-it.github.io/Static/pub/pmix-sit/" },
  "pub/pmix": { "project": "PracticeMix", "env": "prod", "url": "https://nuuc-it.github.io/Static/pub/pmix/" },
  "pub/shell-sit": { "project": "NUUTS-Shell", "env": "test", "url": "https://nuuc-it.github.io/Static/pub/shell-sit/" },
  "pub/shell": { "project": "NUUTS-Shell", "env": "production", "url": "https://nuuc-it.github.io/Static/pub/shell/" },
  "pub/DL-sit": { "project": "NDocs", "env": "test", "url": "https://nuuc-it.github.io/Static/pub/DL-sit/" },
  "pub/DL": { "project": "NDocs", "env": "prod", "url": "https://nuuc-it.github.io/Static/pub/DL/" }
}
```
