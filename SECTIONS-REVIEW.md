# Bill Layout Designer — Historical Note

> This file previously held a review of the **Bill Layout Designer v2**
> (block architecture, y-cursor PDF engine, canvas preview). That rewrite
> has been **removed from the codebase** — see below. This note is kept so
> future readers understand what happened and why.

## What the v2 rewrite was

Commits `9cf7613..67796de` replaced the classic invoice designer with a
block-architecture rewrite (~6,000 lines):

- `lib/billBlockModel.js` — block model + variable registry + template resolver
- `lib/execBlockTemplate.js` — y-cursor PDF engine
- `lib/billCanvasPreview.js` — canvas preview in PDF coordinates
- `lib/billTemplateResolver.js`, `lib/designerSnap.js`
- bundled `template/billTemplates/default1.json` / `default2.json`
- five test suites (282/282 at the time of the review)

## Why it was replaced

Review (2026-09-16) found the v2 designer unusable as an upgrade:

1. **Zoom was not real zoom** — the canvas transform never applied the zoom
   factor, so zooming cropped/padded instead of scaling.
2. **UI elements were not draggable** — flow layout only; the free drag-move
   of the classic designer was gone.
3. **Starter templates misrepresented** Default 1 / Default 2 — they did not
   match what the engine actually printed.
4. **Maintainability regressed** — ~6,000 lines for what the classic designer
   already did; against the maintainer's constraint that new code stay small
   and reviewable.

## What replaced it

Commits `9d0017d..4907d23` (restore → classes → engine → shell → undo/redo →
preview → v2 deletion):

- **Legacy designer + engine restored verbatim** from `d1f36c0` — free
  drag-move, real zoom via coordinate re-multiplication, resize dots,
  partitions, table editor with sumup, save/load.
- **Element class library** (`lib/billElementClasses.js`, ~900 lines) —
  `Element` superclass and `Header` / `Body` / `Footer` / `Section` / `Field` /
  `Table` subclasses. Classes keep x, y and serialize to the legacy JSON
  shape, so the engine prints them unchanged.
- **Starter picker** — Blank / Three Sections / Default 1 / Default 2, built
  from the classes at the exact legacy hardcoded coordinates.
- **Kept from v2**: the modern 3-pane designer shell (palette / workspace /
  properties) and the ~75-key variable registry
  (`lib/billVariableRegistry.js`) with grouped picker + free-text
  `billMeta` keys. The engine's feild rendering resolves through the registry
  with a generic `billMeta[key]` fallback.
- **New**: full section shapes (rounded / circle / ellipse) in designer and
  engine; full undo/redo history (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, Esc cancels
  a drag); dry-run **Preview** that renders the current design to a temp PDF
  with a synthetic sample bill and displays it via pdfjs-dist.

The plan that drove the restructure and the 12-point verification list live
in the session plan (`hey-first-start-off-valiant-aho.md`).
