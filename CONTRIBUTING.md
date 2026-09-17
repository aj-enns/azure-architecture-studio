# Contributing

Thanks for your interest in improving Azure Architecture Studio!

## Development setup

```bash
pnpm install
pnpm dev          # web + api together
```

Useful scripts (run from the repo root):

| Command             | What it does                                  |
| ------------------- | --------------------------------------------- |
| `pnpm build`        | Build all packages and apps                   |
| `pnpm test`         | Run unit tests (vitest) across the workspace  |
| `pnpm typecheck`    | Type-check without emitting                   |
| `pnpm lint`         | Lint all packages                             |
| `pnpm format`       | Format with Prettier                          |
| `pnpm format:check` | Verify formatting                             |

## Ground rules

- **TypeScript everywhere**, strict mode. Keep the diagram model in
  `packages/shared` as the single source of truth — don't fork its types.
- Validate all untrusted input (imported files, AI output) with the shared Zod
  schema at the boundary.
- Keep secrets server-side only. Never ship Azure OpenAI keys to the browser.
- Never include customer data or private architecture details in fixtures,
  screenshots, issues, or pull requests.

## Architecture decisions

Significant decisions are recorded as ADRs in [docs/adr/](docs/adr/README.md).
ADRs are immutable — if a decision changes, add a new ADR that supersedes the old
one rather than editing it. Start from
[the template](docs/adr/0000-adr-template.md).

## Third-party assets

Bundled Microsoft Azure icons are governed by Microsoft's terms — see
[TERMS.md](TERMS.md). Don't modify the icons in ways that misrepresent Microsoft.

## Pull requests

- Keep changes focused; one concern per PR.
- Add/adjust tests for behavior changes.
- Ensure `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and
  `pnpm build` pass before opening a PR.

Report suspected vulnerabilities privately using the process in
[SECURITY.md](SECURITY.md), not through a public issue.
