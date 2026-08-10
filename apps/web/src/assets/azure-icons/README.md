# Azure Architecture Icons

Place the official **Microsoft Azure Architecture Icons** (SVG) here. Filenames
should match the `icon` slugs used in
[`packages/shared/src/catalog.ts`](../../../../packages/shared/src/catalog.ts),
e.g. `storage-account.svg`, `container-app.svg`, `azure-openai.svg`.

The app auto-loads every `*.svg` in this folder at build time (via
`import.meta.glob` in [`src/lib/icons.ts`](../../lib/icons.ts)) and renders it by
slug. Any service without a matching SVG falls back to a generic Lucide glyph, so
you can add icons incrementally — no code changes required.

These assets are **© Microsoft** and used under Microsoft's icon terms — see the
repository [TERMS.md](../../../../TERMS.md). They are intentionally **not**
covered by this project's MIT license.

Download the official set:
<https://learn.microsoft.com/azure/architecture/icons/>

This folder is excluded from Prettier formatting (see `.prettierignore`).
