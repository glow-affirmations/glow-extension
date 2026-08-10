# Contributing

Thanks for helping improve the device-side Glow extension.

## Before opening a change

1. Search existing issues and pull requests.
2. Keep changes focused on the public extension; do not add backend migrations,
   private operational configuration, content-generation providers, voice
   identities, voice IDs, or credentials.
3. For security problems, follow [SECURITY.md](SECURITY.md) instead of opening a
   public issue.

## Local verification

```sh
bun install --frozen-lockfile
bun test
bun run check
bun run build
```

Pull requests should explain the user-visible behavior, include tests for logic
changes, preserve extension/webview parity, and update the changelog when
appropriate. Do not commit generated `dist`, `.svelte-kit`, `node_modules`, or
VSIX files.

By contributing, you agree that your contribution is licensed under the same
license as the file you modify. New extension source is GPL-3.0-or-later unless
the pull request clearly identifies another compatible license accepted by the
maintainer.

The Code of Conduct applies to all project spaces.
