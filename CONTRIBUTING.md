# Contributing to Idiot Box

Thanks for helping out. This page covers the shortest path from an idea to a merged change.

## Where to put what

| You want to... | Use |
| --- | --- |
| Report a bug or request a feature | [Issue forms](https://github.com/TheWonderlandStudio/Idiot_Box/issues/new/choose) |
| Ask a question, share something you built, float an idea | [Discussions](https://github.com/TheWonderlandStudio/Idiot_Box/discussions) |
| Fix something or add a feature | Pull request (guide below) |
| Report a security problem | [SECURITY.md](SECURITY.md) — never a public issue |

## Development setup

Requirements: Node.js (LTS) and npm.

```bash
npm install
npm start
```

`npm start` builds the renderer, preload and settings bundles, then launches the app.

There is no file watcher yet, so:

- Renderer/preload changes (`electron/renderer/**`, `electron/preload/**`) → run `npm run build` again and reload the app.
- Main process changes (`electron/main/**`) → restart the app (`npm start`).

## Before you open a PR

- `npm run build` passes.
- Main process changes: `node --check electron/main/index.js`.
- User-visible strings stay in English (code comments can be anything you like).
- No secrets, keys or tokens in the diff — CI and reviewers will catch them, but please don't.

The PR template repeats this checklist.

## Commit messages

Conventional style, matching the existing history:

```
feat(editor): DB + markdown side previews
fix(terminal): pty resize on panel collapse
chore(release): 0.1.25
```

## Scope

Small, focused PRs get reviewed fast. Bigger changes — open a Discussion first so we can agree on the direction.

## License

By contributing you agree that your contribution is licensed under the repository's [GNU GPL v3](LICENSE) license, the same as the rest of the project.
