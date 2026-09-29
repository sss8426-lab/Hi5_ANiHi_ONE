# Career Work Visuals Review

## Scope

- Approved layout: task title and explanation, wide task-matching educational
  artwork, then the existing corresponding artist/reference information.
- 35 careers, three tasks each, 105 independently generated local WebP assets.
- Existing occupation cards and overview images are unchanged.
- Existing artist data files are unchanged. The viewer retains all assigned
  artists, biographies, notable works, links, uses and portfolio checklists.
- No application API, authentication, authorization, database, upload, package
  dependency or lockfile changes.

## Self-Review

- Images are keyed by career ID and task index and checked against the title.
  Artist photographs are no longer used as task illustrations.
- Generated examples are explicitly labeled and separated from real artists.
  Video tasks are represented as still-frame examples, not working video players.
- Asset provenance records prompts, hashes, dimensions and optimized byte counts.
  No machine-local source paths or credentials are published.
- Artwork is not cropped. A single scrolling dialog keeps the full footer
  accessible. Desktop and mobile layouts have no horizontal page overflow.
- Text and URLs are escaped; external reference links allow only HTTP(S) and
  retain `noopener noreferrer`.
- Previous/next limits, direct task opening, keyboard navigation, Escape,
  focus restoration and horizontal swipe were checked. Vertical scroll is not
  mistaken for a next-image gesture.
- A missing image preserves the task and artist content and the slide controls.
- Versioned entry scripts, CSS and image hashes avoid stale mixed viewer assets.

## Verification Boundary

Local build, TypeScript, the complete 670-test suite, targeted tests and asset
verification passed before integrating main's subsequent curriculum changes. The local
browser runner checks 258 cases across seven viewport widths and produces
`outputs/career-work-viewer/report.json` and screenshots. Browser API responses
are synthetic; no live student records or production data are mutated.

The integrated-branch test-suite result, PR checks, deployment status and any
authenticated production verification are recorded in the PR/release report after they complete.
Local browser or asset HTTP checks alone are not proof of authenticated production
behavior. Original generated PNGs remain available locally for future revisions.
