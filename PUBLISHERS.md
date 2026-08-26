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
| `pub/AS` | GActionSheet (`static-portal/src`, `scripts/publish-static-portal.js`) | production | <https://nuuc-it.github.io/Static/pub/AS/> |
| `pub/AS-sit` | GActionSheet (same pipeline, SIT build) | test | <https://nuuc-it.github.io/Static/pub/AS-sit/> |
| `pub/ballot` | RankChoiceVoting (`tools/publish-static-pages.js`, NUUC target) | nuuc | <https://nuuc-it.github.io/Static/pub/ballot/> |
| `pub/pmix-sit` | PracticeMix (`tools/static-pages.js` via `gas-static`) | test | <https://nuuc-it.github.io/Static/pub/pmix-sit/> |
| `pub/pmix` | PracticeMix (same pipeline, PROD build) | prod | <https://nuuc-it.github.io/Static/pub/pmix/> |

`pub/pmix` went live on 2026-08-26 with PracticeMix v1.6.8 — its first PROD deploy.

The OAuth-consent pages under `pub/AS*/privacy/` and `pub/AS*/terms/` are referenced by
NUUC-Dispatch's consent-screen configuration; they are published by GActionSheet along with the rest
of that folder.

## Ownership map

The block below is read by `gas-static`'s publish guard (GAS-Core `adr/0003`). Keys are paths
relative to this repo's root; `project` must match the publishing project's declared `projectName`.
Keep it in step with the table above.

```json
{
  "pub/AS": { "project": "GActionSheet", "env": "production", "url": "https://nuuc-it.github.io/Static/pub/AS/" },
  "pub/AS-sit": { "project": "GActionSheet", "env": "test", "url": "https://nuuc-it.github.io/Static/pub/AS-sit/" },
  "pub/ballot": { "project": "RankChoiceVoting", "env": "nuuc", "url": "https://nuuc-it.github.io/Static/pub/ballot/" },
  "pub/pmix-sit": { "project": "PracticeMix", "env": "test", "url": "https://nuuc-it.github.io/Static/pub/pmix-sit/" },
  "pub/pmix": { "project": "PracticeMix", "env": "prod", "url": "https://nuuc-it.github.io/Static/pub/pmix/" }
}
```
