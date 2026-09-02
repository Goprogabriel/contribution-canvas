<p align="center">
  <img src="docs/assets/hero.svg" alt="Contribution Canvas — draw a GitHub-style contribution graph with brush, eraser and pixel text" width="100%" />
</p>

<h1 align="center">Contribution Canvas</h1>

<p align="center">
  A polished, local-first studio for transparent GitHub contribution graph art.<br />
  Draw publicly. Push privately. Keep GitHub credentials out of the browser.
</p>

<p align="center">
  <a href="https://github.com/Goprogabriel/contribution-canvas/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Goprogabriel/contribution-canvas/ci.yml?branch=main&label=tests&style=flat-square" /></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-70e494?style=flat-square" /></a>
  <img alt="Zero production dependencies" src="https://img.shields.io/badge/runtime_dependencies-0-70e494?style=flat-square" />
  <img alt="Node 20+" src="https://img.shields.io/badge/node-%E2%89%A520.11-70e494?style=flat-square" />
</p>

<p align="center"><a href="README.da.md">Læs introduktionen på dansk</a></p>

> [!IMPORTANT]
> Contribution Canvas creates **automatically generated graph art**, not ordinary software-development history. Generated repositories and commits explicitly say so. Do not present the output as genuine work activity.

## What it includes

- A premium GitHub-style calendar editor with a drag brush and eraser.
- Exact per-day strengths, defaulting to `1–5`, with a configurable maximum up to the safe local limit.
- Compact `3×5` and readable `5×7` pixel fonts with live placement, centering and collision avoidance.
- Undo/redo, keyboard controls, accessible grid navigation, autosave, JSON import and JSON export.
- Calendar-year, rolling-year and custom date ranges with an explicit IANA timezone.
- An optional overlay of the authenticated profile's existing GitHub activity.
- Repository discovery, safe empty-repository creation and preflight checks.
- A real dry-run in an isolated clone, followed by one normal fast-forward push only after exact confirmation.
- A static, backend-free GitHub Pages product site using the same editor.
- A dependency-free Node.js CLI and local HTTP server.

## Two modes, one interface

| Capability | Hosted GitHub Pages | Local studio |
|---|---:|---:|
| Draw, erase and place text | Yes | Yes |
| Import/export plans | Yes | Yes |
| Autosave non-secret plan data | Yes | Yes |
| Read GitHub repositories/activity | No | Yes, through `gh` |
| Create generated commits | No | Yes |
| Push to GitHub | No | Yes, one normal push |
| GitHub token in browser code | Never | Never |

The hosted site is intentionally a **safe design studio**. It does not contain OAuth, a client secret, a database or a push endpoint. Starting the local program unlocks GitHub controls in the exact same page.

## Start locally

### Requirements

- [Node.js](https://nodejs.org/) 20.11 or newer
- [Git](https://git-scm.com/)
- [GitHub CLI](https://cli.github.com/) (`gh`)

### macOS, Linux and Windows

```bash
git clone https://github.com/Goprogabriel/contribution-canvas.git
cd contribution-canvas
gh auth login
npm start
```

No package installation is required for runtime dependencies; `npm start` launches the included CLI directly. The browser opens on a random `127.0.0.1` port.

Run the environment check separately:

```bash
npm run doctor
```

### CLI commands

```bash
# Open the visual studio
node ./bin/contribution-canvas.mjs studio

# Keep the browser closed or select a port
node ./bin/contribution-canvas.mjs studio --no-open --port 4173

# Validate or summarize an exported plan
node ./bin/contribution-canvas.mjs validate examples/hello-2026.json
node ./bin/contribution-canvas.mjs preview examples/hello-2026.json

# Generate everything in a temporary clone without changing GitHub
node ./bin/contribution-canvas.mjs apply plan.json \
  --repo your-name/graph-art \
  --dry-run

# Push only after supplying the exact total shown by preview
node ./bin/contribution-canvas.mjs apply plan.json \
  --repo your-name/graph-art \
  --confirm 184
```

The visual studio provides the same dry-run and push flow without requiring CLI arguments.

## Safe Git execution

The executor follows this sequence:

```text
validate plan and reject future dates
              │
              ▼
preflight repository and authenticated user
              │
              ▼
clone into an operating-system temp directory
              │
              ▼
generate correctly dated, transparent commits locally
              │
              ▼
compare the remote default-branch SHA with the original SHA
              │
              ▼
perform exactly one normal fast-forward push
              │
              ▼
verify the remote SHA and write a local receipt
```

It never uses `--force`, never rewrites the user's working tree and never sends a GitHub token to frontend JavaScript. A remote change during generation aborts the operation; a later race is rejected by Git's normal fast-forward rules.

Generated messages look like this:

```text
chore(graph-art): render 2026-04-18 pixel 2/4

Contribution-Canvas-Plan: cc-…
Generated-By: Contribution Canvas
```

A dedicated empty repository also receives a transparent README as part of its first generated commit.

## Why strength does not guarantee a shade

A strength of `4` means **four generated commits on that date**. GitHub derives its contribution colors relative to other activity in the displayed period. Existing activity, private-contribution settings and GitHub's own processing determine the final graph. The projected colors in this tool are therefore estimates.

Commits normally need to:

- use an email GitHub attributes to the authenticated account;
- be reachable from the repository's default branch;
- live in a non-fork repository;
- fall on non-future dates; and
- satisfy GitHub's own contribution rules.

Contribution Canvas uses the authenticated account's GitHub-provided `ID+login@users.noreply.github.com` identity and sets both author and committer timestamps to local noon in the chosen timezone. GitHub may still take up to 24 hours to update the public profile graph.

## Publish the free website with GitHub Pages

1. Create a repository named `contribution-canvas` and push this project.
2. Replace `Goprogabriel` with your own username in `package.json`, this README and the install command in `public/index.html`.
3. In GitHub, open **Settings → Pages** and select **GitHub Actions** as the source.
4. Push to `main`.
5. The included workflow builds the static site into `dist/` and deploys it.

The site uses relative asset paths and works at both a repository subpath and a custom domain. See [docs/GITHUB_PAGES.md](docs/GITHUB_PAGES.md).

## Repository layout

```text
bin/
  contribution-canvas.mjs   # CLI entry point
src/
  core/                     # dates, plans and bitmap text (browser + Node)
  git/                      # safe process, GitHub CLI and executor
  server.mjs                # loopback-only local server and API
public/
  index.html                # product site and editor shell
  assets/app.js             # complete client application
  assets/styles.css         # responsive visual system
scripts/
  build.mjs                 # static GitHub Pages build
  check.mjs                 # syntax and security invariants
tests/                      # unit and real Git integration tests
docs/                       # architecture, security and setup guides
.github/workflows/          # CI, Pages, CodeQL and release automation
```

## Security model

The local server:

- binds only to `127.0.0.1`;
- opens with a 256-bit random session token;
- removes that token from the address bar and keeps it in `sessionStorage`;
- requires the token on every local API request;
- validates the exact `Host` and mutation `Origin`;
- uses restrictive browser security headers;
- caps JSON request bodies;
- spawns Git and GitHub CLI commands with argument arrays and `shell: false`;
- avoids logging credentials, request bodies and tokens.

Read [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) before changing authentication, local networking or Git execution.

## Development

```bash
npm install
npm run check
npm test
npm run build
# or all three:
npm run verify
```

The project intentionally avoids frameworks and production packages. Tests use Node's built-in test runner and temporary Git repositories.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Security model and threat analysis](docs/SECURITY_MODEL.md)
- [Local mode](docs/LOCAL_MODE.md)
- [GitHub Pages](docs/GITHUB_PAGES.md)
- [Contribution behavior](docs/CONTRIBUTION_BEHAVIOUR.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## License and trademark notice

MIT licensed. Contribution Canvas is not affiliated with or endorsed by GitHub. GitHub is a trademark of GitHub, Inc.; the project does not use GitHub's logo as its product mark.
