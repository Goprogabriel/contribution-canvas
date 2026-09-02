# Contribution behavior

## Exact counts versus colors

The plan stores exact generated commit counts. GitHub maps contribution counts to relative levels for the displayed period, so the same count can receive different colors on different profiles or at different times.

## Date attribution

The executor sets both `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE` to 12:00 in the selected IANA timezone. Local noon is used to avoid accidental movement to an adjacent calendar date during daylight-saving transitions.

## Identity

The executor reads the authenticated GitHub user's numeric ID and login and uses:

```text
ID+login@users.noreply.github.com
```

Users should keep GitHub's private email behavior enabled or otherwise ensure the identity is attributable to the account.

## Repository requirements

A generated commit is expected to qualify only when GitHub can reach it from the default branch and the repository is not a fork. Private repositories may appear only as anonymized private activity depending on profile settings.

## Processing delay

A verified Git push does not imply immediate profile rendering. The local receipt proves repository state, while the “Recheck profile” action separately checks GitHub's contribution calendar. Allow up to 24 hours before treating a missing profile entry as a problem.
