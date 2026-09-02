# Local mode

## Starting

```bash
gh auth login
npm start
```

The CLI selects an available loopback port and opens the browser. Add `--no-open` or a specific `--port` when required.

## Authentication

Contribution Canvas never asks for a personal access token. `gh auth login` stores and refreshes authorization using GitHub CLI's normal mechanisms. The local backend invokes `gh api` and receives JSON results; it does not return credentials to the browser.

## Recommended workflow

1. Draw or import a plan.
2. Select a dedicated repository or create an empty one.
3. Run repository preflight.
4. Load current activity to spot collisions.
5. Run a dry-run.
6. Read the generated receipt.
7. Type the exact commit total.
8. Generate and push once.
9. Recheck the profile later if GitHub has not processed it yet.

## Receipts

Receipts are written with user-only permissions where supported:

```text
~/.contribution-canvas/receipts/<plan-id>.json
```

They include the repository, default branch, author identity, date range, exact counts, base SHA, final SHA and verification state. They contain no token.
