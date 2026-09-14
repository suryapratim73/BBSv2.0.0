# Bill Layout Designer v2 — Sections + Structural Template + Drag-Resize Review

Review companion for the Header / Body / Footer / Custom Section work, the
**pre-built structural template**, **drag-to-resize + alignment grids**, the
**designer merge** (2026-09-14: the old designer's shell rebuilt on the v2
model as `template/js/billLayout.js`; the interim `billBlockDesigner.*` files
are retired), the **template picker** (2026-09-14: Blank / Three Sections /
Default 1 / Default 2 starting layouts in the workspace bar) and the
**canvas preview** (2026-09-15: the DOM preview is replaced by a canvas
renderer, `lib/billCanvasPreview.js`, that paints in the PDF engine's own
coordinates — same box math, same column cells, same partition lines, same
clipping, same footer anchoring) and **field width** (2026-09-15: every block
has a `width` — % of its cell, default 100 — editable via a right-edge drag
handle on the canvas and a Width % slider in the properties panel). Everything below
is keyed to file + line so you can jump straight to the code.
**Test status: 282/282 passing (14 suites).**

---

## 1. What was asked

- An invoice must have three sections — **Header**, **Body**, **Footer**.
- Additional **custom sections** with custom shapes (rectangle, rounded, circle, ellipse).
- Sections are **containers**: fields, tables etc. live *inside* them and **inherit the
  container's font**.
- Partitions (divider lines) inside sections, like the old designer.
- **A new template must come pre-built**: Header (30%) / Body (40%) / Footer (30%)
  with the mandatory invoice fields already inside — seller name/address/GST,
  customer name/address/GST, bill no, date, items table, totals. Fields may be
  removed or moved, but the three sections stay in that order.
- Non-zero default spacing: **0.5rem (8pt)** margins between sections and page
  margin, non-zero section padding. User can change all of them.
- **Drag-to-resize** and **alignment grids** (parity with the old designer).
- **The merge**: the old designer's shell — 3 panels (palette left, canvas,
  properties right), icons on all buttons, modern look — rebuilt on the v2
  model, with the old designer's features ported: double-click drill-down,
  corner-dot section resize, gap + centre guides, the old keyboard bindings
  (cleaned of the Ctrl+Numpad double-fire quirk), and the **full v2 VARIABLES
  registry** (~60 keys, grouped) instead of the legacy ~25 frozen fields.
  `billBlockDesigner.*` is deleted; `billLayoutDesigner.js` loads `billLayout`.
- A report md file (this file) to ease code review.

## 2. How to use it in the designer

1. Open the designer. A new template **starts pre-built**: Header (30%) with the
   seller/customer fields + bill no/date, Body (40%) with the items table, Footer
   (30%) with totals, "Thank You!" and signatory — `createInvoiceTemplate()`.
2. The left palette has a **Sections** group above Blocks
   (`template/html/billLayout.html:14-29`).
3. **Select a section first**, then add blocks — they go *inside* it and inherit the
   section's font family/size/color (`template/js/billLayout.js:660-677`).
   If nothing is selected, blocks are added to the selected block's section, else the page.
   **Double-click** any element to drill into it; the **Quick Variable** palette lists
   the full v2 registry grouped, plus a free-text box that resolves any billMeta key.
4. Select a section and use its properties panel:
   - **Shape**: rectangle / rounded / circle / ellipse (`lib/billBlockModel.js:1032`)
   - **Fixed Height**: `>0` = fixed box that **clips** children to the shape
     (required for circle/ellipse clipping; Header/Body/Footer use it for the zones)
   - **Partitions**: divider lines — direction (col/row), position %, line width
   - Section name shows as a small chip on the canvas (design-time only).
5. **Header/Body/Footer are structural**: you can edit, remove or reorder *fields
   inside* them, change height/padding/margin — but the sections themselves cannot
   be reordered, deleted or duplicated (model enforces it; the UI hides the
   move/delete buttons and toasts on locked keyboard actions).
6. **Drag-to-resize**: hovering a block shows a dashed accent outline; the
   selected section shows a **grip pill** on its bottom edge and four **red
   corner dots** on its edge midpoints
   (the old designer's adj-points): bottom = fixed height, top = the gap above
   (margin.top, bottom edge pinned), left/right = the horizontal margins. Drag a
   table column divider in the header row to resize that column (the neighbour
   gives up width; the pair's sum is what the PDF engine normalizes against, so
   preview == print; a column flagged **"Use remaining space"** — the legacy
   *sumup* — absorbs whatever the fixed columns leave, and freezes into a real
   width on first drag). A live bubble shows the current size; **Esc cancels**
   mid-drag. All hit-testing runs against the canvas layout records, not DOM
   elements.
7. **Alignment grids**: the page shows a 0.5rem grid (8pt minor / 40pt major),
   toggled from the workspace bar (grid button, default on). While dragging, the
   pointer snaps to grid lines and to guide lines on both axes — page edges,
   content box, page centre (a full crosshair when centred) and neighbouring
   section edges — snapped guides render as dashed accent lines with a
   `586 pt — section bottom`-style label, and a dark **gap pill** shows the
   distance to the nearest neighbour edge within 10pt.
8. **Keyboard** (old designer bindings, minus the double-fire): `↑`/`↓` nudge the
   selected block's top gap (flow layout's stand-in for free y), `Ctrl+N` adds a
   section, `Ctrl+Numpad+`/`Ctrl+Numpad−` resize the selected section's height
   ±1pt, `Ctrl+Shift+=`/`Ctrl+Shift+-` zoom (40%–120%), `Delete`/`Backspace`
   removes, `Esc` deselects. Structural sections answer locked actions with a
   toast instead.
9. Header and Footer repeat on **every printed page**, like the old designer's
   per-page header/footer.
10. **Columns (row-wise flow)**: a section property (default 1) — set **Columns
    (2+)** in a section's properties panel and its fields flow in rows of N
    equal-width cells (e.g. Bill No + Date side by side). Rows are laid out
    identically in the canvas preview and the PDF engine — the canvas
    `flowChildren` mirrors the engine's per-row cursor math (each cell renders
    from the row top, the row advances by its tallest cell) — so print ==
    preview; empty fields collapse to leave their cell blank. Cells are chunked
    relative to the page-break resume point, so a row interrupted by a break
    re-forms around the broken field on the next page. The canvas `flowChildren`
    and the engine's `renderChildren` are separate code but pin each other via
    the shared tests (cell x/y math asserted on both).
11. **Template picker** (workspace bar, beside zoom/grid — a dropdown after the
    grid button): starts a new design from one of four layouts — **Blank**
    (an empty page; add Header/Body/Footer from the palette and they slot into
    their canonical positions), **Three Sections** (the pre-built
    `createInvoiceTemplate()`), **Default 1** / **Default 2** (the bundled
    `template/billTemplates/default1|2.json` section-based recreations of the
    legacy hardcoded layouts — boxed bands and their vertical/horizontal
    divider lines restored as section `partitions` — loaded over IPC
    `read-bill-template`).
    Switching asks first (`confirm-replace-template`, Replace/Cancel — the
    design is replaced wholesale); opening a file from disk shows the picker
    with no selection, and File → New returns it to Three Sections. The saved
    result is a normal v2 template (Save dialog on first save, prints through
    the v2 engine).
12. **Field width**: every block has a **Width %** property (default 100 — the
    full cell). Select a block (any non-section: text, variable, image, table,
    totals) and a small vertical **handle on its right edge** appears — drag it
    and the right edge follows the pointer while the left edge anchors to the
    cell's left edge (a live bubble shows the %, **Esc cancels**). The same
    property is editable as a **Width % slider** in the properties panel (the
    panel is schema-driven — the entry renders from `COMMON_PROPS_SCHEMA` with
    zero designer JS). Width is a % **of the block's own cell** — inside a
    columned section that's the column cell, so the two compose. Align
    (left/center/right) positions the narrower box inside its cell; dragging a
    center/right-aligned block converts it to left-aligned on first movement
    (Esc restores both width and align). Width applies to sections too (a
    half-width, right-aligned Footer band), though sections keep their corner
    dots for margin/height resize.

## 3. Architecture map

### Model — `lib/billBlockModel.js` (shared renderer + main, no electron/pdfkit at top level)

| Line | What |
|---|---|
| `~493` | `COMMON_PROPS_SCHEMA` — the shared prop list every block gets, incl. the new **`width`** entry (`Width %`, `type: "range"`, default 100, 1–100) — the props-panel slider renders from it with zero designer JS |
| `498` | `PAGE_PROPS_SCHEMA` — page margin prop defaults to **8pt** per side |
| `952` | `clampColumns(value)` — section columns clamped to 1..6 (garbage/0/negative → 1) |
| `~991` | `effectiveWidthOf(block, availableWidth)` / `alignedLeftOf(block, cellLeft, availableWidth)` — the shared field-width math: `width` % (default 100, clamped 1–100) of the available cell width; align left/center/right positions the box inside the cell. The engine, the canvas preview and the designer's width drag all use it, so preview == print == drag |
| `981` | `BillSection extends BillBlock` — base for all section types |
| `986` | `propsSchema`: name, shape, cornerRadius, height, **columns**, partitions |
| `1009` | `applyTypeProps`: **padding defaults 8**, **margin defaults 8pt/side**, **applyBorder defaults true** (0.5rem everywhere; a fresh section is visible), **columns clamped**, partitions normalized, children built via `BillBlock.fromJSON` |
| `1046` | `measure()` returns `null` — the engine measures sections, not the block |
| `1052` | `isEmpty()` returns `false` — a section renders even with no children |
| — | The model has **no DOM code** — the designer preview is painted on canvas by `lib/billCanvasPreview.js` (the pre-canvas `renderDOM`/`applyDOMStyles` were deleted) |
| `1058` | `HeaderBlock` / `BodyBlock` (`1064`, seeds a `TableBlock` when constructed empty) / `FooterBlock` (`1078`) / `SectionBlock` (`1084`) |
| `1091` | `applyBlockContainerMixin` — `addBlock/getBlock/moveBlock/removeBlock`; children added without an explicit font inherit `fFamily ?? font.family ?? "Times-Roman"` |
| `1123` | `BillBlock.TYPES` registry includes the four section types |
| `1144` | `STRUCTURAL_TYPES = ["header", "body", "footer"]` |
| `1146` | `BillPage` constructor — page `margin` defaults **8pt/side**, explicit values win per-side |
| `1200` | `addBlock` structural branch: a structural type **throws if it already exists** (`A Header section already exists.`), and is inserted at its **canonical slot** — header → 0, body → after header (or 0), footer → end |
| `1231` | `moveBlock`: refused when either the moved or target block is structural — the three zones are pinned |
| `1249` | `removeBlock`: **no-op** for structural sections — they are permanent |
| `1266` | `createInvoiceTemplate()` — the pre-built template (see §4.2) |

### Snap geometry — `lib/designerSnap.js` (pure, no DOM/electron — Jest-pinned)

| Line | What |
|---|---|
| `16` | `snapY(y, targets, opts)` — alignment lines win within **5pt**, else the grid snaps within **3pt**; returns `{ value, guide, label, type }` (guide `null` = nothing snapped). Axis-agnostic — the designer feeds x-axis targets through it too |
| `59` | `resizeColPair(a0, b0, deltaPct, min=2)` — shifts width between two adjacent table columns keeping their combined share (what the PDF normalizes against); degenerate pairs return unchanged |
| `75` | `effectiveColWidths(cols)` — the rendered widths the engine shows: a `sumup` column absorbs whatever the fixed columns leave (minimum 1%); the designer's column drag starts from these, not the stored widths |

### Engine — `lib/execBlockTemplate.js` (single generator, many layouts)

| Line | What |
|---|---|
| `41` | `main()` — walks captions; one `renderPage` per caption |
| `76` | `renderPage` — page border, default font, **footerReserve** (exact pre-measured footer height — 30% zone anchors bottom-up), `drawFooters` closure, main walk with `from: blockStart` / `contPath: childStart` split |
| `111-148` | Top-level footer sections are **bottom-anchored on every page**; the main walk skips them (`231`), `drawFooters` stacks them bottom-up; `onPageEnd` is awaited before **every** page break |
| `202` | `renderChildren` — the shared y-cursor walk (page + sections). `from` = where to start iterating; `contPath` marks the resume target; `pendingRowStart` is consumed **once** by the first table or continuation-target section. **Columns**: `clampColumns(layout.columns)` > 1 turns the walk into rows of N equal cells — cells chunked *relative to `from`* (a break mid-row re-forms the row around the broken child on the next page), each cell renders from the row top, the row advances by its tallest cell (1 column degenerates to plain flow exactly) |
| `375` | `renderSection` — margin → box → children → partitions → border. Passes `columns: block.columns` into the child walk (`448`). Key mechanics: |
| | • **Shape path** (`shapePath`) builds per use and serves clip, background fill and border stroke (pdfkit shape methods are pure path builders) |
| | • **Fixed height** → frame drawn **first** (`494`), then `save/clip/children/restore` so the clip can't halve the border stroke; on page break inside a clip the `restore()` is **skipped** — an unmatched `q` at page end is safe, an unmatched `Q` on a new page corrupts it |
| | • **Fixed non-repeat sections bound their children**: `bottomY = boxTop + boxHeight − pad` (`454`) — the clip line *is* the page-break line, so the body's table breaks exactly at the body border on every page |
| | • **On break, fixed sections still draw frame + partitions for the zone rendered on this page** — a bordered body keeps its border on break pages |
| | • **Auto height** → children flow, box = measured/actual height |
| | • **Background** painted *under* children via exact pre-measure (`428`) |
| `542` | `sectionBoxHeight` — fixed height, else `measureChildren + 2×padding` (numeric padding; deterministic → safe to reserve footer space) |
| `564` | `drawPartitions` — col/row divider lines from legacy `partitionObj` |
| `588` | `measureChildren` — mirrors the render cursor math exactly (table = thHeight + rows × (lineHeight + 2×rSpacing)), recursing into nested sections; **columned sections measure row-wise** (cell = `contentWidth / cols`, row height = tallest cell) so a background box pre-measures the same rows the render pass draws |
| `758` | `renderTable` — page-break sites both `await onPageEnd()` **before** `addPage()`, then re-enter `renderPage` with `breakPage(row)` |

**Continuation model** (the tricky part — read this before changing it):

- `childStart` is a **path** of child indices, e.g. `[1, 0, 2]` = top-level block 1 is a
  section, resume at its child 0 (a section), resume at *its* child 2. `absPath` is the
  same path including the section's own top-level index as element 0.
- Page-level break opts: `{ blockStart: 0, childStart: [...absPath, childIdx], rowStart }`.
  **`blockStart` is always 0** (`762`) so header-zone blocks repeat on continuation
  pages; `childStart` alone marks the resume point. Section-level `from` = `contPath[0] ?? 0`
  so already-drawn children are skipped.
- `rowStart` rides along as `pendingRowStart` and is consumed by exactly one consumer —
  the first table *or* the continuation-target section — so a header table can never
  steal a body table's row state.
- Header/Footer (`isRepeat`) render with `bottomY: Infinity` — they never page-break.

### Canvas preview — `lib/billCanvasPreview.js` (pure, no DOM/electron — Jest-pinned)

The designer's page is a `<canvas>` painted in **pt units** (DPR × zoom
transform in the designer). `layoutPage` mirrors the engine's cursor math one
to one — it builds per-block **layout records** (id, kind, depth, box, block,
`avail` — the block's own cell `{x, w}` the width % is relative to, and
`colX`/`headerY`/`thHeight`/`rowHeight` for tables) used for hit-testing,
and `renderPreview` paints page + blocks + chips + selection chrome + guides.

| Line | What |
|---|---|
| `16` | `PAGE_SIZES` — a4/letter, same numbers as the engine |
| `111` | `tableRowHeight` — `fSize × 1.2 + 2 × rSpacing`; `tableHeight` = header + 1 sample row |
| `123` | `measureChildren` / `measureSection` — engine's `measureChildren`/`sectionBoxHeight` math (fixed height, columns, tables, images, 0.3×lh totals gap) |
| `422` | `drawSection` — engine order: degenerate-margin branch → background pre-measure → **fixed: frame first, `save/shapePath/clip`, children, partitions, `restore`** → **auto: children, `boxHeight = max(innerY + pad − boxTop, 1)`, partitions, frame** |
| `501` | `flowChildren` — the engine's `renderChildren` rows-of-N-cells walk (cell from row top, row advances by tallest cell); each child gets `childW = effectiveWidthOf(block, cellWidth)` + `childLeft = alignedLeftOf(...)` and its record carries the parent `cell` as `avail` |
| `540` | `layoutPage` — top-level walk (each block width/align-positioned in the content box), then footers bottom-anchored exactly like `drawFooters`: `fw = effectiveWidthOf(f, contentWidth)`, `h = measureSection(f, fw); startY = fy − margin.top − h; fy = startY − margin.bottom` |
| `586` | `recordAt` — deepest record at a point (ties: smallest area) |
| `660` | `drawGuide` — dashed accent guide + label pill; `page centre` snaps draw the full-page crosshair |
| `695` | `drawSelection` — 2pt accent outline, bottom grip pill (28×3pt), four red dots ±5pt inside the edge midpoints; a selected **non-section** block instead draws the right-edge **width handle** (3×16pt on the box's vertical centreline); hover outline dashed |
| `748` | `renderPreview(ctx, page, opts)` — white ground, page border, optional grid (8/40pt), blocks, chips, selection/hover, guide, bubble/gap pill; returns the layout |

### Designer — `template/js/billLayout.js` + html/css (the merged designer)

| Line | What |
|---|---|
| `63` | `let page = createInvoiceTemplate()` — the designer starts with the pre-built invoice (reset at `1085` too) |
| `118` | `paint()` — sizes the canvas backing store (DPR × zoom), `setTransform(dpr, …)`, then `renderPreview` into pt space; `lastLayout` = the returned records (hit-testing source) |
| `140` | `renderAll` — re-sizes the page frame, clears overlays (guide/bubble/gapPill), calls `paint()`; every model mutation goes through it, so the canvas is always in sync |
| `170` | `ptFromEvent` — pointer → pt via `getBoundingClientRect() / zoom` |
| `190` | `handleAt(pt)` — hit-testing on `lastLayout` records: selected-section dots (r=7pt around the four dot centers) → the selected non-section block's **width handle** (±5pt around the box's right edge, ±8pt around its vertical centreline) → section grip strips (bottom 9pt of every section box) → table column dividers (±5pt around `colX` in the header band) → `recordAt` deepest record → null |
| `235` | `handleCursor(h)` — pointer cursor per handle (dots/width → ew-resize, grip/top/bottom → ns-resize, col → col-resize) |
| `250` | `snapTargets` — x + y alignment lines (page edges, content box, centre, neighbour section edges) from `lastLayout` records, snapshotted at dragstart so targets don't chase the pointer |
| `277` | `startSectionResize` / `startDotResize` (`299`) / `startColResize` (`328`) / `startWidthResize` (`347`) — snapshot drag state (top dot pins the bottom edge, auto-height converts to fixed at rendered height; col snapshots effective widths + stored state so Esc restores sumup flags exactly; width snapshots the block's cell from the record's `avail`, its start box and its width + align) |
| `373` | `onDragMove` — section (height, y-snap), dot (margins + top-dot height compensation, x-snap for left/right), col (materializes a sumup pair into real widths on first move, then `resizeColPair`), width (right edge follows the pointer, left edge anchors to the cell's left edge — a center/right-aligned block converts to left on first movement, folding the left-edge jump into the start width so the handle stays under the pointer; `pct = (w + mL + mR) / cellW`, clamped 1–100); mutates the model → `renderAll()` → sets the overlay |
| `459` | `onDragKey` — Esc restores the dragstart state for all four kinds (width restores both width and align) |
| `490` | `showBubble` / `drawGuides` (`500`) / `drawGapPill` (`511`) — build the overlay objects (`bubble`, `guide {snapped, axis}`, `gapPill`) that `renderPreview` paints; gap pill = nearest neighbour edge within 10pt in the drag direction |
| `535` | `selectBlock` — selection drives the props panel + context hint |
| `550` | `findBlock(id)` — recursive search through sections |
| `566` | `getParentOf(id)` → `{ container, index }` used by move/delete |
| `590` | `inheritFromSection(block, section)` — copies font family/size/color on add |
| `598` | `cascadeSectionFont(section)` — font prop change pushes down to all descendants |
| `614` | `updateContextHint` — structural sections get: *"X is a fixed section — edit or remove its fields, but the section itself stays in place."* |
| `641` | `renderProps` — **schema-driven** (every `propsSchema` entry renders automatically, so a section's new **Columns** input needs zero designer JS); move/delete action buttons hidden (`blockActions.classList.toggle("hide", locked)`) for structural sections |
| `845` | `renderListEditor` — list items support **checkbox fields** (the table column "Use remaining space" flag); checking a sumup column clears the flag on every other column (one absorb-the-rest column at a time) |
| `979` | `fillVariablePicker` — the full VARIABLES registry grouped, plus the datalist for free-text keys |
| `1008` | `addBlock` — structural types route through `page.addBlock(type)` (duplicate → toast), others through the selected container |
| `1110` | `init` — wiring incl. mousedown hit-testing (canvas), double-click drill-down and the keyboard map: zoom `Ctrl+Shift+=`/`-`, `Ctrl+N` adds a section, `Ctrl+Numpad+`/`-` nudges section height, `↑`/`↓` nudge margin.top (clamped 0–200), Delete/Backspace removes (locked toast for structural), Esc deselects; input/textarea/contentEditable and mid-drag keystrokes are guarded |
| — | No preview DOM at all — the page is one `<canvas id="page">`; grid, grips, dots, guides, gap pill, bubble, chips are all painted (`template/css/billLayout.css` keeps only panes/workspace/props styling) — **no `common.css` import** (its app-wide `.block { display: flex }` rules would collide; theming comes from applyTheme's inline `--theme-*` vars on the document root) |

### Tests

- `__tests__/billBlockModel.test.js:325-410` — "structural sections & default template":
  0.5rem defaults for sections + page (explicit wins), structural uniqueness/canonical
  order/pinning/permanence, `createInvoiceTemplate` contents (8 mandatory header
  variables, table columns, totals rows, 30/40/30 heights, non-zero spacing).
- `__tests__/execBlockTemplate.test.js:499-525` — "default invoice template: 30/40/30
  zones, table pages inside the body zone": 20-item bill paginates inside the body
  zone (rows y < 586, footer y > 586), header + footer repeat on every page, body
  border frame drawn on every page including break pages (2 rects/page in FakeDoc —
  one per path build: border stroke + clip; real pdfkit `rect()` only builds paths).
- `__tests__/designerSnap.test.js` — "designerSnap": snapY alignment-first snapping
  (nearest target, exact threshold, grid fallback, grid-off, alignment-beats-grid,
  untouched-when-far), resizeColPair (sum preserved, min clamps, degenerate pairs)
  and effectiveColWidths (sumup absorbs the remainder, passthrough, 1% minimum,
  empty lists).
- `__tests__/billCanvasPreview.test.js` — "canvas preview" (20 tests, 2026-09-15),
  running `layoutPage`/`renderPreview` against a recording `FakeCtx` (texts,
  rects, lines {from,to}, clips, dashSets — same spirit as the engine's FakeDoc):
  box math (text margins/padding, `x = left+mL`, `h = lines×12×1.2 + 2×pad`),
  pdfkit-style wrapping (narrow content → extra lines), columned cells
  (`cellWidth = innerWidth/cols`, both cells inside the padded interior),
  fixed-height clip (clip path = the section box), **footer bottom-anchoring**
  (`box.y + box.h === pageH − margin.bottom`), degenerate margins (flow still
  advances), table sumup absorbs the remainder (`colX` shares 10/90), totals
  2-row gap `2×14.4 + 0.3×14.4`, image `%` dimensions, `recordAt` deepest-wins +
  empty-paper null, selection chrome (outline, 28×3 grip pill, 4 dots),
  dashed hover + guide (page-centre crosshair), page border `strokeRect(border/2,
  …, w−border, h−border)`, and the bundled templates: **Default1's centre
  partition lands at x = 297.64** (page margin 30, 50% of 535.28) and Default2
  lays out with all its top-level sections recorded. **Field width (2026-09-15):**
  50% width halves the box and align right/center offsets it (`avail` = the
  cell `{x: 8, w: cw}`), width composes with section columns (50% of the cell),
  a 50% right-aligned footer bottom-anchors as a half-width band, the selected
  non-section block draws the 3×16pt right-edge handle, and `recordAt` respects
  the shrunk box (empty cell area stays paper).
- `__tests__/execBlockTemplate.test.js` — **field width (2026-09-15):** a
  50%-width block's text gets `opts.width = cell/2` at `x = left`; align
  right/center position the narrower box (x = left + cell/2, left + cell/4);
  a 50% right-aligned footer anchors its whole cell (`x = left + cell/2`).
  Model side: `billBlockModel.test.js` pins width default 100 + JSON
  round-trip + the schema entry (`range`, 1–100), `effectiveWidthOf`
  (garbage/0/negative/over-100 all fall back to full width) and
  `alignedLeftOf` (left/right/center offsets, full-width anchors at the edge).
- `__tests__/execBlockTemplate.test.js` — "section columns" suite (3 tests, 2026-09-14):
  rows of N cells with x/y math (cell = `(contentWidth − 2×pad) / cols`, row height =
  tallest cell, next row starts below it); an empty variable mid-row collapses its
  cell *without* breaking the row advancement (the `continue`-skips-row-bookkeeping
  bug case); auto-height background box pre-measures the same rows (`measureChildren`
  is row-aware). Model side: `billBlockModel.test.js` pins the columns default (1),
  clamping (0/negative/garbage → 1, >6 → 6) and JSON round-trip.
- Earlier suites: `billBlockModel.test.js:218-321` (section classes) and
  `execBlockTemplate.test.js:366-495` (section engine behavior).

## 4. Decisions worth knowing when reviewing

1. **Sections default `applyBorder: true`, `padding: 8`, `margin: 8pt/side`** — the old
   designer drew sections with proper borders; a fresh section must be visible, and the
   page/sections start with non-zero (0.5rem) breathing room. Everything is editable in
   the props panel.
2. **Section padding is a single number** (like every block), applied on all four sides
   by the engine — not an object. `renderSection`/`sectionBoxHeight`/`measureChildren`
   all compute `contentWidth − 2×pad`.
3. **Zone math**: `zone(frac) = round(frac × usableH − 16)` with `usableH = pageH − 2×8`
   (A4 → header 232pt, body 314pt, footer 232pt). The `−16` is the 8pt margin on both
   sides of each section, so the three zones + their margins tile the page exactly.
4. **Footer anchor = exact pre-measure** (`footerReserve`), not a fraction — the zone
   height and the reserved space always agree.
5. **Structural = enforced in the model**, not just the UI — `addBlock` throws on
   duplicates and inserts canonically, `moveBlock` refuses, `removeBlock` no-ops. The
   designer's toasts/hidden buttons are UX on top of an invariant that can't be
   bypassed by a stale UI.
6. **Circle = circle inscribed in the box** (radius `min(w,h)/2`), ellipse fills the
   box. For a round stamp, set a Fixed Height; width is the content width.
7. **Engine requires no pdfkit at top level** — the document is injected, so tests run
   against `FakeDoc` (records texts/rects/lines/shapes/clips/saves/restores).
8. **Legacy path stays live** — `scripts/makePDF.default.js` only routes templates with
   `version === 2 && Array.isArray(blocks)` to this engine; bundled defaults/v1 keep the
   old generators until verified.
9. **Snap rules are pure and tested** — all snap/column math lives in
   `lib/designerSnap.js` (alignment within 5pt beats grid within 3pt); the designer JS
   only translates pointer pixels to pt (`/zoom`) and re-paints the canvas. Resizing
   a column never changes the pair's combined share, so the preview's
   percentage widths equal the PDF's normalized shares.
10. **The merged designer is old shell + v2 model** — `template/js/billLayout.js` (the
    original designer's file) was rebuilt as the 3-panel designer editing `BillPage`;
    the interim `billBlockDesigner.*` files are deleted and `billLayoutDesigner.js`
    loads `billLayout`. Saving still sends `page.toJSON()` over the original IPC, and
    legacy v1 templates still print through `lib/execCustomTemplate.js` untouched
    (opening one in the designer shows the friendly `LEGACY_MSG` toast).
11. **Horizontal margins are honored end-to-end** (2026-09-14 fix): the engine and the
    canvas preview both lay boxes out as `contentWidth − margin.left − margin.right` for
    sections, text-like blocks, images and tables (frames, partitions, clips and
    backgrounds included); sections further inset their children by `2×border`. Tests
    pin the numbers (slno x = 26, body frame 563.28pt @ x = 16).
12. **Sumup is a column flag, not a width** — the legacy table's last "absorb the
    remaining space" column is stored as `sumup: true` on the col (its `width` stays
    whatever the user set); the engine and the preview compute the effective width
    locally, so the model JSON round-trips untouched. The list editor enforces one
    sumup column at a time, and a column drag freezes a sumup column into a real
    width on first move (Esc restores the flag).
13. **Keyboard remap follows the flow layout** — `↑`/`↓` nudge the selected block's
    `margin.top` (the flow stand-in for the old free-y drag; reorder stays on the
    Move Up/Down buttons), and the old Ctrl+Numpad zoom+resize double-fire is gone:
    numpad ± adjusts the selected section's height, `Ctrl+Shift+=`/`-` zooms.
14. **Corner dots sit just inside the box edges** — fixed-height sections clip their
    overflow, so the old designer's edge-straddling dots would be half-invisible;
    the dots are placed at the edge midpoints *inside* the box (bottom = height, top
    = margin.top with the bottom edge pinned, left/right = horizontal margins,
    clamped 0–200pt).
15. **Columns are the flow answer to row-wise fields** (2026-09-14) — a section-level
    `columns` prop (default 1, clamped 1–6), NOT absolute placement. Rows of N
    equal cells render identically in the canvas preview (`flowChildren`, cell =
    `innerWidth / cols`) and the engine (per-row cursor math in
    `renderChildren` + row-aware `measureChildren`). Cells are chunked *relative to
    the page-break resume point* so a broken row re-forms on the next page; the
    single-column path is byte-for-byte the previous flow (the row math degenerates
    to `colIdx === 0` always). Free x/y placement remains deferred (§6).
16. **The preview is a canvas painted in the PDF's own coordinates** (2026-09-15) —
    `lib/billCanvasPreview.js` mirrors the engine's cursor math one to one (box
    math, cells, partition lines, fixed-height clip order, bottom-anchored
    footers, table effective widths, 0.3×lh totals gaps), so the preview can't
    drift from print the way the CSS approximation could — Default 1's centre
    partition is a plain `x = 30 + 0.5 × 535.28 = 297.64` on both sides. All
    designer interaction (selection, dots, grip, column drags, guides, bubble,
    gap pill, keyboard) hit-tests against the same layout records that painted
    the frame. The model keeps zero DOM code; the renderer is pure (FakeCtx
    in Jest), and a small engine fix rode along: `renderSection`'s degenerate
    branch referenced `boxTop` before its declaration (TDZ crash) — the
    declaration now precedes the branch.
17. **Field width is a % of the block's own cell, positions by align** (2026-09-15) —
    `width` (default 100 = the old full-width behaviour byte-for-byte) shrinks
    the block inside whatever cell it occupies; `align` (left/center/right)
    positions the narrower box inside that cell. The shared helpers
    `effectiveWidthOf`/`alignedLeftOf` (billBlockModel) are used by the engine
    (renderChildren, measureChildren, footerReserve/drawFooters), the canvas
    preview and the designer's width drag, so the three can't disagree. Inside
    a columned section the cell is the column cell, so width and Columns
    compose. The drag handles on the **box's** right edge; dragging a
    center/right-aligned block materializes it to left-aligned on first
    movement (the left edge becomes the anchor, the right edge stays under the
    pointer), and Esc restores width + align. The props-panel slider needs zero
    designer JS — the `range` schema entry renders generically.

## 5. Manual verification checklist

- [ ] New template (already pre-built) → Save & Exit → print a 20-item bill:
      header + footer on every page, items 1..20 exactly once, table breaks at the
      body border, body border visible on every page.
- [ ] Try to delete / move / duplicate Header, Body or Footer → impossible; fields
      inside them can be deleted, reordered and restyled.
- [ ] Change Header height / padding / margin → zone resizes, fields follow.
- [ ] Add a Text block *inside* the header → shows only in the header zone.
- [ ] Select header → change Font Family/Size → all blocks inside update (inheritance).
- [ ] Body properties → Partitions: add a col at 50%, row at 50% → divider lines print.
- [ ] Custom section → shape circle, Fixed Height 60, add "PAID" text → circular stamp
      with content clipped, border stroke around the circle.
- [ ] Section background color → box painted behind content, sized exactly.
- [ ] Drag Header's bottom edge → live height bubble, guide lines at page centre/edges
      and Body's edges, 0.5rem grid snapping; release → props panel shows the new
      Fixed Height; Esc mid-drag → height unchanged.
- [ ] Drag a table column divider → neighbour shrinks/grows, widths in the list
      editor update, printed table matches the preview widths.
- [ ] Table columns → tick "Use remaining space" on the Amount column → preview and
      print stretch it to the right edge; tick it on another column → the first one
      unticks. Drag its divider → it freezes into a real width and drags normally;
      Esc restores the flag.
- [ ] Select a section → four red dots on its edges: bottom = height, top = gap
      above (bottom edge pinned), left/right = the box indents/extends; gap pill
      appears within 10pt of a neighbour edge; centre snap shows the crosshair.
- [ ] Double-click a field inside the Header → it becomes selected (drill-down).
- [ ] Keys: ↑/↓ nudge the top gap of the selected block; Ctrl+N adds a section;
      Ctrl+Numpad+/- resizes the section height; Ctrl+Shift+=/- zoom; Esc deselects;
      Delete on a Header/Footer/Body toasts instead of deleting.
- [ ] Quick Variable picker lists all ~60 grouped fields; typing an unknown
      billMeta key adds a custom variable block.
- [ ] Toggle the grid button → grid disappears and dragging stops snapping.
- [ ] Select a section → set Columns = 2 → its fields flow two-per-row, side by
      side, each half the inner width; short fields don't stretch to the row
      height; set Columns = 3 → three-per-row. Print → the PDF shows the same
      rows. Set Columns back to 1 → fields stack vertically again.
- [ ] Columns = 2 with an odd field count → the last row has one field, left
      aligned in cell 0, no phantom cell on the right.
- [ ] Columns = 2 → an empty variable field mid-row → its cell is blank and the
      other field in the row keeps its position; rows below stay in place.
- [ ] Open an old (v1/legacy) template → friendly "legacy" toast; it still prints
      through the legacy path.
- [ ] Template picker: Blank → empty page, add Header/Body/Footer from the
      palette → they slot header-first, body-after-header, footer-last. Three
      Sections → the pre-built 30/40/30 invoice. Default 1 / Default 2 → the
      legacy layouts as section-based v2 blocks with their partition lines
      (each asks "Replace?" first; Cancel keeps the design and restores the
      picker). Save & Exit from any of them → Save dialog, saved file opens
      again, prints through the v2 engine.
- [ ] Columned sections in Default 1 / Default 2: each field sits inside its
      cell (half/third of the section width), the partition lines run between
      the cells, and selecting a cell section shows its resize dots/grip.
- [ ] Picker state: after File → Open the dropdown shows the "Template…"
      placeholder (no starter selected); after File → New it shows Three
      Sections again.
- [ ] Select a Text/Variable field → a small vertical handle appears on its
      right edge → drag it: the right edge follows the pointer, the left edge
      stays anchored at the cell's left edge, a live bubble shows the %; Esc
      mid-drag restores the original width. The props panel shows the same
      Width % value (slider 1–100); set it there and the canvas updates.
- [ ] Set Width % = 50 + Align = right on a field → it hugs the right half of
      its cell; Align = center → centred in the cell. Drag its width handle →
      it converts to left-aligned on first movement with the handle staying
      under the pointer; Esc restores both width and align.
- [ ] Width inside a columned section (Columns = 2) → the field shrinks inside
      its own column cell, not the whole section. Print → the PDF shows the
      same narrowed field in the same cell.
- [ ] Set a Footer's Width % = 50 → it bottom-anchors as a half-width band on
      every printed page.

## 6. Known limitations / future work

- **Drag-resize covers section height (grip + bottom dot), section margins (top/
  left/right dots), table column width (divider) and field width (right-edge
  handle on non-section blocks).** The width handle snaps to nothing (free drag,
  whole-% bubble) — grid/guide snapping stays on the section edge drags.
- Block *movement* stays Move Up/Down-based — the flow layout has no absolute
  positions, so old-style free drag-move has no v2 equivalent (reordering within
  a section via Move Up/Down covers it; ↑/↓ nudges spacing).
- **Row-wise fields = section columns, not free placement** — fields flow in rows of
  N equal-width cells (Columns prop, §2 item 10). True free x/y placement (drag a
  field to an arbitrary spot) is still deferred; if it lands, it will be a separate
  model mode, not a columns change.
- Columned sections lay cells out as equal-width tracks — per-field column
  weighting or a column gap is not exposed (spacing is per-field margins).
- Column drags have no horizontal snap (e.g. 25/50/75% marks) yet — the grid snap
  is vertical-only; x-axis snapping applies to the corner dots.
- The dot drags snap/limit against the dragstart snapshot — neighbouring sections
  don't reflow live during a drag (reflow happens on release), so guide targets
  can't chase the pointer.
- Circle sections use the inscribed circle — a wide box shows a centered circle, not a
  filled wide ellipse; use ellipse for that.
- Canvas text wraps by naive word-splitting (`wrapLines`) — close enough for design
  work, but pdfkit's word engine may break very long single words differently.
- Bundled `default1/default2.json` are section-based recreations of the legacy
  layouts, including their divider lines as section partitions; the legacy
  hardcoded builders (buildPage.default.js) still win for *printing* whenever a
  saved template is named `default1`/`default2` (billTemplateResolver.js) — the
  JSONs are designer starting points until that routing is retired.
- Nested sections deeper than ~3 levels are untested in the designer UI (engine
  continuation paths are generic and test-covered for nesting).
