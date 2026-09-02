# Security policy

## Supported version

Security fixes are applied to the latest release.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting feature in the repository's **Security** tab. Include the affected version, reproduction steps, expected impact and any proposed mitigation.

## Security boundaries

Contribution Canvas deliberately keeps GitHub authentication local:

- The hosted GitHub Pages site cannot read repositories or push commits.
- The local application delegates authentication to the official `gh` CLI.
- Browser code never receives a GitHub access token.
- The local HTTP server binds to `127.0.0.1`, validates the exact Host and Origin, and requires an unguessable session token.
- Git commands are spawned without a shell and the executor never force-pushes.

See [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) for the full threat model.
