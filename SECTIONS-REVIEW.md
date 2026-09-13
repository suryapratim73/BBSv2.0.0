# Bill Layout Designer v2 — Sections + Structural Template + Drag-Resize Review

Review companion for the Header / Body / Footer / Custom Section work, the
**pre-built structural template**, and **drag-to-resize + alignment grids** on
top of the block-based designer (commit `9cf7613`). Everything below is keyed
to file + line so you can jump straight to the code.
**Test status: 238/238 passing (13 suites).**

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
- A report md file (this file) to ease code review.

## 2. How to use it in the designer

1. Open the designer. A new template **starts pre-built**: Header (30%) with the
   seller/customer fields + bill no/date, Body (40%) with the items table, Footer
   (30%) with totals, "Thank You!" and signatory — `createInvoiceTemplate()`.
2. The left palette has a **Sections** group above Blocks
   (`template/html/billBlockDesigner.html:14-29`).
3. **Select a section first**, then add blocks — they go *inside* it and inherit the
   section's font family/size/color (`template/js/billBlockDesigner.js:203-210`).
   If nothing is selected, blocks are added to the selected block's section, else the page.
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
6. **Drag-to-resize**: hover a section — a grip bar appears on its bottom edge.
   Drag it to resize the section's fixed height (an auto-height section converts
   to fixed at its rendered height). Drag a table column divider in the header
   row to resize that column (the neighbour gives up width; the pair's sum is
   what the PDF engine normalizes against, so preview == print). A live bubble
   shows the current size; **Esc cancels** mid-drag.
7. **Alignment grids**: the page shows a 0.5rem grid (8pt minor / 40pt major),
   toggled from the workspace bar (grid button, default on). While dragging, the
   pointer snaps to grid lines and to guide lines at the page edges, content box,
   page centre and neighbouring section edges — snapped guides render as dashed
   accent lines with a `586 pt — section bottom`-style label.
8. Header and Footer repeat on **every printed page**, like the old designer's
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
| `1` | `snapY(y, targets, opts)` — alignment lines win within **5pt**, else the grid snaps within **3pt**; returns `{ value, guide, label, type }` (guide `null` = nothing snapped) |
| `1` | `resizeColPair(a0, b0, deltaPct, min=2)` — shifts width between two adjacent table columns keeping their combined share (what the PDF normalizes against); degenerate pairs return unchanged |

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

### Designer — `template/js/billBlockDesigner.js` + html/css

| Line | What |
|---|---|
| `53` | `let page = createInvoiceTemplate()` — the designer starts with the pre-built invoice (reset at `647` too) |
| `96` | `renderAll` draws top-level **footers last** in the DOM preview, mirroring their PDF bottom anchoring |
| `163` | `findBlock(id)` — recursive search through sections |
| `179` | `getParentOf(id)` → `{ container, index }` used by move/delete |
| `203` | `inheritFromSection(block, section)` — copies font family/size/color on add |
| `211` | `cascadeSectionFont(section)` — font prop change pushes down to all descendants |
| `222` | `cascadeIfSectionFont(target, key)` — hooked into every prop handler |
| `238` | `updateContextHint` — structural sections get: *"X is a fixed section — edit or remove its fields, but the section itself stays in place."* |
| `269` | `renderProps` — move/delete action buttons hidden (`blockActions.classList.toggle("hide", locked)`) for structural sections |
| `608` | `addBlock` — structural types route through `page.addBlock(type)` (duplicate → toast), others through the selected container |
| `742` | Keyboard: ArrowUp/Down on a structural section → toast *"Header/Body/Footer stay in place — reorder their fields instead."*; Delete/Backspace → *"…cannot be deleted — remove their fields instead."* |
| — | **Drag-resize** (`GRID_STEP 8` state ~line 57; machinery after `scheduleRender`): `attachResizeHandles` adds a bottom-edge grip to every `.section-block` and a divider to every table header cell (except the last); `startSectionResize` snapshots pt geometry via `getBoundingClientRect()/zoom` (the page is `transform: scale(zoom)`), converts auto-height sections to fixed at their rendered height, and drives live updates through `onDragMove` → `SNAP.snapY` / `SNAP.resizeColPair`; `drawGuides` + `showBubble` render the guide line/label and live size; `onDragEnd` re-renders from the model (Esc cancels via `onDragKey`) |
| — | `snapTargets` — page edges, content box, centre + neighbouring section tops/bottoms, snapshotted at dragstart so targets don't chase the pointer |
| — | `suppressClickOnce` — swallows the browser's mouseup→click pair after a drag so the drag's release doesn't re-select/re-render; cleared next tick |
| — | Grid toggle in `init()` (`#grid-toggle`, default on): `syncGridUI` flips `#page.show-grid` + button state; palette hint + toolbar button in `template/html/billBlockDesigner.html`; all new visuals (grid, grips, guides, bubble) styled in `template/css/billBlockDesigner.css` |

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
  untouched-when-far) and resizeColPair (sum preserved, min clamps, degenerate pairs).
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
- [ ] Toggle the grid button → grid disappears and dragging stops snapping.
- [ ] Open an old (v1/legacy) template → still opens and prints through the legacy path.

## 6. Known limitations / future work

- **Drag-resize covers sections (height) and table columns (width).** Image blocks
  still resize via the props panel; a corner-handle image resize is a possible
  follow-up. Block *movement* stays keyboard/list-based — the flow layout has no
  absolute positions, so old-style free drag-move has no v2 equivalent (reordering
  within a section via Move Up/Down covers it).
- Column drags have no horizontal snap (e.g. 25/50/75% marks) yet — the grid snap
  is vertical-only.
- Circle sections use the inscribed circle — a wide box shows a centered circle, not a
  filled wide ellipse; use ellipse for that.
- The DOM preview approximates the PDF (CSS vs pdfkit); the PDF is authoritative.
- Bundled `default1/default2.json` remain flat (no sections) until migrated deliberately
  to the pre-built structure.
- Nested sections deeper than ~3 levels are untested in the designer UI (engine
  continuation paths are generic and test-covered for nesting).
