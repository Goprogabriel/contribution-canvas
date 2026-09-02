# GitHub Pages deployment

The public application is fully static.

## Setup

1. Push the repository to GitHub.
2. Open **Settings → Pages**.
3. Select **GitHub Actions** as the source.
4. Ensure Actions can read repository contents and deploy Pages.
5. Push to `main` or run the Pages workflow manually.

The workflow runs `npm ci`, `npm run build`, uploads `dist/` and deploys it.

## Repository subpaths

All public assets and ES module imports use relative URLs, so a repository deployment such as:

```text
https://name.github.io/contribution-canvas/
```

works without a hardcoded base path.

## Custom domain

Configure the custom domain in GitHub's Pages settings. A `CNAME` file can be added to `public/` if the domain should be version-controlled; the build copies it automatically.

## Security properties

The Pages build contains no local API implementation, GitHub token, OAuth secret or repository write path. GitHub buttons remain locked and point users to local installation.
