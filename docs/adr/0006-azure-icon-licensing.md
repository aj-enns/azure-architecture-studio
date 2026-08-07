# ADR-0006: Bundle official Microsoft Azure icons and disclose in Terms

- **Status:** Accepted
- **Date:** 2026-08-06
- **Deciders:** Project owner (CSA), Copilot
- **Related:** Plan Phase 0 (task 0.8)

## Context

The palette needs recognizable Azure service icons. Microsoft publishes an official
**Azure Architecture Icons** set, but it carries usage terms: the icons may be used to
illustrate architectures, must not imply Microsoft endorsement, must not be modified to
misrepresent, and are subject to Microsoft's icon terms of use. Because this project is
**open source and redistributed**, bundling third-party assets is a deliberate legal choice,
not just a technical one.

## Decision

We will **bundle the official Microsoft Azure Architecture Icons** in the repository (under
`apps/web/src/assets/azure-icons/`) and **clearly disclose the terms**:

- A `TERMS.md` / `NOTICE` (and an icon-specific `LICENSE-ICONS`) stating the icons are
  © Microsoft, used under Microsoft's Azure Architecture Icons terms, with **no Microsoft
  endorsement implied**, and that users must comply with those terms.
- An in-app "About / Terms" surface repeating the attribution.
- The icon assets are excluded from Prettier/format tooling.

This corresponds to "Option C" from the planning discussion (bundle + disclose), chosen
over fetch-on-install or an open substitute set, for the best out-of-the-box UX.

## Alternatives considered

- **Option A — don't bundle; ship a fetch/download script** so self-hosters pull the
  official set themselves. Cleaner legally, worse first-run experience.
- **Option B — use an open/generic icon set.** Avoids MS terms entirely but loses the
  authentic Azure look that ARB users expect.
- **Option C — bundle + disclose (chosen).** Best UX; accepts the obligation to surface the
  Microsoft icon terms prominently and keep attribution intact.

## Consequences

- Great out-of-the-box experience: icons work immediately with no extra setup.
- We take on an obligation to keep `TERMS.md`/`NOTICE` accurate and visible, and to not
  modify icons in ways that misrepresent Microsoft.
- Downstream redistributors inherit the same Microsoft icon terms; this is documented so
  they are aware. If Microsoft's terms change, this ADR may need a superseding decision.
