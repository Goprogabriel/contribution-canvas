# Contribution Canvas — local-first release

This source package contains one complete project:

- a polished static GitHub Pages website and interactive editor;
- the same editor unlocked as a local application;
- a loopback-only Node.js server;
- GitHub CLI integration without browser token storage;
- a conservative Git executor for transparent contribution graph art;
- bitmap text, brush and eraser tools, undo/redo, import/export and existing activity overlays;
- unit, server and real temporary-Git integration tests;
- CI, CodeQL, Pages and release workflows;
- English and Danish documentation.

## Start locally

```bash
npm install
npm start
```

Requirements: Node.js 20 or newer, Git, GitHub CLI, and an authenticated `gh` session.

## Verify

```bash
npm run verify
```

## Publish the website

Push the repository to GitHub, open **Settings → Pages**, select **GitHub Actions**, and run the included **Deploy GitHub Pages** workflow.

The hosted version intentionally cannot access Git or push commits. Those features are available only through the local loopback application.
