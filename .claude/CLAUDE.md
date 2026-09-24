# Fork notes

The general guidance for this repository lives in [AGENTS.md](../AGENTS.md), so that every agent
reads the same copy. Read it before working here. This file only adds what is specific to this
fork. It lives in `.claude/` rather than the root `CLAUDE.md`, which stays upstream's.

## This is a fork

- Upstream: `orangecoding/fredy` on GitHub. This repo (`origin`) is `yanicii/fredy`, a personal
  fork used to make changes and run them locally in Docker.
- Branches: `master` mirrors upstream releases and stays clean for syncing with upstream.
  `develop` is the fork's working branch where all local changes live. Use feature branches off
  `develop` only for bigger changes. Keep commits focused so they can later be rebased onto or
  cherry-picked from upstream.
- The "do not commit / do not create a branch" line in AGENTS.md is inherited from upstream. In
  this fork the user's global git rules apply instead: commit when asked, run lint and tests
  before committing, never push without asking.

## Keeping upstream merges conflict-free

Merging `master` into `develop` should not conflict. Fork code therefore lives in fork-only files,
and upstream files carry at most a one-line hook into them. Before editing an upstream file, look
for a fork-only place first:

| Fork concern                     | Where it goes                                                        |
| -------------------------------- | -------------------------------------------------------------------- |
| New provider                     | `lib/provider/<id>.js` (auto-discovered, no registration needed)     |
| Provider tests and fixtures      | `test/provider/<id>.test.js`, `test/testFixtures/<id>*.html`         |
| Provider test config             | `test/provider/testProvider.json`, at the **top** of the object      |
| Offline fetch routes             | `test/fork/offlineRoutes.js` (hooked from `test/offlineFixtures.js`) |
| Price-range "no range" rows      | `test/fork/priceRangeRows.js` (spread into `priceRange.test.js`)     |
| Fixture downloaders              | `tools/testFixtures/forkDownloaders.js` (hooked before the switch)   |
| Other fork-only tests            | `test/fork/*.test.js`                                                |
| Provider documentation           | `doc/fork-providers.md`, not `doc/providers.md`                      |
| Docker compose settings          | `docker-compose.override.yml`, not `docker-compose.yml`              |
| Fork notes for agents            | this file, not the root `CLAUDE.md`                                  |

- Upstream appends new providers at the end of `testProvider.json`, so fork entries go at the top.
- Fork providers are not listed in `ui/src/services/providerOrder.js`; unranked providers sort
  after the ranked ones of their country, which is fine.
- Real fixes to upstream code (currently `_filterAfterDetails` in
  `lib/FredyPipelineExecutioner.js` and the provider name in
  `ui/src/components/table/ProviderTable.jsx`) are small hunks that should go upstream as PRs.
  Once merged there, the fork's copy disappears on the next merge.
- `git rerere` is worth enabling (`git config rerere.enabled true`) so a conflict resolved once is
  replayed automatically next time.

## Local Docker workflow

The primary way to run this fork is a locally built Docker image. The machine is Apple Silicon
(arm64); the Dockerfile supports arm64 natively (Debian trixie base), so no `--platform` flag is
needed for everyday use.

```bash
# Rebuild image (cached layers, fast for code-only changes) and (re)start the container
docker compose up -d --build

# Follow logs
docker compose logs -f fredy

# Stop
docker compose down

# Full clean rebuild plus smoke test (slow, forces linux/amd64 on macOS, uses named volumes)
./docker-test.sh
```

- App: http://localhost:9998, default login `admin` / `admin`.
- `docker-compose.yml` mounts `./conf` to `/conf` and `./db` to `/db`. The SQLite DB lands in
  `./db` (gitignored). `conf/config.json` is tracked and points `sqlitepath` at `/db`, i.e. it is
  written for the container, not for a bare `node index.js` on the host.
- `docker-compose.override.yml` tags the local build as `ghcr.io/yanicii/fredy:local` with
  `pull_policy: never`, so a `docker compose pull` cannot swap in upstream's image.
- The Dockerfile copies `lib/`, `ui/`, `index.js` and builds the frontend inside the image, so
  frontend changes also require a rebuild.

## Quick dev loop without Docker

Use this for fast iteration on backend or UI code, then verify in Docker before finishing.

```bash
yarn install
yarn run start:backend:dev      # nodemon on :9998
yarn run start:frontend:dev     # Vite dev server, proxies /api to :9998
yarn test:offline               # preferred test mode, uses fixtures
yarn lint && yarn format:check
```

- Node >= 22 is required (`package.json` engines). `.nvmrc` still says 16.14.0 and is stale;
  ignore it.
- Running the backend bare on the host with the tracked `conf/config.json` will try to use `/db`.
  Point `sqlitepath` elsewhere locally or run in Docker.

## Definition of done for a change in this fork

1. Lint and offline tests pass (`yarn lint`, `yarn test:offline`).
2. `docker compose up -d --build` succeeds and the app answers on http://localhost:9998.
3. The changed feature was exercised in the running container, not only in unit tests.
