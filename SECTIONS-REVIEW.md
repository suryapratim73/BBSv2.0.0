# Bill Layout Designer v2 — Sections Feature Review

Review companion for the Header / Body / Footer / Custom Section work on top of the
block-based designer (commit `9cf7613`). Everything below is keyed to file + line so
you can jump straight to the code. **Test status: 224/224 passing (12 suites).**

---

## 1. What was asked

- An invoice must have three sections — **Header**, **Body**, **Footer**.
- Additional **custom sections** with custom shapes (rectangle, rounded, circle, ellipse).
- Sections are **containers**: fields, tables etc. live *inside* them and **inherit the
  container's font**.
- Partitions (divider lines) inside sections, like the old designer.
- A report md file (this file) to ease code review.

## 2. How to use it in the designer

1. Open the designer. The left palette now has a **Sections** group above Blocks:
   Header, Body, Footer, Custom Section (`template/html/billBlockDesigner.html:14-29`).
2. Add Header → Body → Footer. A fresh **Body comes pre-loaded with the items table**
   (`lib/billBlockModel.js:1147`).
3. **Select a section first**, then add blocks — they go *inside* it and inherit the
   section's font family/size/color (`template/js/billBlockDesigner.js:203-210`).
   If nothing is selected, blocks are added to the selected block's section, else the page.
4. Select a section and use its properties panel:
   - **Shape**: rectangle / rounded / circle / ellipse (`lib/billBlockModel.js:1032`)
   - **Fixed Height**: `0` = grow with content; `>0` = fixed box that **clips** children
     to the shape (required for circle/ellipse clipping) (`lib/billBlockModel.js:1034`)
   - **Partitions**: add divider lines — direction (col/row), position %, line width
     (`lib/billBlockModel.js:1035-1046`)
   - Section name shows as a small chip on the canvas (design-time only).
5. Header and Footer repeat on **every printed page**, like the old designer's
   per-page header/footer.

## 3. Architecture map

### Model — `lib/billBlockModel.js` (shared renderer + main, no electron/pdfkit at top level)

| Line | What |
|---|---|
| `1023` | `BillSection extends BillBlock` — base for all section types |
| `1028` | `propsSchema`: name, shape, cornerRadius, height, partitions |
| `1050` | `applyTypeProps`: **padding defaults 5**, **applyBorder defaults true** (legacy parity — a fresh section is visible), partitions normalized, children built via `BillBlock.fromJSON` |
| `1066` | `typePropsJSON`: round-trip including nested `blocks` |
| `1078` | `measure()` returns `null` — the engine measures sections, not the block |
| `1082` | `isEmpty()` returns `false` — a section renders even with no children |
| `1089` | `renderDOM` — designer preview: chip, children, partition lines, fixed height + overflow, circle/ellipse `border-radius: 50%` |
| `1141` | `HeaderBlock` / `BodyBlock` / `FooterBlock` / `SectionBlock` (Body seeds a `TableBlock` when constructed empty — `1147`) |
| `1174` | `applyBlockContainerMixin` — `addBlock/getBlock/moveBlock/removeBlock`; children added without an explicit font inherit `fFamily ?? font.family ?? "Times-Roman"` |
| `1206` | `BillBlock.TYPES` registry includes the four section types |

### Engine — `lib/execBlockTemplate.js` (single generator, many layouts)

| Line | What |
|---|---|
| `41` | `main()` — walks captions; one `renderPage` per caption |
| `76` | `renderPage` — page border, default font, **footerReserve** (exact pre-measured footer height), `drawFooters` closure, main walk with `from: blockStart` / `contPath: childStart` split |
| `111-148` | Top-level footer sections are **bottom-anchored on every page**; the main walk skips them (`196-218`), `drawFooters` stacks them bottom-up; `onPageEnd` is awaited before **every** page break |
| `196` | `renderChildren` — the shared y-cursor walk (page + sections). `from` = where to start iterating; `contPath` marks the resume target; `pendingRowStart` is consumed **once** by the first table or continuation-target section |
| `331` | `renderSection` — margin → box → children → partitions → border. Key mechanics: |
| | • **Shape path** (`shapePath`) builds once and serves clip, background fill and border stroke (pdfkit shape methods are pure path builders) |
| | • **Fixed height** → `save/clip/children/restore`; on page break inside a clip the `restore()` is **skipped** — an unmatched `q` at page end is safe, an unmatched `Q` on a new page corrupts it (`405-417`) |
| | • **Auto height** → children flow, box = measured/actual height |
| | • **Background** painted *under* children via exact pre-measure (`362-368`) |
| `454` | `sectionBoxHeight` — fixed height, else `measureChildren + 2×padding` (deterministic → safe to reserve footer space) |
| `464` | `drawPartitions` — col/row divider lines from legacy `partitionObj` |
| `488` | `measureChildren` — mirrors the render cursor math exactly (table = thHeight + rows × (lineHeight + 2×rSpacing)), recursing into nested sections |
| `617` | `renderTable` — page-break sites both `await onPageEnd()` **before** `addPage()`, then re-enter `renderPage` with `breakPage(row)` |

**Continuation model** (the tricky part — read this before changing it):

- `childStart` is a **path** of child indices, e.g. `[1, 0, 2]` = top-level block 1 is a
  section, resume at its child 0 (a section), resume at *its* child 2. `absPath` is the
  same path including the section's own top-level index as element 0.
- Page-level break opts: `{ blockStart: 0, childStart: [...absPath, childIdx], rowStart }`.
  **`blockStart` is always 0** so header-zone blocks repeat on continuation pages;
  `childStart` alone marks the resume point. Section-level `from` = `contPath[0] ?? 0`
  so already-drawn children are skipped.
- `rowStart` rides along as `pendingRowStart` and is consumed by exactly one consumer —
  the first table *or* the continuation-target section — so a header table can never
  steal a body table's row state.
- Header/Footer (`isRepeat`) render with `bottomY: Infinity` — they never page-break.

### Designer — `template/js/billBlockDesigner.js` + html/css

| Line | What |
|---|---|
| `163` | `findBlock(id)` — recursive search through sections |
| `179` | `getParentOf(id)` → `{ container, index }` used by move/delete |
| `203` | `inheritFromSection(block, section)` — copies font family/size/color on add |
| `211` | `cascadeSectionFont(section)` — font prop change pushes down to all descendants |
| `222` | `cascadeIfSectionFont(target, key)` — hooked into every prop handler |
| — | `addBlock` routes to the selected section → selected block's parent section → page (`template/html/billBlockDesigner.html:14-29` palette; chips in `template/css/billBlockDesigner.css:248-273`) |

### Tests

- `__tests__/billBlockModel.test.js:218-321` — "BillSection classes": type registry,
  Body pre-load, round-trip (props/partitions/nested children through BillPage),
  child operations, propsSchema shape.
- `__tests__/execBlockTemplate.test.js:366-495` — "execBlockTemplate — sections":
  header+footer repeat on every page while body table pages once per row;
  bottom-anchored footer within page bounds; variables resolve inside sections;
  partitions produce col/row lines; circle + fixed height clips (save/restore
  balanced); rounded frame without clipping; nested custom sections; auto-height
  background; empty section still draws its box and advances the cursor.

## 4. Decisions worth knowing when reviewing

1. **Sections default `applyBorder: true` and `padding: 5`** — the old designer drew
   sections with proper borders; a fresh section must be visible. Change via props panel.
2. **Section padding is a single number** (like every block), applied on all four sides
   by the engine — not an object. `renderSection`/`sectionBoxHeight`/`measureChildren`
   all compute `contentWidth - 2×pad`.
3. **Circle = circle inscribed in the box** (radius `min(w,h)/2`), ellipse fills the
   box. For a round stamp, set a Fixed Height; width is the content width.
4. **Engine requires no pdfkit at top level** — the document is injected, so tests run
   against `FakeDoc` (records texts/rects/lines/shapes/clips/saves/restores).
5. **Legacy path stays live** — `scripts/makePDF.default.js` only routes templates with
   `version === 2 && Array.isArray(blocks)` to this engine; bundled defaults/v1 keep the
   old generators until verified.

## 5. Manual verification checklist

- [ ] New template → add Header/Body/Footer → Save & Exit → print a 20-item bill:
      header + footer on every page, items 1..20 exactly once.
- [ ] Add a Text block *inside* the header → shows only in the header zone.
- [ ] Select header → change Font Family/Size → all blocks inside update (inheritance).
- [ ] Body properties → Partitions: add a col at 50%, row at 50% → divider lines print.
- [ ] Custom section → shape circle, Fixed Height 60, add "PAID" text → circular stamp
      with content clipped, border stroke around the circle.
- [ ] Section background color → box painted behind content, sized exactly.
- [ ] Open an old (v1/legacy) template → still opens and prints through the legacy path.

## 6. Known limitations / future work

- Circle sections use the inscribed circle — a wide box shows a centered circle, not a
  filled wide ellipse; use ellipse for that.
- The DOM preview approximates the PDF (CSS vs pdfkit); the PDF is authoritative.
- Bundled `default1/default2.json` remain flat (no sections) until migrated deliberately.
- Nested sections deeper than ~3 levels are untested in the designer UI (engine
  continuation paths are generic and test-covered for nesting).
