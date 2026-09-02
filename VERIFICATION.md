# Verification Report

Generated: 2026-09-01T21:11:33Z

## npm install (lockfile-only)

up to date, audited 1 package in 160ms

found 0 vulnerabilities
\nPASS

## npm run check

> contribution-canvas@1.0.0 check
> node ./scripts/check.mjs

Checked 17 JavaScript files and project security invariants.
\nPASS

## npm test

> contribution-canvas@1.0.0 test
> node --test --test-reporter=spec

✔ validates real ISO dates and rejects impossible leap dates (1.027573ms)
✔ adds days across month and year boundaries (1.415268ms)
✔ calendar-year ranges include leap days exactly once (0.208795ms)
✔ rolling ranges contain exactly 365 inclusive dates (0.212912ms)
✔ contribution grid uses Sunday row zero and full week columns (9.035554ms)
✔ local noon keeps Copenhagen date on both sides of DST (7.912607ms)
✔ todayInTimeZone respects positive and negative offsets (0.636693ms)
✔ dry-run generates real local commits but leaves remote empty (182.663724ms)
✔ executor creates correctly attributed historical commits with one push and is idempotent (322.533639ms)
✔ executor aborts without graph-art push when the remote changes during generation (261.85395ms)
✔ accepts a valid plan and calculates exact total (18.727771ms)
✔ rejects dates outside the plan range and invalid counts (2.032932ms)
✔ rejects future execution dates while retaining them in draft validation (2.039272ms)
✔ enforces per-day and total safety limits (2.30281ms)
✔ stable serialization is key-order independent and round-trips (9.495079ms)
✔ process runner preserves metacharacters as a single argument (28.882888ms)
✔ process runner returns nonzero results only when explicitly allowed (39.847307ms)
✖ normalizes lowercase and common Danish letters (2.660521ms)
✔ 5x7 raster has deterministic dimensions and pixels (1.019771ms)
✔ 3x5 font fits into a vertically offset seven-row graph (0.189306ms)
✔ placement reports clipped pixels instead of silently wrapping (0.246893ms)
✔ collision scoring and best placement prefer empty dates (0.639567ms)
ℹ tests 22
ℹ suites 0
ℹ pass 21
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 831.0249

✖ failing tests:

test at tests/text.test.mjs:11:1
✖ normalizes lowercase and common Danish letters (2.660521ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  
  + 'BLABAR O'
  - 'BLABAER O'
          ^
  
      at TestContext.<anonymous> (file:///mnt/data/contribution-canvas/tests/text.test.mjs:12:10)
      at Test.runInAsyncScope (node:async_hooks:214:14)
      at Test.run (node:internal/test_runner/test:1047:25)
      at Test.start (node:internal/test_runner/test:944:17)
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:296:17) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 'BLABAR O',
    expected: 'BLABAER O',
    operator: 'strictEqual'
  }
\nFAIL
[3JTERM environment variable not set.
