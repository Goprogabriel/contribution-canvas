# Security model and threat analysis

## Assets

- GitHub account authorization managed by `gh`.
- Repository integrity and default-branch history.
- The user's local filesystem.
- Non-secret contribution plans and generated receipts.

## Trust boundaries

The hosted website is untrusted for privileged work and contains no privileged work. The local browser is less trusted than the local Node process. GitHub credentials remain behind the GitHub CLI boundary; the Node process receives only CLI command results.

## Threats and controls

### Token theft through frontend JavaScript

**Control:** no command retrieves or returns `gh auth token`. The browser calls a narrow local API and receives only viewer/repository/activity data.

### DNS rebinding or drive-by requests to localhost

**Controls:** bind to `127.0.0.1`, require the exact `127.0.0.1:port` Host, use a random 256-bit session token and require the exact Origin for mutations.

### Session token leaking through the address bar

**Controls:** the token is used in the initial URL only, immediately moved to `sessionStorage`, and removed with `history.replaceState`. The local server sets `Referrer-Policy: no-referrer` and loads no third-party scripts.

### Cross-site scripting

**Controls:** restrictive Content Security Policy, no third-party scripts, no user-provided HTML insertion, text-only rendering and no remote analytics. Dynamic layout uses inline style properties, so `style-src` permits inline styles; `script-src` remains self-only.

### Shell or argument injection

**Controls:** all child processes use explicit argument arrays with `shell: false`. Repository names, plan IDs, dates and strengths are strictly validated. Commit messages are written to a file rather than interpreted by a shell.

### Malicious or oversized plans

**Controls:** versioned schema validation at browser, server and executor boundaries; maximum date range, per-day count, total count and HTTP body size; future-date rejection before execution.

### Accidental history rewrite

**Controls:** no force flag anywhere, isolated clone, default-branch preflight, original remote SHA capture, immediate remote comparison before push and Git's ordinary fast-forward enforcement.

### Remote changes during generation

**Control:** abort if the remote SHA differs before push. A change after that check causes the normal push to be rejected rather than overwritten.

### Partial failure

**Control:** all commits are local until the final single push. A process failure before that point leaves the remote unchanged. The temporary directory is removed in a `finally` block.

### Duplicate plan execution

**Control:** each generated activity line contains the stable plan ID. The executor checks the cloned log and returns an `already-applied` receipt without creating duplicates.

### Misleading generated history

**Controls:** transparent repository README, `chore(graph-art)` subjects, plan ID trailer, `Generated-By` trailer, UI notices and project documentation.

### Dependency compromise

**Controls:** zero production dependencies. CI and GitHub-hosted workflows still use marketplace actions and should be reviewed and pinned according to the adopting repository's policy.

## Remaining risks

- A malicious local user or compromised machine can control the Node process, Git binary or GitHub CLI.
- GitHub organization rules, SSO, branch protection and server-side policies may reject a valid local operation.
- Browser extensions can observe page content, including the non-GitHub local session token.
- Very large accepted plans consume CPU, disk and time despite configured limits.
- GitHub alone decides profile attribution and rendering.
