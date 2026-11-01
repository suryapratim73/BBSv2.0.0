/**
 * billElementClasses.js — element class library for the bill layout designer.
 *
 * `Element` is the superclass holding the properties common to every bill
 * element (x, y, width, height, padding, margin, border, zIndex). The UI
 * classes inherit and add their own properties:
 *
 *   Page   — the template document (paper size, margin, sections, feilds)
 *   Section (+ Header / Body / Footer, by role) — a bordered box with
 *            partitions and an optional items table
 *   Field  (+ TextField / VariableField / ImageField, by type) — one line
 *            of text, a resolved variable or an image box
 *   Table  — a section's plan (column list with cumulative xPos/yPos)
 *
 * The designer's runtime (actPointer, page, per-element canvases,
 * 1px = 1 PDF pt) stays the working model: the designer instantiates these
 * classes at the legacy creation points and each class draws its own
 * element. Every class serializes to the byte-exact legacy JSON that
 * lib/execCustomTemplate.js already reads — the engine never knows these
 * classes exist.
 *
 * Classes stay free of top-level electron/pdfkit/browser requires: draw()
 * touches the DOM only when called, by the designer page.
 */
const { v4: uuid } = require("uuid");

const SHAPES = ["rectangle", "rounded", "circle", "ellipse"];

// ---------------------------------------------------------------------------
// Element — superclass with the properties common to all elements.
// ---------------------------------------------------------------------------
class Element {
    constructor(data = {}) {
        // Position & box — the shared vocabulary of every bill element.
        // Whether x/y were EXPLICITLY given — draw() only positions an
        // element that was given a place (a brand-new element in the
        // designer falls back to the CSS-centered .new-elem slot).
        this.margin = data.margin || {top:0,bottom:0,left:0,right:0};
        this.padding = data.padding || {top:0,bottom:0,left:0,right:0};
        this.useRangeCoordinates = data.useRangeCoordinates || false;
        this.xRange = data.xRange || 0;
        this.yRange = data.yRange || 0;
        this.useRangeDimensions = data.useRangeDimensions || false;
        this.heightRange = data.heightRange || 0;
        this.widthRange = data.widthRange || 0;
        let positionalBiasX = data.parent?.padding?.left + this.margin.left || 0;
        let positionalBiasY = data.parent?.padding?.top + this.margin.top || 0;
        let margin_paddingX =  this.margin.left + this.margin.right + data.parent?.padding?.left + data.parent?.padding?.right || 0;
        let margin_paddingY = this.margin.top + this.margin.bottom + data.parent?.padding?.top + data.parent?.padding?.bottom || 0;
        // Range coordinates are % of the parent's content box (the area
        // inside its padding), offset by the parent's padded origin — so
        // adjacent bands tile exactly instead of double-counting padding.
        let contentW = data.parent ? data.parent.width - (data.parent.padding?.left || 0) - (data.parent.padding?.right || 0) : 0;
        let contentH = data.parent ? data.parent.height - (data.parent.padding?.top || 0) - (data.parent.padding?.bottom || 0) : 0;
        this.x = data.x || this.useRangeCoordinates && this.xRange && (data.parent?.x + positionalBiasX + this.xRange*contentW/100) || data.parent?.x + positionalBiasX || 0;
        this.y = data.y || this.useRangeCoordinates && this.yRange && (data.parent?.y + positionalBiasY + this.yRange*contentH/100) || data.parent?.y + positionalBiasY || 0;
        this._posSet = data.x !== undefined && data.y !== undefined;
        // Explicit width/height are already padding-adjusted materialized
        // values — take them verbatim. Only the parent-derived fallback
        // shrinks by the parent padding; re-wrapping an instantiated
        // section (renderSection) must not subtract it a second time.
        this.width = data.width || this.useRangeDimensions && this.widthRange && (this.widthRange*contentW/100) || data.parent?.width - margin_paddingX || 0;
        this.height = data.height || this.useRangeDimensions && this.heightRange && (this.heightRange*contentH/100) || data.parent?.height - margin_paddingY || 0;
        this.applyBorder = data.applyBorder ?? false;
        this.border = data.border ?? 1;
        this.zIndex = data.zIndex || data.parent?.zIndex ? data.parent?.zIndex+1 : 1;
    }

    /** Generic serialization — subclasses override with their legacy keys. */
    toJSON() {
        return {
            x: this.x,
            y: this.y,
            width: this.width,
            height: this.height,
            padding: this.padding,
            margin: this.margin,
            applyBorder: this.applyBorder,
            border: this.border,
            zIndex: this.zIndex,
        };
    }

    /** Rebuild an element from legacy JSON (old saved files load unchanged). */
    static fromJSON(obj) {
        if (!obj || typeof obj !== "object" || Array.isArray(obj))
            throw new Error("Invalid element data.");
        if ("version" in obj || "blocks" in obj)
            throw new Error(
                "This is a v2 block template — recreate it with the classic Bill Layout Designer."
            );
        return new this(obj);
    }
}

// ---------------------------------------------------------------------------
// Section (+ Header / Body / Footer by role)
// ---------------------------------------------------------------------------
class Section extends Element {
    constructor(data = {}) {
        super(data);
        this.role = data.role ?? "section"; // "head" | "body" | "footer" | "section"
        this.name =
            data.name ?? (["head", "body", "footer"].includes(this.role) ? this.role : "");
        this.partitions = data.partitions ?? []; // [{direction:"col"|"row", range, lWidth}]
        this.plan = data.plan ?? {}; // {thHeight, fSize, rSpacing, padding, cols}
        this.shape = data.shape ?? "rectangle"; // "rectangle" | "rounded" | "circle" | "ellipse"
        this.cornerRadius = data.cornerRadius ?? 8;
        this.parent = data?.parent;
    }

    /** Legacy section JSON — the exact keys the engine reads. */
    toJSON() {
        return {
            role: this.role,
            name: this.name,
            applyBorder: this.applyBorder,
            border: this.border,
            partitions: this.partitions,
            plan:
                this.plan instanceof Table ? this.plan.toJSON(this.width) : this.plan,
            x: this.x,
            y: this.y,
            width: this.width,
            height: this.height,
            shape: this.shape,
            cornerRadius: this.cornerRadius,
        };
    }

    /**
     * Draw this section as a per-element <canvas> (mirrors the legacy
     * createSection / renderSection / drawPartition / drawTable recipes).
     * Returns the canvas; the caller keeps it as `section.elem`.
     */
    draw(mainDiv, page, zoomFactor = 1) {
        const section = document.createElement("canvas");
        this.elem = section;
        section.dataset.name = this.name;
        section.width = this.width;
        section.height = this.height;
        section.classList.add("new-elem");
        mainDiv.appendChild(section);
        section.style.zIndex = this.zIndex;
        // Logical coordinates (1px = 1pt); zoom scales the CSS box. Elements
        // without an explicit x/y stay in the CSS-centered slot (the designer
        // freezes that position itself, exactly like the legacy createSection).
        if (this._posSet) {
            section.style.left = this.x * zoomFactor + "px";
            section.style.top = this.y * zoomFactor + "px";
            section.dataset.left = this.x;
            section.dataset.top = this.y;
        }
        section.style.width = section.width * zoomFactor + "px";
        section.style.height = section.height * zoomFactor + "px";
        // Pre-seed the zoom caches so zoomFunc keeps the correct base size.
        section.dataset.width_100 = section.width;
        section.dataset.height_100 = section.height;
        section.dataset.aspectRatio =
            Math.round((section.width / section.height) * 100) / 100;
        section.dataset.id = this.id || uuid();
        this.id = section.dataset.id;
        const ctx = section.getContext("2d");
        ctx.lineWidth = this.border;
        ctx.strokeStyle = this.applyBorder ? "black" : "gray";
        this.drawShapePath(ctx);
        this.drawPartitions(ctx);
        this.drawTable(ctx, page);
        return section;
    }

    /** Border path for this section's shape (rounded / circle / ellipse / rectangle). */
    drawShapePath(ctx) {
        let { width, height } = this;
        let { left:lPad,right:rPad,top:tPad,bottom:bPad } = this.padding;
        ctx.beginPath();
        if (this.shape === "rounded") {
            const r = Math.min(this.cornerRadius, width / 2, height / 2);
            ctx.moveTo(r, 0);
            ctx.lineTo(width - r, 0);
            ctx.arcTo(width, 0, width, r, r);
            ctx.lineTo(width, height - r);
            ctx.arcTo(width, height, width - r, height, r);
            ctx.lineTo(r, height);
            ctx.arcTo(0, height, 0, height - r, r);
            ctx.lineTo(0, r);
            ctx.arcTo(0, 0, r, 0, r);
            ctx.closePath();
        } else if (this.shape === "circle") {
            const r = Math.min(width, height) / 2;
            ctx.arc(width / 2, height / 2, r, 0, 2 * Math.PI);
        } else if (this.shape === "ellipse")
            ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, 2 * Math.PI);
        else ctx.rect(lPad, tPad, width-rPad-lPad, height-bPad-tPad);
        ctx.stroke();
    }

    /** Partition lines (legacy drawPartition). `extra` draws the
        in-progress partition being edited (the live preview line). */
    drawPartitions(ctx, extra = []) {
        ctx.beginPath();
        [...this.partitions, ...extra].forEach(({ direction, lWidth=1, range, strtPos=0, stopPos=100 }) => {
            ctx.lineWidth = lWidth;
            if (direction === "col") {
                let y = Math.round(strtPos*this.height/100); 
                let yHat = Math.round(stopPos*this.height/100);
                ctx.moveTo((range * this.width) / 100, y);
                ctx.lineTo((range * this.width) / 100, yHat);
            } else {
                let x = Math.round(strtPos*this.width/100); 
                let xHat = Math.round(stopPos*this.width/100);
                ctx.moveTo(x, (range * this.height) / 100);
                ctx.lineTo(xHat, (range * this.height) / 100);
            }
        });
        ctx.stroke();
    }

    /** Table headers + column grid (legacy drawTable). */
    drawTable(ctx, page) {
        const { plan } = this;
        if (!plan || Object.keys(plan).length === 0) return;
        let { cols = [], padding = 10, fSize = 16, thHeight = 5, tbodyHeight = 50, autoClose = true } = plan;
        if (cols.length === 0) return;
        const netPercent = cols.reduce((acc, { width }) => acc + width, 0);
        if (netPercent > 100)
            return alert("Net column widths cannot exceed width of it's host.");
        ctx.font = `bold ${fSize}px ${page.fFamily}`;
        ctx.beginPath();
        ctx.moveTo(0, thHeight*this.height/100);
        ctx.lineTo(this.width, thHeight*this.height/100);
        let xPos = 0;
        const yPos = (thHeight*this.height/100 + fSize) / 2;
        cols.forEach((col) => {
            const { label, width: colWidth } = col;
            col.xPos = xPos;
            col.yPos = yPos;
            ctx.fillText(label, xPos + padding, yPos, (colWidth / 100) * this.width);
            xPos += (colWidth / 100) * this.width;
            ctx.moveTo(xPos, 0);
            ctx.lineTo(xPos, this.height*tbodyHeight/100);
        });
        if(autoClose){
            ctx.moveTo(0, this.height*tbodyHeight/100);
            ctx.lineTo(this.width, this.height*tbodyHeight/100);
        }
        ctx.stroke();
        ctx.fill();
    }
}

class Header extends Section {
    constructor(data = {}) {
        super({ ...data, role: "head" });
    }
}

class Body extends Section {
    constructor(data = {}) {
        super({ ...data, role: "body" });
    }
}

class Footer extends Section {
    constructor(data = {}) {
        super({ ...data, role: "footer" });
    }
}

// ---------------------------------------------------------------------------
// Field (+ TextField / VariableField / ImageField by type)
// ---------------------------------------------------------------------------
class Field extends Element {
    constructor(data = {}) {
        super(data);
        this.type = data.type ?? "string"; // "string" | "variable" | "image"
        this.text = data.text ?? ""; // static prefix ("Bill No: ")
        this.fSize = data.fSize ?? 16;
        this.fFamily = data.fFamily ?? "Times-Roman";
        this.fWidth = data.fWidth ?? 50; // % of the host section width
        this.bold = data.bold ?? false;
        this.italic = data.italic ?? false;
        this.underline = data.underline ?? false;
        this.fType = data.fType ?? ""; // variable key (billVariableRegistry)
        this.elem = data.elem ?? null;
        // Host section — a feild nested in its band (head/body/footer);
        // the Element constructor resolves range coordinates against it.
        this.parent = data?.parent;
        // Label/value layout inside ONE feild — "space-between" pins the
        // label left and the value right (the legacy two-column look, e.g.
        // default1's summary block); "alongside" flows the value right
        // after the label ("Address: Main Road"). The engine reads the
        // same key; pre-align templates (no key) print joined like legacy.
        this.align = data.align ?? "space-between";
        // Legacy insertFeild always stamps zIndex 100 on a feild's canvas.
        this.zIndex = data.zIndex ?? 100;
        this.imgWidth = data.imgWidth ?? 10;
        this.imgHeight = data.imgHeight ?? 10;
        this.imgOpacity = data.imgOpacity ?? 100;
        this.imgTag = data.imgTag ?? "";
        this.applyAspectRatio = data.applyAspectRatio ?? false;
        this.aspectRatio = data.aspectRatio ?? "1:1";
    }

    /** Legacy feild JSON — the exact keys the engine reads. */
    toJSON() {
        const obj = { type: this.type, x: this.x, y: this.y, zIndex: this.zIndex };
        if (this.type === "image")
            Object.assign(obj, {
                imgWidth: this.imgWidth,
                imgHeight: this.imgHeight,
                imgOpacity: this.imgOpacity,
                imgTag: this.imgTag,
                applyAspectRatio: this.applyAspectRatio,
                aspectRatio: this.aspectRatio,
            });
        else {
            Object.assign(obj, {
                fSize: this.fSize,
                fFamily: this.fFamily,
                text: this.text,
                fWidth: this.fWidth,
                align: this.align,
                bold: this.bold,
                italic: this.italic,
                underline: this.underline,
            });
            if (this.type === "variable") obj.fType = this.fType;
        }
        return obj;
    }

    /**
     * Create the per-element <canvas> (legacy createFeildCanvas).
     * Fixes two legacy zoom quirks: the canvas gets dataset.left/top so
     * zoomFunc repositions it like sections, and style.left/top honor the
     * current zoomFactor instead of dropping the feild at logical px.
     */
    createCanvas(mainDiv, zoomFactor = 1) {
        let { width: width_mainDiv, height: height_mainDiv } =
            mainDiv.getBoundingClientRect();
        let feildCanv = document.createElement("canvas");
        if (!this.elem || !document.contains(this.elem)) {
            mainDiv.appendChild(feildCanv);
            let x = this.x || width_mainDiv / 2;
            let y = this.y || height_mainDiv / 2;
            feildCanv.style.left = x * zoomFactor + "px";
            feildCanv.style.top = y * zoomFactor + "px";
            feildCanv.dataset.left = x;
            feildCanv.dataset.top = y;
            feildCanv.style.position = "absolute";
            feildCanv.dataset.id = this.id || uuid();
            this.id = feildCanv.dataset.id;
            feildCanv.className = "feild-elem new-elem";
            if (this.type === "image") feildCanv.classList.add("image-placeholder");
        }
        this.elem = feildCanv;
        return feildCanv;
    }

    /**
     * Draw this feild on its canvas (legacy drawFeildText / imageBox).
     * Returns the canvas; the caller keeps it as `feildObj.elem`.
     */
    draw(mainDiv, page, zoomFactor = 1) {
        if (this.type === "image") {
            let { elem, imgWidth, imgHeight } = this;
            elem.classList.add("image-placeholder");
            let { top, left } = elem.getBoundingClientRect();
            let parentNode =
                [...document.elementsFromPoint(left, top)]
                    .filter(
                        (_elem) =>
                            _elem.classList.contains("new-elem") && _elem !== elem
                    )
                    .reverse()
                    .pop() ?? mainDiv;
            // Logical units on the backing store (1px = 1pt); the CSS box
            // carries the zoom — the same contract as Section.draw.
            let { width } = parentNode.getBoundingClientRect();
            width = width / zoomFactor;
            elem.width = (imgWidth * width) / 100;
            elem.height = (imgHeight * width) / 100;
            elem.style.width = elem.width * zoomFactor + "px";
            elem.style.height = elem.height * zoomFactor + "px";
            elem.dataset.width_100 = elem.width;
            elem.dataset.height_100 = elem.height;
            elem.dataset.aspectRatio =
                Math.round((elem.width / elem.height) * 100) / 100;
            elem.style.zIndex = 100;
            this.zIndex = 100;
            let ctx = elem.getContext("2d");
            ctx.fillStyle =
                "#FF3939" +
                Math.round(this.imgOpacity * 0.01 * 255)
                    .toString(16)
                    .toUpperCase();
            ctx.fillRect(0, 0, elem.width, elem.height);
            ctx.strokeText(
                "_img",
                elem.width / 2 - ctx.measureText("_img").width / 2,
                elem.height / 2
            );
            ctx.fill();
            return elem;
        }
        let { fSize, text = "", fType, elem, fFamily, fWidth, align = "space-between" } = this;
        let ctx = elem.getContext("2d");
        let { left, top } = elem.getBoundingClientRect();
        ctx.fillStyle = "black";
        ctx.font = fSize + "px " + page.fFamily;
        let label = text + (this.type === "variable" && text !== "" ? ": " : "");
        let value = this.type === "variable" ? (fType ?? "") : "";
        // fWidth is % of the host's LOGICAL width. A feild nested via the
        // position mechanism measures its declared parent's content box
        // (width minus padding) — no DOM hit-test luck; everything else
        // keeps the legacy hit-test (whatever .new-elem sits under the
        // canvas corner) with the page div as fallback. The backing store
        // stays in logical units (1px = 1pt) and the CSS box carries the
        // zoom, the same contract as Section.draw: on-screen the text keeps
        // the paper's proportions at every zoom level instead of rendering
        // at literal fSize screen px.
        let parentWidth;
        if (this.parent?.width) {
            parentWidth =
                this.parent.width -
                (this.parent.padding?.left || 0) -
                (this.parent.padding?.right || 0);
        } else {
            let parentElem =
                [...document.elementsFromPoint(left, top)]
                    .filter(
                        (_elem) => _elem.classList.contains("new-elem") && _elem !== elem
                    )
                    ?.pop() ?? mainDiv;
            parentWidth = parentElem.getBoundingClientRect().width / zoomFactor;
        }
        let widthConstraints = (parentWidth * fWidth) / 100;
        elem.style.zIndex = 100;
        let style = "";
        for (let key of ["bold", "italic"]) {
            if (!(key in this)) continue;
            if (this[key]) style += key + " ";
        }
        // Designer-only fit: the canvas is SYMBOLIC (it shows the variable
        // KEY, not a live value), so the drawn size shrinks until the label
        // and key sit on one line inside the box — the SAVED fSize is
        // untouched and the engine prints it on paper. The user reads the
        // arrangement (label left / value right), not the font metrics.
        let drawSize = fSize;
        const fits = (size) => {
            ctx.font = style + " " + size + "px " + fFamily;
            let width = align === "space-between" && value !== ""
                ? ctx.measureText(label).width + ctx.measureText(value).width + size
                : ctx.measureText(label + value).width;
            return width <= widthConstraints;
        };
        while (drawSize > 8 && !fits(drawSize)) drawSize -= 1;
        ctx.font = style + " " + drawSize + "px " + fFamily;
        // Layout first (measure-only), THEN size the backing store: assigning
        // canvas width/height resets the bitmap to transparent, so anything
        // painted before this point would be wiped — the feilds went blank
        // when the resize sat after the draw calls.
        let height, multiplier = 1, line = "";
        const fitted = fits(drawSize);
        let lines = [];
        if (!fitted) {
            // Even the minimum size overflows — wrap like the legacy
            // drawFeildText (label and value flow together, symbolic).
            let words = (label + value).split(" ");
            for (const word of words) {
                let testLine = line + word + " ";
                let testLineWidth = ctx.measureText(testLine).width;
                if (testLineWidth > widthConstraints) {
                    lines.push(line);
                    line = word + " ";
                    multiplier += 1;
                } else line = testLine;
            }
            lines.push(line);
            height = multiplier * drawSize + 16;
        } else
            height = drawSize + 16;
        elem.width = widthConstraints;
        elem.height = height;
        elem.style.width = widthConstraints * zoomFactor + "px";
        elem.style.height = height * zoomFactor + "px";
        ctx.clearRect(0, 0, elem.width, elem.height);
        if (fitted) {
            if (align === "space-between" && value !== "") {
                ctx.textAlign = "left";
                ctx.fillText(label, 0, drawSize);
                ctx.textAlign = "right";
                ctx.fillText(value, widthConstraints, drawSize);
                ctx.textAlign = "left";
            } else
                ctx.fillText(label + value, 0, drawSize);
        } else
            lines.forEach((l, i) => ctx.fillText(l, 0, drawSize + i * (drawSize + 8)));
        // Pre-seed the zoom caches so zoomFunc keeps the correct base size;
        // dataset.lines feeds the designer's flowFeild push-down rule.
        elem.dataset.width_100 = widthConstraints;
        elem.dataset.height_100 = height;
        elem.dataset.aspectRatio =
            Math.round((widthConstraints / height) * 100) / 100;
        elem.dataset.lines = multiplier;
        let selector = document.getElementById("selector");
        if (selector) selector.style.width = elem.width * zoomFactor + 40 + "px";
        if ("underline" in this && this.underline) {
            ctx.moveTo(0, drawSize + 3);
            ctx.lineWidth = drawSize * (/"bold"/.test(style) ? 0.16 : 0.08);
            ctx.lineTo(
                align === "space-between" && value !== "" ? widthConstraints : ctx.measureText(label + value).width,
                drawSize + 3
            );
            ctx.stroke();
        }
        ctx.fill();
        return elem;
    }
}

class TextField extends Field {
    constructor(data = {}) {
        super({ ...data, type: "string" });
    }
}

class VariableField extends Field {
    constructor(data = {}) {
        super({ ...data, type: "variable" });
    }
}

class ImageField extends Field {
    constructor(data = {}) {
        super({ ...data, type: "image" });
    }
}

// ---------------------------------------------------------------------------
// Table — a section's plan.
// ---------------------------------------------------------------------------
class Table {
    constructor(data = {}, hostWidth = 0) {
        this.thHeight = data.thHeight ?? 32;
        this.fSize = data.fSize ?? 16;
        this.rSpacing = data.rSpacing ?? 8;
        this.padding = data.padding ?? 10;
        this._hostWidth = hostWidth;
        this.tbodyHeight = data.tbodyHeight;
        // Column variable key is `var` (the legacy engine contract), not `variable`.
        this.cols = (data.cols ?? []).map((col) => ({
            label: col.label ?? "",
            var: col.var ?? "slno",
            width: col.width ?? 20,
        }));
    }

    static fromJSON(obj, hostWidth) {
        return new Table(obj, hostWidth);
    }

    /**
     * Legacy plan JSON. Column widths are % of the host section; the engine
     * reads the stored xPos/yPos, so materialize them cumulatively here.
     */
    toJSON(hostWidth = this._hostWidth || 0) {
        let xPos = 0;
        const yPos = (this.thHeight + this.fSize) / 2;
        return {
            thHeight: this.thHeight,
            fSize: this.fSize,
            rSpacing: this.rSpacing,
            padding: this.padding,
            cols: this.cols.map((col) => {
                const out = {
                    label: col.label,
                    var: col.var,
                    width: col.width,
                    xPos,
                    yPos,
                };
                xPos += (col.width * hostWidth) / 100;
                return out;
            }),
        };
    }
}

// ---------------------------------------------------------------------------
// Page — the template document.
// ---------------------------------------------------------------------------
class Page extends Element {
    constructor(data = {}) {
        super(data);
        this.size = data.size ?? "a4";
        this.width = data.width;
        this.height = data.height;
        this.applyMargin = data.applyMargin ?? false;
        // Legacy: an object {top,bottom,left,right} or a scalar (D2 style).
        this.margin = data.margin ?? { top: 0, bottom: 0, left: 0, right: 0 };
        // Empty role sections stay {} — the legacy designer renders only
        // sections with content (set-opened-file checks Object.keys > 1).
        this.head = Object.keys(data.head ?? {}).length
            ? Section.fromJSON(data.head)
            : {};
        this.body = Object.keys(data.body ?? {}).length
            ? Section.fromJSON(data.body)
            : {};
        this.footer = Object.keys(data.footer ?? {}).length
            ? Section.fromJSON(data.footer)
            : {};
        this.sections = (data.sections ?? []).map((sec) => Section.fromJSON(sec));
        this.feilds = (data.feilds ?? []).map((feild) => Field.fromJSON(feild));
        this.applyBorder = data.applyBorder ?? false;
        this.border = data.border ?? 1;
        this.newDoc = data.newDoc ?? true;
        this.filePath = data.filePath ?? "";
        this.fFamily = data.fFamily ?? "Times-Roman";
    }

    static blank() {
        return new Page();
    }

    /** The exact legacy template contract the engine reads. */
    toJSON() {
        return {
            size: this.size,
            applyMargin: this.applyMargin,
            margin: this.margin,
            head: Page.elemRemoval(this.head),
            body: Page.elemRemoval(this.body),
            footer: Page.elemRemoval(this.footer),
            feilds: this.feilds.map((feild) => Page.elemRemoval(feild)),
            sections: this.sections.map((sec) => Page.elemRemoval(sec)),
            applyBorder: this.applyBorder,
            border: this.border,
            newDoc: this.newDoc,
            filePath: this.filePath,
            fFamily: this.fFamily,
        };
    }

    /**
     * Legacy elemRemoval (ported): strips the runtime keys (elem /
     * parentNode / id) recursively. Class instances serialize through
     * their own toJSON first, so padding/margin (class-only conveniences)
     * never leak into saved templates.
     */
    static elemRemoval(obj) {
        if (obj instanceof Element) obj = obj.toJSON();
        if (obj && Object.keys(obj).length > 0) {
            let _obj = obj instanceof Array ? [...obj] : { ...obj };
            return Object.keys(_obj).reduce(
                (acc, key) => {
                    if (["elem", "parentNode", "id"].includes(key))
                        Reflect.deleteProperty(_obj, key);
                    else if (
                        typeof _obj[key] === "object" &&
                        Object.keys(_obj[key]).length > 0
                    )
                        acc[key] = Page.elemRemoval(_obj[key]);
                    else acc[key] = _obj[key];
                    return acc;
                },
                _obj instanceof Array ? [] : {}
            );
        } else return {};
    }
}

// ---------------------------------------------------------------------------
// Main-section defaults — the canonical band a Header / Body / Footer takes
// when its role is assigned in the designer: full page width (8pt gutters),
// at the top / middle / bottom of the page. These are the Three Sections
// starter coordinates on an A4 page, scaled proportionally to the host page.
// ---------------------------------------------------------------------------
const MAIN_SECTION_BANDS = {
    head: { x: 8, y: 8, width: 579.28, height: 246 },
    body: { x: 8, y: 262, width: 579.28, height: 330 },
    footer: { x: 8, y: 600, width: 579.28, height: 234 },
};
const BAND_PAGE = { width: 595.28, height: 841.89 }; // A4 the bands were measured on

/** x/y/width/height a main-role section takes on the given page size. */
function mainSectionBand(role, pageWidth = BAND_PAGE.width, pageHeight = BAND_PAGE.height) {
    const band = MAIN_SECTION_BANDS[role];
    if (!band) return null;
    const sx = pageWidth / BAND_PAGE.width;
    const sy = pageHeight / BAND_PAGE.height;
    return {
        x: band.x * sx,
        y: band.y * sy,
        width: band.width * sx,
        height: band.height * sy,
    };
}

// ---------------------------------------------------------------------------
// Starter templates — picker function assembling element combinations at
// the legacy hardcoded coordinates (buildPage.default.js).
// ---------------------------------------------------------------------------

/** Compact feild factory for the starters below. */
function F({ type = "string", x, y, parent, useRangeCoordinates, xRange, yRange, text = "", fType, fSize = 12, fWidth = 100, align = "space-between", bold = false, italic = false, underline = false }) {
    return new Field({ type, x, y, parent, useRangeCoordinates, xRange, yRange, text, fType, fSize, fWidth, align, bold, italic, underline });
}

/** Compact section factory. */
function S({ x, y, width, height, role = "section", name, applyBorder = true, border = 1, partitions = [], plan, shape = "rectangle", cornerRadius, parent, padding, margin, useRangeCoordinates, xRange, yRange, zIndex, useRangeDimensions, widthRange, heightRange }) {
    const data = { x, y, width, height, role, name, applyBorder, border, partitions, plan, shape, parent, padding, margin, useRangeCoordinates, xRange, yRange, zIndex, useRangeDimensions, widthRange, heightRange };
    if (cornerRadius !== undefined) data.cornerRadius = cornerRadius;
    return new Section(data);
}

function starterSections(appDefault) {
    const a4 = appDefault?.a4 ?? { width: 595.28, height: 841.89 };
    const page = new Page({ size: "a4" });
    const head = new Header({
        ...mainSectionBand("head", a4.width, a4.height),
        applyBorder: true,
    });
    const bodyBand = mainSectionBand("body", a4.width, a4.height);
    const body = new Body({
        ...bodyBand,
        applyBorder: true,
        plan: new Table(
            {
                thHeight: 32,
                fSize: 16,
                rSpacing: 8,
                padding: 10,
                cols: [
                    { label: "Sl No", var: "slno", width: 10 },
                    { label: "Item", var: "name", width: 45 },
                    { label: "Qty", var: "qty", width: 15 },
                    { label: "Rate", var: "rate", width: 15 },
                    { label: "Amount", var: "amt", width: 15 },
                ],
            },
            bodyBand.width
        ),
    });
    const footer = new Footer({
        ...mainSectionBand("footer", a4.width, a4.height),
        applyBorder: true,
    });
    page.head = head;
    page.body = body;
    page.footer = footer;
    page.feilds = [
        F({ x: 8, y: 14, text: "TAX INVOICE", fSize: 16, bold: true }),
        new VariableField({ x: 8, y: 38, fType: "biller-name", fSize: 14, bold: true }),
        new VariableField({ x: 8, y: 58, text: "Address: ", fType: "biller-address" }),
        new VariableField({ x: 8, y: 74, text: "Contact number: ", fType: "biller-phone" }),
        new VariableField({ x: 8, y: 90, text: "GST number: ", fType: "biller-gst" }),
        new VariableField({ x: 300, y: 38, text: "Bill No: ", fType: "billNo" }),
        new VariableField({ x: 300, y: 58, text: "Date: ", fType: "date" }),
        F({ x: 300, y: 78, text: "Bill To:" }),
        new VariableField({ x: 300, y: 94, fType: "customer-name" }),
        new VariableField({ x: 300, y: 110, text: "Address: ", fType: "customer-address" }),
        new VariableField({ x: 300, y: 126, text: "GST: ", fType: "customer-gst" }),
        new VariableField({ x: 8, y: 610, text: "Total Amount: ", fType: "netAmtTax" }),
        new VariableField({ x: 300, y: 610, text: "Grand Total: ", fType: "grand-total" }),
        new VariableField({ x: 8, y: 630, text: "Net Due: ", fType: "netDue" }),
        F({ x: 8, y: 680, text: "Thank You!", italic: true }),
        new VariableField({ x: 8, y: 730, text: "For ", fType: "biller-name", bold: true, italic: true }),
        F({ x: 8, y: 770, text: "Authorised Signatory" }),
    ];
    // Legacy starter: pin every feild to the flowing "alongside" look
    // (label and value joined). See starterDefault1 for the rationale.
    page.feilds.forEach((f) => {
        if (f.type !== "image" && !("align" in f)) f.align = "alongside";
    });
    return page;
}

/**
 * Default 1 — the hardcoded `createHeader/createBody/createFooter` layout
 * transcribed at its exact coordinates. Approximations (documented):
 * the dynamic-y underline/consignee lines are skipped, IGST + Total share
 * one cell, and no seal / scrap-TDS conditional rows are pre-drawn.
 *
 * Feilds are nested in their host section via `parent` and placed with
 * range coordinates (% of the host's content box), mapping the legacy
 * absolute coordinates onto each band's partition grid.
 */
function starterDefault1(configs = {}) {
    const { margin=10,bankDetails,biller,phones,gst,address,email,padding=10,a4 } = configs;
    // In future we will replace page config value from app configs to configs set in designer window.
    const { top,bottom,right,left } = typeof margin == "object" ? margin : { top:margin,bottom:margin,right:margin,left:margin };
    const { top:tPad,bottom:bPad,right:rPad,left:lPad } = typeof margin == "object" ? padding : { top:padding,bottom:padding,right:padding,left:padding };
    const pageSize = a4 ?? { width: 595.28, height: 841.89 }; // A4 fallback when called without configs
    const page = new Page({
        size: "a4",
        margin: { top,bottom,left,right },
        applyMargin:true,
        width:pageSize.width,
        height:pageSize.height,
        padding: { top:tPad,bottom:bPad,left:lPad,right:rPad }
    });
    page.sections.push(
        S({
            name: "Page Border",
            parent:page
        })
    ); 
    page.head = new Header({
        useRangeCoordinates:true,
        yRange: 0,
        xRange:false,
        applyBorder: false,
        useRangeDimensions:true,
        widthRange:false,
        heightRange:30,
        name:"Header",
        parent:page,
        zIndex:1,
        partitions:[
            { direction:"row", range:14, strtPos:50 },
            { direction:"row", range:45, strtPos:50 },
            { direction:"row", range:100, strtPos:0 },
            { direction:"row", range:40, strtPos:0, stopPos:50 },
            { direction:"row", range:70, strtPos:0, stopPos:50 },
            { direction:"col", range:50, strtPos:0, stopPos:100 },
        ]
    })
    page.body = new Body({
        useRangeCoordinates:true,
        yRange: 30,
        xRange:false,
        applyBorder: false,
        useRangeDimensions:true,
        widthRange:false,
        heightRange:45,
        name:"Itemized table",
        parent:page,
        zIndex:3,
        plan: new Table(
            {
                thHeight: 5,
                fSize: 12,
                rSpacing: 8,
                padding: 10,
                tbodyHeight:100,
                cols: [
                    { label: "Sl No", var: "slno", width: 6 },
                    { label: "Product Description", var: "name", width: 30 },
                    { label: "HSN", var: "hsn", width: 6 },
                    { label: "Quantity", var: "qty", width: 8 },
                    { label: "Unit", var: "unit", width: 6 },
                    { label: "Unit Price", var: "rate", width: 6},
                    { label: "Amount", var: "amt", width: 10 },
                    { label: "CGST", var: "CGST", width: 6 },
                    { label: "SGST", var: "SGST", width: 6 },
                    { label: "IGST", var: "SGST", width: 6 },
                    { label: "Total", var: "netAmt", width: 10 },
                ],
            },
            590
        ),
    });
    page.footer = new Footer({
        useRangeCoordinates:true,
        xRange:false,
        yRange:75,
        useRangeDimensions:true,
        widthRange:false,
        heightRange:25,
        zIndex:10,
        parent:page,
        applyBorder: false,
        partitions: [
            { direction:"row", range:10 },
            { direction: "col", range: 50 }, // x = 300
            { direction: "col", range: 78 }, // x = 460
        ],
    });

    // Feilds are nested in their host section via `parent` and placed with
    // range coordinates — % of the host's content box. The values map the
    // legacy buildPage.default coordinates onto each band's partition grid:
    //   head   — biller block left of the col-50 line; invoice meta above
    //            the row-14 line; customer block between row-14 and row-45
    //   footer — words/signatory left of col-50; summary pairs between
    //            col-50 and col-78; tax mini-box above the row-10 line;
    //            receiver's signature right of col-78
    page.feilds = [
        // Header — biller block (left column, above the row-40 line)
        new VariableField({ parent: page.head, useRangeCoordinates: true, xRange: 0.35, yRange: 11.76, fType: "biller-name", fSize: 16, bold: true }),
        new VariableField({ parent: page.head, useRangeCoordinates: true, xRange: 0.35, yRange: 20.17, text: "Address: ", fType: "biller-address", fWidth: 45 }),
        new VariableField({ parent: page.head, useRangeCoordinates: true, xRange: 0.35, yRange: 26.89, text: "Contact number: ", fType: "biller-phone", fWidth: 45 }),
        new VariableField({ parent: page.head, useRangeCoordinates: true, xRange: 0.35, yRange: 33.61, text: "GST number: ", fType: "biller-gst", fWidth: 45 }),
        // Header — invoice meta (right column, above the row-14 line)
        new VariableField({ parent: page.head, useRangeCoordinates: true, xRange: 76.48, yRange: 3.36, fType: "bill-copy", fSize: 10, fWidth: 20 }),
        new VariableField({ parent: page.head, useRangeCoordinates: true, xRange: 51.28, yRange: 6.3, text: "Invoice No: ", fType: "billNo", fSize: 14, bold: true, fWidth: 30 }),
        new VariableField({ parent: page.head, useRangeCoordinates: true, xRange: 87.96, yRange: 6.3, text: "Date: ", fType: "date-slash", fWidth: 12 }),
        // Header — customer block (right column, row-14 → row-45)
        F({ parent: page.head, useRangeCoordinates: true, xRange: 51.28, yRange: 16, text: "Bill to:", fWidth: 45 }),
        new VariableField({ parent: page.head, useRangeCoordinates: true, xRange: 51.28, yRange: 22.7, fType: "customer-name", fWidth: 45 }),
        new VariableField({ parent: page.head, useRangeCoordinates: true, xRange: 51.28, yRange: 29.4, text: "Address: ", fType: "customer-address", fWidth: 45 }),
        new VariableField({ parent: page.head, useRangeCoordinates: true, xRange: 51.28, yRange: 36.1, text: "Phone No: ", fType: "customer-phone", fWidth: 45 }),
        new VariableField({ parent: page.head, useRangeCoordinates: true, xRange: 51.28, yRange: 42.8, text: "GST No: ", fType: "customer-gst", fWidth: 45 }),
        // Footer — amount in words + signatory (left of col-50, below row-10)
        F({ parent: page.footer, useRangeCoordinates: true, xRange: 0.35, yRange: 13.91, text: "Total in words", italic: true }),
        new VariableField({ parent: page.footer, useRangeCoordinates: true, xRange: 0.35, yRange: 21.21, fType: "gtotal-words", fWidth: 45 }),
        F({ parent: page.footer, useRangeCoordinates: true, xRange: 0.35, yRange: 35.81, text: "Authorised Signatory" }),
        new VariableField({ parent: page.footer, useRangeCoordinates: true, xRange: 0.35, yRange: 43.11, text: "For ", fType: "biller-name", bold: true, italic: true }),
        F({ parent: page.footer, useRangeCoordinates: true, xRange: 5.22, yRange: 60.14, text: "(Proprietor)", italic: true }),
        // Footer — summary pairs (labels left, values right; col-50 → col-78).
        // align "space-between" renders the pair in ONE feild — the value
        // right-aligned at the box edge — replacing the legacy two-feild
        // pairs (commented below). fWidth 27 = the col-50→col-78 span.
        new VariableField({ parent: page.footer, useRangeCoordinates: true, xRange: 51.28, yRange: 16, text: "Total quantity: ", fType: "netQty", fWidth: 27, align: "space-between" }),
        // new VariableField({ parent: page.footer, useRangeCoordinates: true, xRange: 68.66, yRange: 16.34, fType: "netQty", fWidth: 12 }),
        new VariableField({ parent: page.footer, useRangeCoordinates: true, xRange: 51.28, yRange: 32, text: "Total before Tax: ", fType: "total-before-tax", fWidth: 27, align: "space-between" }),
        // new VariableField({ parent: page.footer, useRangeCoordinates: true, xRange: 68.66, yRange: 23.64, fType: "total-before-tax", fWidth: 12 }),
        new VariableField({ parent: page.footer, useRangeCoordinates: true, xRange: 51.28, yRange: 48, text: "Total discount: ", fType: "total-discount", fWidth: 27, align: "space-between" }),
        // new VariableField({ parent: page.footer, useRangeCoordinates: true, xRange: 68.66, yRange: 30.94, fType: "total-discount", fWidth: 12 }),
        new VariableField({ parent: page.footer, useRangeCoordinates: true, xRange: 51.28, yRange: 64, text: "Total Tax: ", fType: "netTax", fWidth: 27, align: "space-between" }),
        // new VariableField({ parent: page.footer, useRangeCoordinates: true, xRange: 68.66, yRange: 38.24, fType: "netTax", fWidth: 12 }),
        new VariableField({ parent: page.footer, useRangeCoordinates: true, xRange: 51.28, yRange: 80, text: "Rounded off: ", fType: "ro", fWidth: 27, align: "space-between" }),
        // new VariableField({ parent: page.footer, useRangeCoordinates: true, xRange: 68.66, yRange: 45.54, fType: "ro", fWidth: 12 }),
        new VariableField({ parent: page.footer, useRangeCoordinates: true, xRange: 51.28, yRange: 96, text: "Grand Total: ", fType: "grand-total", fSize: 14, bold: true, fWidth: 27, align: "space-between" }),
        // new VariableField({ parent: page.footer, useRangeCoordinates: true, xRange: 68.66, yRange: 52.84, fType: "grand-total", fSize: 14, bold: true, fWidth: 12 }),
        // Footer — tax mini-box (CGST/SGST split, above the row-10 line)
        // new VariableField({ parent: page.footer, useRangeCoordinates: true, xRange: 72.14, yRange: 4.18, fType: "net-CGST", fWidth: 8 }),
        // new VariableField({ parent: page.footer, useRangeCoordinates: true, xRange: 79.09, yRange: 4.18, fType: "net-SGST", fWidth: 8 }),
        // Footer — receiver's signature (right of col-78)
        F({ parent: page.footer, useRangeCoordinates: true, xRange: 78.22, yRange: 60.14, text: "(Receiver's signature)", fSize: 10, italic: true, fWidth: 15 }),
    ];
    // Pre-align starter feilds: everything NOT carrying an explicit align
    // behaves like the legacy templates — label and value flow together
    // ("Address: Main Road"). The summary pairs above opt into the new
    // space-between look. The engine treats a MISSING align as alongside
    // too, so old templates saved before this property print unchanged.
    page.feilds.forEach((f) => {
        if (f.type !== "image" && !("align" in f)) f.align = "alongside";
    });
    return page;
}

/**
 * Default 2 — the hardcoded `createHeader2/createBody2/createFooter2`
 * layout transcribed at its exact coordinates (factor = 29.264, scalar
 * margin 10). Approximations (documented): the D2 date reversal
 * (dd-yyyy-mm) prints as registry date, the TAX RATE%/SGST/CGST/TOTAL
 * GST grid is excluded, footer ys are static, and no seal is pre-drawn.
 */
function starterDefault2() {
    // The page carries its own width/height/padding (same shape as
    // default1) so feilds hosted by the page resolve range coordinates and
    // fWidth against the A4 CONTENT box (575.28×821.89) instead of the
    // full 595.28×841.89 sheet.
    const page = new Page({
        size: "a4",
        applyMargin: true,
        margin: 10,
        width: 595.28,
        height: 841.89,
        padding: { top: 10, bottom: 10, left: 10, right: 10 },
    });
    const billerBox = S({ x: 10, y: 10, width: 575, height: 110, name: "Biller box" });
    const metaBox = S({
        x: 10,
        y: 120,
        width: 575,
        height: 60,
        name: "Meta box",
        partitions: [{ direction: "col", range: 50.02, lWidth: 1 }],
    });
    const customerBox = S({
        x: 10,
        y: 180,
        width: 575,
        height: 88,
        name: "Customer box",
        partitions: [{ direction: "col", range: 50.02, lWidth: 1 }],
    });
    page.sections.push(billerBox, metaBox, customerBox);
    page.body = new Body({
        x: 10,
        y: 268,
        width: 575,
        height: 400,
        applyBorder: false,
        partitions: [
            { direction: "col", range: 4.87, lWidth: 1 }, // x = 38
            { direction: "col", range: 50.02, lWidth: 1 }, // x = 297.64
            { direction: "col", range: 60.2, lWidth: 1 }, // x = 356.17
            { direction: "col", range: 70.38, lWidth: 1 }, // x = 414.7
            { direction: "col", range: 75.47, lWidth: 1 }, // x = 443.96
            { direction: "col", range: 85.65, lWidth: 1 }, // x = 502.49
            { direction: "col", range: 90.74, lWidth: 1 }, // x = 531.75
        ],
        plan: new Table(
            {
                thHeight: 27,
                fSize: 12,
                rSpacing: 8,
                padding: 10,
                cols: [
                    { label: "S.N.", var: "slno", width: 4.87 },
                    { label: "Product Description", var: "name", width: 45.15 },
                    { label: "HSN/SA C", var: "hsn", width: 10.18 },
                    { label: "QUANTITY", var: "qty", width: 10.18 },
                    { label: "UNIT", var: "unit", width: 5.09 },
                    { label: "PRICE/UNIT", var: "rate", width: 10.18 },
                    { label: "GST", var: "gst", width: 5.09 },
                    { label: "AMOUNT", var: "netAmt", width: 9.26 },
                ],
            },
            575
        ),
    });
    const signatureBox = S({
        x: 10,
        y: 790,
        width: 575,
        height: 40,
        name: "Signature box",
        partitions: [
            { direction: "col", range: 50.02, lWidth: 1 },
            { direction: "row", range: 33.3, lWidth: 1 },
        ],
    });
    page.sections.push(signatureBox);
    // Feilds are nested in their host via `parent` + range coordinates
    // (% of the host's content box) — the position mechanism default1
    // uses. Ranges reproduce the legacy absolutes to a fraction of a pt:
    //   x = host.x + xRange × contentW/100   y = host.y + yRange × contentH/100
    // Feilds with no box around them (y692–834 — jurisdiction, bank,
    // words and the summary block) are hosted by the page itself: its
    // content box is the A4 sheet minus the 10pt margin, so x = 10 + xRange
    // × 5.7528 and y = 10 + yRange × 8.2189. The summary label column
    // (legacy x 361.17) is 61.04% and the value column (legacy x 438.96)
    // is 74.57% of that content box.
    page.feilds = [
        // ---- Biller box (575×110) ----
        new VariableField({ parent: billerBox, useRangeCoordinates: true, xRange: 0.87, yRange: 4.55, text: "GSTIN: ", fType: "biller-gst", fSize: 10 }),
        new VariableField({ parent: billerBox, useRangeCoordinates: true, xRange: 83.48, yRange: 4.55, fType: "bill-copy", fSize: 10, fWidth: 15 }),
        F({ parent: billerBox, useRangeCoordinates: true, xRange: 40, yRange: 14.55, text: "GST INVOICE", fSize: 14, bold: true, underline: true }),
        F({ parent: billerBox, useRangeCoordinates: true, xRange: 41.74, yRange: 29.09, text: "|| SHREE HARI ||" }),
        new VariableField({ parent: billerBox, useRangeCoordinates: true, xRange: 38.26, yRange: 43.64, text: "M/s. ", fType: "biller-name", fSize: 16, bold: true }),
        new VariableField({ parent: billerBox, useRangeCoordinates: true, xRange: 33.04, yRange: 58.18, fType: "biller-address" }),
        new VariableField({ parent: billerBox, useRangeCoordinates: true, xRange: 36.52, yRange: 72.73, text: "Contact: ", fType: "biller-phone" }),
        // ---- Meta box (575×60) ----
        new VariableField({ parent: metaBox, useRangeCoordinates: true, yRange: 16.67, text: "Invoice No.: ", fType: "billNo", fWidth: 48 }),
        new VariableField({ parent: metaBox, useRangeCoordinates: true, yRange: 43.33, text: "Invoice Date: ", fType: "date", fWidth: 48 }),
        new VariableField({ parent: metaBox, useRangeCoordinates: true, yRange: 70, text: "Place of supply: ", fType: "placeOfSupply", fWidth: 48 }),
        new VariableField({ parent: metaBox, useRangeCoordinates: true, xRange: 50.02, yRange: 16.67, text: "Transport: ", fType: "transportName", fWidth: 48 }),
        new VariableField({ parent: metaBox, useRangeCoordinates: true, xRange: 50.02, yRange: 43.33, text: "G.R.No.: ", fType: "orderRef", fWidth: 48 }),
        new VariableField({ parent: metaBox, useRangeCoordinates: true, xRange: 50.02, yRange: 70, text: "Eway bill no: ", fType: "ewayBill", fWidth: 48 }),
        // ---- Customer box (575×88) ----
        F({ parent: customerBox, useRangeCoordinates: true, yRange: 11.36, text: "Billed to:", underline: true, fWidth: 48 }),
        new VariableField({ parent: customerBox, useRangeCoordinates: true, yRange: 29.55, text: "Name: ", fType: "customer-name", fWidth: 48 }),
        new VariableField({ parent: customerBox, useRangeCoordinates: true, yRange: 47.73, text: "Address: ", fType: "customer-address", fWidth: 48 }),
        new VariableField({ parent: customerBox, useRangeCoordinates: true, yRange: 65.91, text: "Code & State: ", fType: "stateNcode", fWidth: 48 }),
        new VariableField({ parent: customerBox, useRangeCoordinates: true, yRange: 84.09, text: "GST: ", fType: "customer-gst", fWidth: 48 }),
        F({ parent: customerBox, useRangeCoordinates: true, xRange: 50.02, yRange: 11.36, text: "Shipped to:", underline: true, fWidth: 48 }),
        new VariableField({ parent: customerBox, useRangeCoordinates: true, xRange: 50.02, yRange: 29.55, text: "Name: ", fType: "shipTo", fWidth: 48 }),
        new VariableField({ parent: customerBox, useRangeCoordinates: true, xRange: 50.02, yRange: 47.73, text: "Address: ", fType: "shipAddr", fWidth: 48 }),
        new VariableField({ parent: customerBox, useRangeCoordinates: true, xRange: 50.02, yRange: 65.91, text: "Code & State: ", fType: "stateNcode", fWidth: 48 }),
        new VariableField({ parent: customerBox, useRangeCoordinates: true, xRange: 50.02, yRange: 84.09, text: "GST: ", fType: "shipGST", fWidth: 48 }),
        // ---- Page (content 575.28×821.89) — the section-less zone ----
        new VariableField({ parent: page, useRangeCoordinates: true, yRange: 82.98, fType: "place-of-jurisdiction", fWidth: 100 }),
        new VariableField({ parent: page, useRangeCoordinates: true, yRange: 84.93, fType: "biller-bank", fWidth: 60 }),
        new VariableField({ parent: page, useRangeCoordinates: true, yRange: 86.87, text: "Rs. ", fType: "gtotal-words", fSize: 13, fWidth: 60 }),
        new VariableField({ parent: page, useRangeCoordinates: true, xRange: 61.04, yRange: 90.04, text: "SUB TOTAL(Rs.): ", fType: "sub-total", fSize: 10, fWidth: 40 }),
        new VariableField({ parent: page, useRangeCoordinates: true, xRange: 74.57, yRange: 90.04, fType: "sub-total", fSize: 10, fWidth: 20 }),
        new VariableField({ parent: page, useRangeCoordinates: true, xRange: 61.04, yRange: 91.5, text: "LESS DISCOUNT(Rs.): ", fType: "discVal", fSize: 10, fWidth: 40 }),
        new VariableField({ parent: page, useRangeCoordinates: true, xRange: 74.57, yRange: 91.5, fType: "discVal", fSize: 10, fWidth: 20 }),
        new VariableField({ parent: page, useRangeCoordinates: true, xRange: 61.04, yRange: 92.96, text: "TOTAL(Rs.): ", fType: "netAmt", fSize: 10, fWidth: 40 }),
        new VariableField({ parent: page, useRangeCoordinates: true, xRange: 74.57, yRange: 92.96, fType: "netAmt", fSize: 10, fWidth: 20 }),
        new VariableField({ parent: page, useRangeCoordinates: true, xRange: 61.04, yRange: 94.42, text: "ADD GST(Rs.): ", fType: "netTax", fSize: 10, fWidth: 40 }),
        new VariableField({ parent: page, useRangeCoordinates: true, xRange: 74.57, yRange: 94.42, fType: "netTax", fSize: 10, fWidth: 20 }),
        new VariableField({ parent: page, useRangeCoordinates: true, xRange: 61.04, yRange: 95.88, text: "CR/DR(-/+ Rs.): ", fType: "payment", fSize: 10, fWidth: 40 }),
        new VariableField({ parent: page, useRangeCoordinates: true, xRange: 74.57, yRange: 95.88, fType: "payment", fSize: 10, fWidth: 20 }),
        new VariableField({ parent: page, useRangeCoordinates: true, xRange: 61.04, yRange: 97.34, text: "ROUND OFF(Rs.): ", fType: "ro", fSize: 10, fWidth: 40 }),
        new VariableField({ parent: page, useRangeCoordinates: true, xRange: 74.57, yRange: 97.34, fType: "ro", fSize: 10, fWidth: 20 }),
        new VariableField({ parent: page, useRangeCoordinates: true, xRange: 61.04, yRange: 98.8, text: "GRAND TOTAL: ", fType: "grand-total", fSize: 12, bold: true, fWidth: 40 }),
        new VariableField({ parent: page, useRangeCoordinates: true, xRange: 74.57, yRange: 98.8, fType: "grand-total", fSize: 12, bold: true, fWidth: 20 }),
        // ---- Signature box (575×40) ----
        F({ parent: signatureBox, useRangeCoordinates: true, text: "DECLARATION ", bold: true, underline: true }),
        F({
            parent: signatureBox,
            useRangeCoordinates: true,
            yRange: 40,
            text: "We Assure that this invoice shows the actual Price of the goods described and that all particulars are true and correct",
            fSize: 10,
            fWidth: 45,
        }),
        new VariableField({ parent: signatureBox, useRangeCoordinates: true, xRange: 50.02, text: "Company's PAN: ", fType: "pan", fWidth: 48 }),
        F({ parent: signatureBox, useRangeCoordinates: true, yRange: 90, text: "E. &O.E", fSize: 10 }),
        new VariableField({ parent: signatureBox, useRangeCoordinates: true, xRange: 50.02, yRange: 40, text: "For M/s ", fType: "biller-name", fWidth: 48 }),
        F({ parent: signatureBox, useRangeCoordinates: true, xRange: 74.6, yRange: 80, text: "Authorised signatory", fSize: 10 }),
    ];
    // Legacy starter with explicit label/value pairs — pin every feild to
    // the flowing "alongside" look so the pairs keep printing as before.
    // (Each pair is a label feild AND a value feild; space-between in one
    // feild is the new Default-1 way to get the same alignment.) Pinned
    // unconditionally: the Field constructor always sets `align`, so a
    // "was align passed?" check can never see it missing.
    page.feilds.forEach((f) => {
        if (f.type !== "image") f.align = "alongside";
    });
    return page;
}

const STARTERS = {
    blank: () => new Page({ size: "a4" }),
    sections: starterSections,
    default1: starterDefault1,
    default2: starterDefault2,
};

/**
 * Build a starter template (a Page of element classes ready to draw or
 * serialize). "blank" | "sections" | "default1" | "default2".
 */
function buildStarter(name, appDefault) {
    if (!(name in STARTERS))
        throw new Error(`Unknown starter template "${name}".`);
    return STARTERS[name](appDefault);
}

module.exports = {
    Element,
    Section,
    Header,
    Body,
    Footer,
    Field,
    TextField,
    VariableField,
    ImageField,
    Table,
    Page,
    buildStarter,
    mainSectionBand,
    MAIN_SECTION_BANDS,
    SHAPES,
};
