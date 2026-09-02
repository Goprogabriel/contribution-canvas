# Architecture

## Goals

Contribution Canvas must be usable from a free static host while keeping all privileged GitHub operations on the user's own computer. The codebase therefore has one shared UI and two capability modes.

## Components

### Static web application

`public/` contains the product site and editor. It uses browser APIs and the framework-independent modules from `src/core/`. A build copies both into `dist/` without bundling.

In hosted mode the application can draw, autosave, import and export. No API endpoint or OAuth flow exists.

### Local loopback server

`src/server.mjs` serves the exact same files on `127.0.0.1` and exposes a minimal JSON API. The CLI creates a random session token and includes it once in the initial URL. Client JavaScript moves the token to `sessionStorage` and removes it from browser history.

The server checks:

1. exact loopback Host including the selected port;
2. the random session header on every API request;
3. exact Origin on every state-changing request;
4. content type and body size.

### GitHub adapter

`src/git/github.mjs` delegates authentication and API requests to the official GitHub CLI. It lists accessible repositories, retrieves viewer metadata and contribution activity, creates empty repositories, and runs repository preflight.

### Git executor

`src/git/executor.mjs` owns the only write path. It never changes the user's current working tree. It clones into a temporary directory, generates commits, checks the remote branch, pushes once, verifies the result and removes the temporary directory.

### Shared core

`src/core/` contains date calculations, IANA timezone conversion, plan validation, stable serialization and bitmap text. These modules import neither browser-only nor Git-only code and are used by both UI and executor.

## Data flow

```text
Hosted Pages                      Local studio
────────────                      ────────────
Browser editor                    Browser editor
  │ JSON export                    │ session-authenticated JSON
  ▼                                ▼
User-controlled file             127.0.0.1 server
                                   │
                          GitHub CLI + Git process
                                   │
                                   ▼
                           Temporary repository clone
                                   │ one normal push
                                   ▼
                                 GitHub
```

## Plan schema

A plan is a versioned JSON object containing a stable ID, title, timezone, range, optional GitHub identity/repository metadata and a `commitsByDate` map. Dates are `YYYY-MM-DD` strings and remain the permanent cell identifiers; visual week/row positions are derived.

## Design tradeoffs

- **No frontend framework:** approximately 371 cells do not require a framework, and removing runtime packages makes cloning and auditing easier.
- **No hosted GitHub integration:** this eliminates the need for a token backend, OAuth client secret and online account storage.
- **GitHub CLI:** account authentication, SSO and credential storage stay in a maintained official tool.
- **One push after generation:** faster and less rate-limit-sensitive than creating each commit through API calls.
- **Local noon timestamps:** avoids date rollover near daylight-saving transitions.
