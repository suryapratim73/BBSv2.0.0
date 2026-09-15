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
        this.x = data.x ?? 0;
        this.y = data.y ?? 0;
        this.width = data.width ?? 0;
        this.height = data.height ?? 0;
        this.padding = data.padding ?? 0;
        this.margin = data.margin ?? 0;
        this.applyBorder = data.applyBorder ?? false;
        this.border = data.border ?? 1;
        this.zIndex = data.zIndex ?? 1;
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
        section.width = this.width || 160;
        section.height = this.height || 160;
        section.classList.add("new-elem");
        mainDiv.appendChild(section);
        section.style.zIndex = this.zIndex;
        // Logical coordinates (1px = 1pt); zoom scales the CSS box.
        section.style.left = this.x * zoomFactor + "px";
        section.style.top = this.y * zoomFactor + "px";
        section.style.width = section.width * zoomFactor + "px";
        section.style.height = section.height * zoomFactor + "px";
        section.dataset.left = this.x;
        section.dataset.top = this.y;
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
        const { width, height } = this;
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
        else ctx.rect(0, 0, width, height);
        ctx.stroke();
    }

    /** Partition lines (legacy drawPartition). */
    drawPartitions(ctx) {
        ctx.beginPath();
        [...this.partitions].forEach(({ direction, lWidth, range }) => {
            ctx.lineWidth = lWidth;
            if (direction === "col") {
                ctx.moveTo((range * this.width) / 100, 0);
                ctx.lineTo((range * this.width) / 100, this.height);
            } else {
                ctx.moveTo(0, (range * this.height) / 100);
                ctx.lineTo(this.width, (range * this.height) / 100);
            }
        });
        ctx.stroke();
    }

    /** Table headers + column grid (legacy drawTable). */
    drawTable(ctx, page) {
        const { plan } = this;
        if (!plan || Object.keys(plan).length === 0) return;
        let { cols = [], padding = 10, fSize = 16, thHeight = 32 } = plan;
        if (cols.length === 0) return;
        const netPercent = cols.reduce((acc, { width }) => acc + width, 0);
        if (netPercent > 100)
            return alert("Net column widths cannot exceed width of it's host.");
        ctx.font = `bold ${fSize}px ${page.fFamily}`;
        ctx.beginPath();
        ctx.moveTo(0, thHeight);
        ctx.lineTo(this.width, thHeight);
        let xPos = 0;
        const yPos = (thHeight + fSize) / 2;
        cols.forEach((col) => {
            const { label, width: colWidth } = col;
            col.xPos = xPos;
            col.yPos = yPos;
            ctx.fillText(label, xPos + padding, yPos, (colWidth / 100) * this.width);
            xPos += (colWidth / 100) * this.width;
            ctx.moveTo(xPos, 0);
            ctx.lineTo(xPos, this.height);
        });
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
    draw(mainDiv, page) {
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
            let { width } = parentNode.getBoundingClientRect();
            elem.width = (imgWidth * width) / 100;
            elem.height = (imgHeight * width) / 100;
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
        let { fSize, text = "", fType, elem, fFamily, fWidth } = this;
        let ctx = elem.getContext("2d");
        let { left, top } = elem.getBoundingClientRect();
        ctx.fillStyle = "black";
        ctx.font = fSize + "px " + page.fFamily;
        text = text + (this.type === "variable" && text !== "" ? ": " : "") + (fType ?? "");
        let width = 1.25 * ctx.measureText(text).width;
        let height = fSize + 16;
        let parentElem =
            [...document.elementsFromPoint(left, top)]
                .filter(
                    (_elem) => _elem.classList.contains("new-elem") && _elem !== elem
                )
                ?.pop() ?? mainDiv;
        let { width: parentWidth } = parentElem.getBoundingClientRect();
        let widthConstraints = (parentWidth * fWidth) / 100;
        elem.style.zIndex = 100;
        let multiplier = Math.ceil(width / widthConstraints);
        width = widthConstraints;
        height = multiplier * fSize + 16;
        elem.width = width;
        elem.height = height;
        let selector = document.getElementById("selector");
        if (selector) selector.style.width = elem.width + 40 + "px";
        let style = "";
        for (let key of ["bold", "italic"]) {
            if (!(key in this)) continue;
            if (this[key]) style += key + " ";
        }
        ctx.font = style + " " + fSize + "px " + fFamily;
        ctx.clearRect(0, 0, elem.width, elem.height);
        let line = "",
            initY = fSize;
        let words = text.split(" ");
        for (const [index, word] of words.entries()) {
            let testLine = line + word + " ";
            let testLineWidth = ctx.measureText(testLine).width;
            if (testLineWidth > widthConstraints) {
                ctx.fillText(line, 0, initY);
                line = word + " ";
                initY += fSize + 8;
            } else line = testLine;
        }
        ctx.fillText(line, 0, initY);
        if ("underline" in this && this.underline) {
            ctx.moveTo(0, fSize + 3);
            ctx.lineWidth = fSize * (/"bold"/.test(style) ? 0.16 : 0.08);
            let textWidth = ctx.measureText(text).width;
            ctx.lineTo(textWidth, fSize + 3);
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
// Starter templates — picker function assembling element combinations at
// the legacy hardcoded coordinates (buildPage.default.js).
// ---------------------------------------------------------------------------

/** Compact feild factory for the starters below. */
function F({ type = "string", x, y, text = "", fType, fSize = 12, fWidth = 100, bold = false, italic = false, underline = false }) {
    return new Field({ type, x, y, text, fType, fSize, fWidth, bold, italic, underline });
}

/** Compact section factory. */
function S({ x, y, width, height, role = "section", name, applyBorder = true, border = 1, partitions = [], plan, shape = "rectangle", cornerRadius }) {
    const data = { x, y, width, height, role, name, applyBorder, border, partitions, plan, shape };
    if (cornerRadius !== undefined) data.cornerRadius = cornerRadius;
    return new Section(data);
}

function starterSections(appDefault) {
    const a4 = appDefault?.a4 ?? { width: 595.28, height: 841.89 };
    const page = new Page({ size: "a4" });
    const W = a4.width - 16; // 579.28 usable width at 8pt gutters
    const head = new Header({
        x: 8,
        y: 8,
        width: W,
        height: 246,
        applyBorder: true,
    });
    const body = new Body({
        x: 8,
        y: 262,
        width: W,
        height: 330,
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
            W
        ),
    });
    const footer = new Footer({
        x: 8,
        y: 600,
        width: W,
        height: 234,
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
    return page;
}

/**
 * Default 1 — the hardcoded `createHeader/createBody/createFooter` layout
 * transcribed at its exact coordinates. Approximations (documented):
 * the dynamic-y underline/consignee lines are skipped, IGST + Total share
 * one cell, and no seal / scrap-TDS conditional rows are pre-drawn.
 */
function starterDefault1() {
    const page = new Page({ size: "a4" });
    page.sections.push(
        S({
            x: 10,
            y: 22,
            width: 590,
            height: 750,
            name: "Page Border",
        })
    );
    page.head = new Header({
        x: 10,
        y: 22,
        width: 590,
        height: 203,
        applyBorder: false,
        partitions: [
            { direction: "col", range: 49.15, lWidth: 1 }, // x = 300
            { direction: "row", range: 18.72, lWidth: 1 }, // y = 60 (full-width approximation)
        ],
    });
    page.body = new Body({
        x: 10,
        y: 225,
        width: 590,
        height: 405,
        applyBorder: false,
        partitions: [
            { direction: "col", range: 49.15, lWidth: 1 }, // x = 300
            { direction: "row", range: 8.64, lWidth: 1 }, // y = 260 (closes the header rows)
            { direction: "col", range: 3.39, lWidth: 1 }, // x = 30
            { direction: "col", range: 35.59, lWidth: 1 }, // x = 220
            { direction: "col", range: 41.53, lWidth: 1 }, // x = 255
            { direction: "col", range: 55.08, lWidth: 1 }, // x = 335
            { direction: "col", range: 60.34, lWidth: 1 }, // x = 366
            { direction: "col", range: 68.64, lWidth: 1 }, // x = 415
            { direction: "col", range: 75.42, lWidth: 1 }, // x = 455
            { direction: "col", range: 82.2, lWidth: 1 }, // x = 495
            { direction: "col", range: 88.98, lWidth: 1 }, // x = 535
        ],
        plan: new Table(
            {
                thHeight: 35,
                fSize: 12,
                rSpacing: 8,
                padding: 10,
                cols: [
                    { label: "Sl No", var: "slno", width: 3.39 },
                    { label: "Product Description", var: "name", width: 32.2 },
                    { label: "HSN", var: "hsn", width: 5.93 },
                    { label: "Quantity", var: "qty", width: 13.56 },
                    { label: "Unit", var: "unit", width: 5.25 },
                    { label: "Unit Price", var: "rate", width: 8.31 },
                    { label: "Amount", var: "amt", width: 6.78 },
                    { label: "CGST", var: "CGST", width: 6.78 },
                    { label: "SGST", var: "SGST", width: 6.78 },
                    { label: "Total", var: "netAmt", width: 11.02 },
                ],
            },
            590
        ),
    });
    page.footer = new Footer({
        x: 10,
        y: 630,
        width: 590,
        height: 142,
        applyBorder: false,
        partitions: [
            { direction: "col", range: 49.15, lWidth: 1 }, // x = 300
            { direction: "col", range: 76.27, lWidth: 1 }, // x = 460
        ],
    });
    page.sections.push(
        S({
            x: 10,
            y: 630,
            width: 590,
            height: 20,
            name: "Tax mini box",
            partitions: [
                { direction: "col", range: 68.64, lWidth: 1 }, // x = 415
                { direction: "col", range: 75.42, lWidth: 1 }, // x = 455
                { direction: "col", range: 82.2, lWidth: 1 }, // x = 495
                { direction: "col", range: 88.98, lWidth: 1 }, // x = 535
            ],
        })
    );
    page.feilds = [
        new VariableField({ x: 12, y: 50, fType: "biller-name", fSize: 16, bold: true }),
        new VariableField({ x: 12, y: 70, text: "Address: ", fType: "biller-address", fWidth: 45 }),
        new VariableField({ x: 12, y: 86, text: "Contact number: ", fType: "biller-phone", fWidth: 45 }),
        new VariableField({ x: 12, y: 102, text: "GST number: ", fType: "biller-gst", fWidth: 45 }),
        new VariableField({ x: 450, y: 30, fType: "bill-copy", fSize: 10, fWidth: 20 }),
        new VariableField({ x: 305, y: 37, text: "Invoice No: ", fType: "billNo", fSize: 14, bold: true, fWidth: 30 }),
        new VariableField({ x: 516, y: 37, text: "Date: ", fType: "date-slash", fWidth: 12 }),
        F({ x: 305, y: 65, text: "Bill to:", fWidth: 45 }),
        new VariableField({ x: 305, y: 81, fType: "customer-name", fWidth: 45 }),
        new VariableField({ x: 305, y: 97, text: "Address: ", fType: "customer-address", fWidth: 45 }),
        new VariableField({ x: 305, y: 113, text: "Phone No: ", fType: "customer-phone", fWidth: 45 }),
        new VariableField({ x: 305, y: 129, text: "GST No: ", fType: "customer-gst", fWidth: 45 }),
        F({ x: 12, y: 655, text: "Total in words", italic: true }),
        new VariableField({ x: 12, y: 670, fType: "gtotal-words", fWidth: 45 }),
        F({ x: 12, y: 700, text: "Authorised Signatory" }),
        new VariableField({ x: 12, y: 715, text: "For ", fType: "biller-name", bold: true, italic: true }),
        F({ x: 40, y: 750, text: "(Proprietor)", italic: true }),
        new VariableField({ x: 305, y: 660, text: "Total quantity: ", fType: "netQty", fWidth: 22 }),
        new VariableField({ x: 405, y: 660, fType: "netQty", fWidth: 12 }),
        new VariableField({ x: 305, y: 675, text: "Total before Tax: ", fType: "total-before-tax", fWidth: 22 }),
        new VariableField({ x: 405, y: 675, fType: "total-before-tax", fWidth: 12 }),
        new VariableField({ x: 305, y: 690, text: "Total discount: ", fType: "total-discount", fWidth: 22 }),
        new VariableField({ x: 405, y: 690, fType: "total-discount", fWidth: 12 }),
        new VariableField({ x: 305, y: 705, text: "Total Tax: ", fType: "netTax", fWidth: 22 }),
        new VariableField({ x: 405, y: 705, fType: "netTax", fWidth: 12 }),
        new VariableField({ x: 305, y: 720, text: "Rounded off: ", fType: "ro", fWidth: 22 }),
        new VariableField({ x: 405, y: 720, fType: "ro", fWidth: 12 }),
        new VariableField({ x: 305, y: 735, text: "Grand Total: ", fType: "grand-total", fWidth: 22 }),
        new VariableField({ x: 405, y: 735, fType: "grand-total", fSize: 14, bold: true, fWidth: 12 }),
        new VariableField({ x: 425, y: 635, fType: "net-CGST", fWidth: 8 }),
        new VariableField({ x: 465, y: 635, fType: "net-SGST", fWidth: 8 }),
        F({ x: 460, y: 750, text: "(Receiver's signature)", fSize: 10, italic: true, fWidth: 15 }),
    ];
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
    const page = new Page({ size: "a4", applyMargin: true, margin: 10 });
    page.sections.push(
        S({ x: 10, y: 10, width: 575, height: 110, name: "Biller box" }),
        S({
            x: 10,
            y: 120,
            width: 575,
            height: 60,
            name: "Meta box",
            partitions: [{ direction: "col", range: 50.02, lWidth: 1 }],
        }),
        S({
            x: 10,
            y: 180,
            width: 575,
            height: 88,
            name: "Customer box",
            partitions: [{ direction: "col", range: 50.02, lWidth: 1 }],
        })
    );
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
    page.sections.push(
        S({
            x: 10,
            y: 790,
            width: 575,
            height: 40,
            name: "Signature box",
            partitions: [
                { direction: "col", range: 50.02, lWidth: 1 },
                { direction: "row", range: 33.3, lWidth: 1 },
            ],
        })
    );
    const L = 361.17; // 0.6 × 585.28 + 10 (summary label x)
    const V = 438.96; // 0.75 × 585.28 (summary value x)
    page.feilds = [
        new VariableField({ x: 15, y: 15, text: "GSTIN: ", fType: "biller-gst", fSize: 10 }),
        new VariableField({ x: 490, y: 15, fType: "bill-copy", fSize: 10, fWidth: 15 }),
        F({ x: 240, y: 26, text: "GST INVOICE", fSize: 14, bold: true, underline: true }),
        F({ x: 250, y: 42, text: "|| SHREE HARI ||" }),
        new VariableField({ x: 230, y: 58, text: "M/s. ", fType: "biller-name", fSize: 16, bold: true }),
        new VariableField({ x: 200, y: 74, fType: "biller-address" }),
        new VariableField({ x: 220, y: 90, text: "Contact: ", fType: "biller-phone" }),
        new VariableField({ x: 10, y: 130, text: "Invoice No.: ", fType: "billNo", fWidth: 48 }),
        new VariableField({ x: 10, y: 146, text: "Invoice Date: ", fType: "date", fWidth: 48 }),
        new VariableField({ x: 10, y: 162, text: "Place of supply: ", fType: "placeOfSupply", fWidth: 48 }),
        new VariableField({ x: 297.64, y: 130, text: "Transport: ", fType: "transportName", fWidth: 48 }),
        new VariableField({ x: 297.64, y: 146, text: "G.R.No.: ", fType: "orderRef", fWidth: 48 }),
        new VariableField({ x: 297.64, y: 162, text: "Eway bill no: ", fType: "ewayBill", fWidth: 48 }),
        F({ x: 10, y: 190, text: "Billed to:", underline: true, fWidth: 48 }),
        new VariableField({ x: 10, y: 206, text: "Name: ", fType: "customer-name", fWidth: 48 }),
        new VariableField({ x: 10, y: 222, text: "Address: ", fType: "customer-address", fWidth: 48 }),
        new VariableField({ x: 10, y: 238, text: "Code & State: ", fType: "stateNcode", fWidth: 48 }),
        new VariableField({ x: 10, y: 254, text: "GST: ", fType: "customer-gst", fWidth: 48 }),
        F({ x: 297.64, y: 190, text: "Shipped to:", underline: true, fWidth: 48 }),
        new VariableField({ x: 297.64, y: 206, text: "Name: ", fType: "shipTo", fWidth: 48 }),
        new VariableField({ x: 297.64, y: 222, text: "Address: ", fType: "shipAddr", fWidth: 48 }),
        new VariableField({ x: 297.64, y: 238, text: "Code & State: ", fType: "stateNcode", fWidth: 48 }),
        new VariableField({ x: 297.64, y: 254, text: "GST: ", fType: "shipGST", fWidth: 48 }),
        new VariableField({ x: 10, y: 692, fType: "place-of-jurisdiction", fWidth: 100 }),
        new VariableField({ x: 10, y: 708, fType: "biller-bank", fWidth: 60 }),
        new VariableField({ x: 10, y: 724, text: "Rs. ", fType: "gtotal-words", fSize: 13, fWidth: 60 }),
        new VariableField({ x: L, y: 750, text: "SUB TOTAL(Rs.): ", fType: "sub-total", fSize: 10, fWidth: 40 }),
        new VariableField({ x: V, y: 750, fType: "sub-total", fSize: 10, fWidth: 20 }),
        new VariableField({ x: L, y: 762, text: "LESS DISCOUNT(Rs.): ", fType: "discVal", fSize: 10, fWidth: 40 }),
        new VariableField({ x: V, y: 762, fType: "discVal", fSize: 10, fWidth: 20 }),
        new VariableField({ x: L, y: 774, text: "TOTAL(Rs.): ", fType: "netAmt", fSize: 10, fWidth: 40 }),
        new VariableField({ x: V, y: 774, fType: "netAmt", fSize: 10, fWidth: 20 }),
        new VariableField({ x: L, y: 786, text: "ADD GST(Rs.): ", fType: "netTax", fSize: 10, fWidth: 40 }),
        new VariableField({ x: V, y: 786, fType: "netTax", fSize: 10, fWidth: 20 }),
        new VariableField({ x: L, y: 798, text: "CR/DR(-/+ Rs.): ", fType: "payment", fSize: 10, fWidth: 40 }),
        new VariableField({ x: V, y: 798, fType: "payment", fSize: 10, fWidth: 20 }),
        new VariableField({ x: L, y: 810, text: "ROUND OFF(Rs.): ", fType: "ro", fSize: 10, fWidth: 40 }),
        new VariableField({ x: V, y: 810, fType: "ro", fSize: 10, fWidth: 20 }),
        new VariableField({ x: L, y: 822, text: "GRAND TOTAL: ", fType: "grand-total", fSize: 12, bold: true, fWidth: 40 }),
        new VariableField({ x: V, y: 822, fType: "grand-total", fSize: 12, bold: true, fWidth: 20 }),
        F({ x: 10, y: 790, text: "DECLARATION ", bold: true, underline: true }),
        F({
            x: 10,
            y: 806,
            text: "We Assure that this invoice shows the actual Price of the goods described and that all particulars are true and correct",
            fSize: 10,
            fWidth: 45,
        }),
        new VariableField({ x: 297.64, y: 790, text: "Company's PAN: ", fType: "pan", fWidth: 48 }),
        F({ x: 10, y: 826, text: "E. &O.E", fSize: 10 }),
        new VariableField({ x: 297.64, y: 806, text: "For M/s ", fType: "biller-name", fWidth: 48 }),
        F({ x: 438.96, y: 822, text: "Authorised signatory", fSize: 10 }),
    ];
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
    SHAPES,
};
