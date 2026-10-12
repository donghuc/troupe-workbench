# Contributing

Thanks for looking. Troupe is a one-person project built around one workflow, so the bar for changes is "does this make the app better for someone who runs several agent CLIs against real project folders every day" — not feature count.

## Before you start
- Open an issue first for anything beyond a bug fix, so we agree on the shape before you spend time on it. Product direction is deliberately conservative: new tools and integrations are usually declined unless they remove a daily pain.
- macOS on Apple silicon is the only supported platform. Windows/Linux work is welcome as a discussion, not as a drive-by PR.

## Working on the code
```bash
npm install
npm run dev      # app with hot reload; restart for main-process changes
npm run check    # typecheck + tests + knip — must pass before a PR
```
Read [CLAUDE.md](CLAUDE.md): it holds the architecture rules that are easy to break and the UI conventions. Those apply whether or not you use an agent to write the code.

## A good pull request
- One change per PR, with a unit test where the logic is pure.
- A line in `CHANGELOG.md` under `[Unreleased]`, written for users ("Images no longer break the text flow"), not for engineers.
- No new runtime dependency without saying why in the PR.
- No changes to how the app writes the vendor CLIs' config files unless the PR explains exactly which file and key.

## Releases
The maintainer cuts releases: bump `package.json`, rename `[Unreleased]`, tag `vX.Y.Z`. The `release` workflow builds the unsigned arm64 dmg and attaches it to the GitHub Release. Development happens in a private working repo; this repository receives one squashed commit per release, so merged contributions appear in the next release commit and are credited in the commit message and CHANGELOG rather than as separate commits.

By contributing you agree that your contributions are licensed under the Apache License 2.0 that covers the project.
