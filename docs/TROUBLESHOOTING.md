# Troubleshooting

## The local page says “Safe demo”

Start it through the CLI rather than opening `public/index.html` directly:

```bash
npm start
```

Use the URL printed by the terminal. If the browser was reloaded after the Node process restarted, reopen the newly printed URL because each process has a new session token.

## GitHub CLI is not authenticated

```bash
gh auth login
gh auth status
npm run doctor
```

For organization repositories, confirm SSO authorization in GitHub CLI.

## Repository preflight fails

Use a non-fork repository where the authenticated account has push access. Archived and disabled repositories are rejected. Branch protection may require a pull request and is therefore unsuitable for this direct graph-art flow.

## Dry-run succeeds but push fails

The remote may have changed, branch protection may reject direct pushes, or an organization policy may block the operation. No force-push fallback exists. Fetch the latest state, rerun preflight and repeat the dry-run.

## Commits are in the repository but not on the profile

Check:

- the receipt's author email and authenticated login;
- that commits are reachable from the default branch;
- that the repository is not a fork;
- that dates are in the profile period being viewed;
- private-contribution visibility settings;
- GitHub's processing delay of up to 24 hours.

## Text does not fit

Choose the `3×5` font, reduce spacing, shorten the text, change the range, or use the “Center” and “Avoid collisions” actions.

## A large plan is slow

Each pixel strength is an actual Git commit. Reduce the maximum or number of painted dates. Hosted-style execution limits are intentionally conservative: 100 per day and 5,000 total.
