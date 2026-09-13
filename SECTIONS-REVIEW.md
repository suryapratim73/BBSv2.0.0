# Bill Layout Designer v2 — Sections + Structural Template + Drag-Resize Review

Review companion for the Header / Body / Footer / Custom Section work, the
**pre-built structural template**, **drag-to-resize + alignment grids**, and
the **designer merge** (2026-09-14: the old designer's shell rebuilt on the v2
model as `template/js/billLayout.js`; the interim `billBlockDesigner.*` files
are retired). Everything below is keyed to file + line so you can jump
straight to the code.
**Test status: 248/248 passing (13 suites).**

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
6. **Drag-to-resize**: hover a section — a grip bar appears on its bottom edge,
   and the selected section shows four **red corner dots** on its edge midpoints
   (the old designer's adj-points): bottom = fixed height, top = the gap above
   (margin.top, bottom edge pinned), left/right = the horizontal margins. Drag a
   table column divider in the header row to resize that column (the neighbour
   gives up width; the pair's sum is what the PDF engine normalizes against, so
   preview == print; a column flagged **"Use remaining space"** — the legacy
   *sumup* — absorbs whatever the fixed columns leave, and freezes into a real
   width on first drag). A live bubble shows the current size; **Esc cancels**
   mid-drag.
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

## 3. Architecture map

### Model — `lib/billBlockModel.js` (shared renderer + main, no electron/pdfkit at top level)

| Line | What |
|---|---|
| `497` | `PAGE_PROPS_SCHEMA` — page margin prop defaults to **8pt** per side |
| `1023` | `BillSection extends BillBlock` — base for all section types |
| `1028` | `propsSchema`: name, shape, cornerRadius, height, partitions |
| `1050` | `applyTypeProps`: **padding defaults 8**, **margin defaults 8pt/side**, **applyBorder defaults true** (0.5rem everywhere; a fresh section is visible), partitions normalized, children built via `BillBlock.fromJSON` |
| `1078` | `measure()` returns `null` — the engine measures sections, not the block |
| `1082` | `isEmpty()` returns `false` — a section renders even with no children |
| `1089` | `renderDOM` — designer preview: chip, children, partition lines, **fixed height via `el.style.height`** (`1132`, border-box), circle/ellipse `border-radius: 50%` |
| `1145` | `HeaderBlock` / `BodyBlock` (`1151`, seeds a `TableBlock` when constructed empty — `1160`) / `FooterBlock` / `SectionBlock` |
| `1178` | `applyBlockContainerMixin` — `addBlock/getBlock/moveBlock/removeBlock`; children added without an explicit font inherit `fFamily ?? font.family ?? "Times-Roman"` |
| `1206` | `BillBlock.TYPES` registry includes the four section types |
| `1250` | `STRUCTURAL_TYPES = ["header", "body", "footer"]` |
| `1258` | `BillPage` constructor — page `margin` defaults **8pt/side**, explicit values win per-side |
| `1311` | `addBlock` structural branch: a structural type **throws if it already exists** (`A Header section already exists.`), and is inserted at its **canonical slot** — header → 0, body → after header (or 0), footer → end |
| `1337` | `moveBlock`: refused when either the moved or target block is structural — the three zones are pinned |
| `1355` | `removeBlock`: **no-op** for structural sections — they are permanent |
| `1372` | `createInvoiceTemplate()` — the pre-built template (see §4.2) |

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
| `111-148` | Top-level footer sections are **bottom-anchored on every page**; the main walk skips them (`196-218`), `drawFooters` stacks them bottom-up; `onPageEnd` is awaited before **every** page break |
| `196` | `renderChildren` — the shared y-cursor walk (page + sections). `from` = where to start iterating; `contPath` marks the resume target; `pendingRowStart` is consumed **once** by the first table or continuation-target section |
| `331` | `renderSection` — margin → box → children → partitions → border. Key mechanics: |
| | • **Shape path** (`shapePath`) builds per use and serves clip, background fill and border stroke (pdfkit shape methods are pure path builders) |
| | • **Fixed height** → frame drawn **first** (`429`), then `save/clip/children/restore` so the clip can't halve the border stroke; on page break inside a clip the `restore()` is **skipped** (`434-438`) — an unmatched `q` at page end is safe, an unmatched `Q` on a new page corrupts it |
| | • **Fixed non-repeat sections bound their children**: `bottomY = boxTop + boxHeight − pad` (`389-392`) — the clip line *is* the page-break line, so the body's table breaks exactly at the body border on every page |
| | • **On break, fixed sections still draw frame + partitions for the zone rendered on this page** (`445-452`) — a bordered body keeps its border on break pages |
| | • **Auto height** → children flow, box = measured/actual height |
| | • **Background** painted *under* children via exact pre-measure (`362-368`) |
| `454` | `sectionBoxHeight` — fixed height, else `measureChildren + 2×padding` (numeric padding; deterministic → safe to reserve footer space) |
| `464` | `drawPartitions` — col/row divider lines from legacy `partitionObj` |
| `488` | `measureChildren` — mirrors the render cursor math exactly (table = thHeight + rows × (lineHeight + 2×rSpacing)), recursing into nested sections |
| `617` | `renderTable` — page-break sites both `await onPageEnd()` **before** `addPage()`, then re-enter `renderPage` with `breakPage(row)` |

**Continuation model** (the tricky part — read this before changing it):

- `childStart` is a **path** of child indices, e.g. `[1, 0, 2]` = top-level block 1 is a
  section, resume at its child 0 (a section), resume at *its* child 2. `absPath` is the
  same path including the section's own top-level index as element 0.
- Page-level break opts: `{ blockStart: 0, childStart: [...absPath, childIdx], rowStart }`.
  **`blockStart` is always 0** (`644`) so header-zone blocks repeat on continuation
  pages; `childStart` alone marks the resume point. Section-level `from` = `contPath[0] ?? 0`
  so already-drawn children are skipped.
- `rowStart` rides along as `pendingRowStart` and is consumed by exactly one consumer —
  the first table *or* the continuation-target section — so a header table can never
  steal a body table's row state.
- Header/Footer (`isRepeat`) render with `bottomY: Infinity` — they never page-break.

### Designer — `template/js/billLayout.js` + html/css (the merged designer)

| Line | What |
|---|---|
| `60` | `let page = createInvoiceTemplate()` — the designer starts with the pre-built invoice (reset at `1117` too) |
| `108` | `renderAll` draws top-level **footers last** in the DOM preview, mirroring their PDF bottom anchoring; attaches resize grips + corner dots |
| `138` | `renderBlockEl` — recursive preview; children replace their `renderDOM` placeholder (works because every block now sets `data-block-id`); sections shrink children by `cw − mL − mR − 2×pad − 2×border` |
| `244` | `attachCornerDots` — 4 red edge-midpoint dots on the selected section (bottom routes to `startSectionResize`, the others to `startDotResize`) |
| `271` | `snapTargets` — x + y alignment lines (page edges, content box, centre, neighbour section edges), snapshotted at dragstart so targets don't chase the pointer |
| `325` | `startDotResize` — top dot pins the bottom edge (auto-height converts to fixed at rendered height); left/right drag the horizontal margins |
| `357` | `startColResize` — snapshots **effective** widths (`SNAP.effectiveColWidths`) + the stored state so Esc restores sumup flags exactly |
| `402` | `onDragMove` — section (height, y-snap), dot (margins + top-dot height compensation, x-snap for left/right), col (materializes a sumup pair into real widths on first move, then `resizeColPair`) |
| `486` | `onDragKey` — Esc restores the dragstart state for all three kinds |
| `535` | `drawGuides(snapped, axis)` — horizontal or vertical dashed guide; `page centre` snaps draw the full crosshair |
| `577` | `drawGapPill(pos, dir, targets, e)` — nearest neighbour edge within 10pt in the drag direction → "N pt" pill at mid-gap |
| `605` | `selectBlock` — selection drives the props panel + context hint |
| `620` | `findBlock(id)` — recursive search through sections |
| `636` | `getParentOf(id)` → `{ container, index }` used by move/delete |
| `660` | `inheritFromSection(block, section)` — copies font family/size/color on add |
| `668` | `cascadeSectionFont(section)` — font prop change pushes down to all descendants |
| `684` | `updateContextHint` — structural sections get: *"X is a fixed section — edit or remove its fields, but the section itself stays in place."* |
| `711` | `renderProps` — move/delete action buttons hidden (`blockActions.classList.toggle("hide", locked)`) for structural sections |
| `915` | `renderListEditor` — list items support **checkbox fields** (the table column "Use remaining space" flag); checking a sumup column clears the flag on every other column (one absorb-the-rest column at a time) |
| `1049` | `fillVariablePicker` — the full VARIABLES registry grouped, plus the datalist for free-text keys |
| `1078` | `addBlock` — structural types route through `page.addBlock(type)` (duplicate → toast), others through the selected container |
| `1140` | `init` — wiring incl. double-click drill-down (`1177`) and the keyboard map (`1218-1330`): zoom `Ctrl+Shift+=`/`-`, `Ctrl+N` adds a section, `Ctrl+Numpad+`/`-` nudges section height, `↑`/`↓` nudge margin.top (clamped 0–200), Delete/Backspace removes (locked toast for structural), Esc deselects; input/textarea/contentEditable and mid-drag keystrokes are guarded |
| — | `suppressClickOnce` — swallows the browser's mouseup→click pair after a drag so the drag's release doesn't re-select/re-render; cleared next tick |
| — | Grid toggle in `init()` (`#grid-toggle`, default on): `syncGridUI` flips `#page.show-grid` + button state; palette hint + toolbar button in `template/html/billLayout.html`; all visuals (grid, grips, corner dots, guides, gap pill, bubble) styled in `template/css/billLayout.css` (imports `common.css` for the app theme) |

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
   only translates pointer pixels to pt (`/zoom` on the transformed page) and updates
   the DOM. Resizing a column never changes the pair's combined share, so the preview's
   percentage widths equal the PDF's normalized shares.
10. **The merged designer is old shell + v2 model** — `template/js/billLayout.js` (the
    original designer's file) was rebuilt as the 3-panel designer editing `BillPage`;
    the interim `billBlockDesigner.*` files are deleted and `billLayoutDesigner.js`
    loads `billLayout`. Saving still sends `page.toJSON()` over the original IPC, and
    legacy v1 templates still print through `lib/execCustomTemplate.js` untouched
    (opening one in the designer shows the friendly `LEGACY_MSG` toast).
11. **Horizontal margins are honored end-to-end** (2026-09-14 fix): the engine and the
    DOM preview both lay boxes out as `contentWidth − margin.left − margin.right` for
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
- [ ] Open an old (v1/legacy) template → friendly "legacy" toast; it still prints
      through the legacy path.

## 6. Known limitations / future work

- **Drag-resize covers section height (grip + bottom dot), section margins (top/
  left/right dots) and table column width (divider).** Image blocks still resize via
  the props panel. Block *movement* stays Move Up/Down-based — the flow layout has
  no absolute positions, so old-style free drag-move has no v2 equivalent
  (reordering within a section via Move Up/Down covers it; ↑/↓ nudges spacing).
- Column drags have no horizontal snap (e.g. 25/50/75% marks) yet — the grid snap
  is vertical-only; x-axis snapping applies to the corner dots.
- The dot drags snap/limit against the dragstart snapshot — neighbouring sections
  don't reflow live during a drag (reflow happens on release), so guide targets
  can't chase the pointer.
- Circle sections use the inscribed circle — a wide box shows a centered circle, not a
  filled wide ellipse; use ellipse for that.
- The DOM preview approximates the PDF (CSS vs pdfkit); the PDF is authoritative.
- Bundled `default1/default2.json` remain flat (no sections) until migrated deliberately
  to the pre-built structure.
- Nested sections deeper than ~3 levels are untested in the designer UI (engine
  continuation paths are generic and test-covered for nesting).
