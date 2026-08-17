# pub/ballot — RankChoiceVoting (NUUC) static front end

Static content for the RankChoiceVoting app's NUUC deployment. Built from the
RankChoiceVoting repo's `static-pages/src/index.html` by `tools/build-static-pages.js` and
published here by `tools/publish-static-pages.js`, as the last step of `npm run deploy:nuuc`
(`tools/manage-deployments.js`). Not hand-edited — see the RankChoiceVoting repo for source.

A single folder, not split into sit/prod like `f3go30/static-pages`'s `ballot/` — NUUC is one
environment.

- https://nuuc-it.github.io/Static/pub/ballot/

Calls the NUUC GAS deployment's `?cmd=api` JSON endpoint as its backend (baked in at build time
from `local.settings.json`'s `nuucDeploymentId` — see RankChoiceVoting's `script/ApiBridge.js`
for the server side).
