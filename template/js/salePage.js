const { ipcRenderer } = require("electron");
const {
    toggleDevTool,
    reduceOrder,
    clickOrFocusinHandler,
    applyDiscount,
    reassignSummaryDivFeilds,
    showPaymentMode,
    updateBillValue,
    addRow,
    calculateAmounts,
    getsaleConfigPolicyPath,
    appendToDL,
    validateInput,
    roundOffTo2DecimalPlace,
    showToastNotification,
    closeToast,
    retractHandler,
    deleteRowCommon,
    applyTheme,
    removeAllElem,
    selectionHandler,
    assignDeliveryOptions,
    execRetractHandler,
    deleteKey,
    validateInput2,
    upperCaseInput,
    appendToHost,
    createModal,
    closeModal,
    capitalize,
    textRollAnnimation,
    traverseParent,
    gstChecksum,
} = require("../js/common");

const uuid = require("uuid");
let fs = require("fs");
const { type } = require("os");

toggleDevTool(document);

let nameDatalist = document.createElement("datalist"),
    customerNameDatalist = document.createElement("datalist"),
    customer = {},
    currentStep = 1,
    selectedItem = {},
    orderItems = [],
    billMeta = {},
    payment = [],
    transporterDatalist = document.createElement("datalist"),
    unitDatalist = document.createElement("datalist"),
    shipInfoDatalist = document.createElement("datalist"),
    page2initialized = false,
    footer = document.querySelector("footer"),
    bodyRow,
    timer,
    currentBillNo,
    probableGrps = [],
    availableBillNoDL = document.createElement("datalist"),
    igstFlag,
    preset,
    nocFlag = true;

nameDatalist.id = "stock-names";
customerNameDatalist.id = "customer-names";
unitDatalist.id = "unit-dl";
transporterDatalist.id = "transport-dl";
availableBillNoDL.id = "available-bill-no-div";
shipInfoDatalist.id = "ship-info-dl";
process.allowMatch = true; // To allow datalist options to be selected even if they don't match the input (for custom entries)

const {
    unitMap = [],
    availableBillNo = [],
    gst: _gst,
} = JSON.parse(fs.readFileSync(getsaleConfigPolicyPath("../../")).toString());

async function init() {
    appendToDL("get-stocks", nameDatalist);
    appendToDL("get-services", nameDatalist);
    appendToDL("get-customers", customerNameDatalist);
    appendToDL("get-transporter", transporterDatalist);
    let billNos = Array.from(new Set(availableBillNo));
    billNos = billNos.map((no) => {
        return {
            name: no,
        };
    });
    appendToDL(null, availableBillNoDL, true, null, [], billNos);
    unitMap.forEach((obj) => {
        let key = Object.keys(obj)[0];
        let option = document.createElement("option");
        option.value = key;
        option.textContent = key === "Bag" ? "Bag (=50 Kg)" : key;
        unitDatalist.appendChild(option);
    });
    preset = await ipcRenderer.invoke("get-presets");
    if (preset.mode === "edit-bill") {
        customer = preset.customer;
        if ("billMeta" in preset) {
            billMeta = { ...preset.billMeta };
            console.log("Loaded billMeta from preset:", billMeta);
            if (typeof billMeta.delivery === "object")
                [
                    "deliveryType",
                    "transportName",
                    "transportAddress",
                    "transportContact",
                    "transportGST",
                ].forEach((key) => {
                    billMeta[key] = billMeta.delivery?.[key];
                });
        }
        if ("itemList" in preset)
            orderItems = preset.itemList.map((itemObj) => {
                return {
                    ...itemObj,
                    qty: itemObj.quantity,
                    sellUnit: itemObj.unit,
                };
            });
    }
    document.getElementById("page-header").innerHTML = stepDetail();
    mainForm();
    if (preset.mode === "edit-bill")
        while (preset.currentStep > currentStep)
            document.querySelector(`[data-type="proceed"]`).click();
    document.body.appendChild(unitDatalist);
    let themeObj = await ipcRenderer.invoke("init-theme");
    applyTheme.call(document, null, themeObj);
}
init().catch((err) => {
    console.log(err);
}); // Datalist linking and selection handler work

ipcRenderer.on("apply-theme", applyTheme.bind(document));

function stepDetail() {
    if (currentStep === 1)
        return `Add <span class="highlight">customer</span> detail`;
    if (currentStep === 2)
        return `Add <span class="highlight">bill</span> detail`;
    if (currentStep === 3)
        return `Add <span class="highlight">item</span> detail`;
    if (currentStep === 4)
        return `Add <span class="highlight">payment</span> detail`;
}

function setFooter() {
    if (!document.getElementById("btn-container")) {
        let footerDF = document
            .getElementById("footer-template")
            .content.cloneNode(true)
            .querySelector("DIV");
        footer.appendChild(footerDF);
    }
    [...footer.querySelectorAll("button")].forEach((btn) =>
        btn.classList.add("hide"),
    );
    footer.querySelector(`[data-type="cancel"]`).classList.remove("hide");
    if (currentStep < 4)
        footer.querySelector(`[data-type="proceed"]`).classList.remove("hide");
    else {
        if (billMeta.billType === "regular")
            footer.querySelector(`[data-type="print"]`).classList.remove("hide");
        footer.querySelector(`[data-type="save"]`).classList.remove("hide");
    }
    if (currentStep !== 1)
        footer.querySelector(`[data-type="back"]`).classList.remove("hide");
}

function helperFunc1(itemObj) {
    try {
        let main = document.querySelector("main");
        main.querySelector("#add-item > button").click();
        bodyRow = main.querySelector("#tbody .body.row:nth-last-child(2)");
        selectedItem = itemObj;
        let sellId = bodyRow.dataset.sellId;
        if (!("sellId" in itemObj)) itemObj.sellId = sellId;
        [...bodyRow.querySelectorAll("input")].forEach((input) => {
            let key = input.dataset.name;
            if (key !== "unit") {
                if (
                    "rate" in itemObj &&
                    itemObj.rate > 0 &&
                    key === "standardSellPrice"
                )
                    input.value = itemObj.rate;
                else input.value = itemObj?.[key] ?? "";
            } else {
                input.value = itemObj.sellUnit;
            }
        });
        calculateAmounts();
    } catch (err) {
        console.error("Error in helperFunc1:", err);
    }
}

async function reInitFormData() {
    try {
        let main = document.querySelector("main");
        [customer, billMeta, orderItems].forEach((obj) => {
            if (currentStep === 3 && obj instanceof Array) {
                //Step 3
                orderItems.forEach((obj) => {
                    if (obj.type === "grp") obj.items.forEach((obj) => helperFunc1(obj));
                    else helperFunc1(obj);
                });
            } else if (currentStep != 3 && !(obj instanceof Array)) {
                // Step 1,2,4
                let inputs = [...main.querySelectorAll(`input,select`)];
                let keys = inputs.map((inp) => inp.dataset.name);
                if (!keys.some((key) => key in obj)) return;
                //Step 1,2
                for (let _index = 0; _index < inputs.length; _index++) {
                    let input = inputs[_index];
                    let key = input.dataset.name;
                    if (["text", "email"].includes(input.type) && obj[key]) {
                        input.value =
                            key != "phones" || obj instanceof Array
                                ? obj[key]
                                : JSON.parse(obj[key]);
                        inputs.splice(_index, 1);
                        _index--;
                    }
                    if (key === "billType" && obj[key] === "monthly") {
                        inputs.splice(_index, 1);
                        _index--;
                        inputs.splice(
                            inputs.findIndex((input) => input.dataset.name === "billType"),
                            1,
                        );
                        main
                            .querySelector("#bill-type-monthly")
                            .setAttribute("checked", true);
                        main.querySelector(".bill-number.regular").classList.add("hide");
                        main
                            .querySelector(".bill-number.regular input")
                            .setAttribute("disabled", true);
                        main.querySelector(".bill-number.monthly").classList.remove("hide");
                        if ("autoBill" in obj && obj.autoBill)
                            main
                                .querySelector(
                                    ".bill-number.monthly input[data-name='autoBill']",
                                )
                                .setAttribute("checked", true);
                        main
                            .querySelector(`#bill-number-${obj.billNo}`)
                            .setAttribute("checked", true);
                        [
                            ...main.querySelectorAll(
                                ".bill-number.monthly input[data-name='billNo']",
                            ),
                        ].forEach((input) => {
                            input.removeAttribute("disabled");
                        });
                        if (obj.billStatus === "close")
                            main
                                .querySelector("#bill-status-close")
                                .setAttribute("checked", true);
                        else
                            main
                                .querySelector("#bill-status-open")
                                .setAttribute("checked", true);
                    }
                    if (key === "billDate"){
                        // console.log({
                        //     billDate: obj.billDate,
                        //     type: typeof obj.billDate,
                        //     indianStandard: new Date(obj.billDate).toLocaleDateString("en-IN"),
                        // })
                        input.value =
                        typeof obj.billDate === "string"
                            ? new Date(obj.billDate).toISOString().split("T")[0]
                            : obj.billDate.toISOString().split("T")[0];
                    }
                }
                if (
                    main.querySelector("#bill-number-regular") &&
                    obj.billType === "regular"
                )
                    main.querySelector("#bill-number-regular").value = billMeta.billNo;
                if (
                    "deliveryType" in obj &&
                    obj.deliveryType === "transport" &&
                    currentStep === 2
                ) {
                    main
                        .querySelector("#delivery-mode option[value='transport']")
                        .setAttribute("selected", true);
                    assignDeliveryOptions({ value: "transport" });
                    main.querySelector("input[data-name='transportName']").value =
                        obj.transportName;
                    main.querySelector("input[data-name='transportAddress']").value =
                        obj.transportAddress ?? "";
                    main.querySelector("input[data-name='transportContact']").value =
                        obj.transportContact ?? "";
                    main.querySelector("input[data-name='transportGST']").value =
                        obj.transportGST ?? "";
                } else if (preset.mode === "edit-bill" && obj.deliveryType === "hand")
                    main
                        .querySelector("#delivery-mode option[value='hand']")
                        ?.setAttribute("selected", true);
                else if (
                    preset.mode === "new-sale" &&
                    typeof obj.deliveryType === "undefined"
                ) {
                    main
                        .querySelector("#delivery-mode option[value='transport']")
                        .setAttribute("selected", true);
                    assignDeliveryOptions({ value: "transport" });
                }

                //Step 4
                if (
                    !("payment" in billMeta) ||
                    ("paymentStatus" in billMeta && billMeta.paymentStatus == false)
                )
                    return;
                billMeta.payment?.forEach?.((payObj, i) => {
                    if (i === 0) showPaymentMode({ value: payObj.type });
                    Object.keys(payObj).forEach((key) => {
                        let input = main.querySelector(
                            `#${payObj.type}-payment input[data-name="${key}"]`,
                        );
                        if (input) input.value = payObj[key];
                        if (billMeta.paymentStatus && payObj.type !== "cash")
                            main
                                .querySelector(
                                    `#${payObj.type}-payment select[data-name="paymentStatus"] option[value="${billMeta.paymentStatus}"]`,
                                )
                                .setAttribute("selected", true);
                    });
                });
                if ("discVal" in billMeta)
                    main.querySelector("#discount-div>input").value = billMeta.discVal;
                reassignSummaryDivFeilds();
            }
        });
    } catch (err) {
        console.error("Error in reInitFormData:", err);
        showToastNotification(
            "Error loading form data: " + err.message,
            ["animation-common", "move-left", "red-toast-box"],
            document.body,
        );
    }
}

async function mainForm() {
    try {
        removeAllElem("main *");
        removeAllElem("footer .horizontal-scroll-list");
        let page = document
            .getElementById(`page-${currentStep}-template`)
            .content.cloneNode(true)
            .querySelector("div");
        document.querySelector("main").appendChild(page);
        // GST State Codes as per GST portal (returns abbreviations)
        const gstStateCodes = {
            "01": "Jammu & Kashmir", // Jammu & Kashmir
            "02": "Himachal Pradesh", //
            "03": "Punjab", // Punjab
            "04": "Chandigarh", // Chandigarh
            "05": "Uttarakhand", // Uttarakhand
            "06": "Haryana", // Haryana
            "07": "Delhi", // Delhi
            "08": "Rajasthan", // Rajasthan
            "09": "Uttar Pradesh", // Uttar Pradesh
            10: "Bihar", // Bihar
            11: "Sikkim", // Sikkim
            12: "Arunachal Pradesh", // Arunachal Pradesh
            13: "Nagaland", // Nagaland
            14: "Manipur", // Manipur
            15: "Mizoram", // Mizoram
            16: "Tripura", // Tripura
            17: "Meghalaya", // Meghalaya
            18: "Assam", // Assam
            19: "West Bengal", // West Bengal
            20: "Jharkhand", // Jharkhand
            21: "Odisha", // Odisha
            22: "Chhattisgarh", // Chhattisgarh
            23: "Madhya Pradesh", // Madhya Pradesh
            24: "Gujarat", // Gujarat
            25: "Daman & Diu", // Daman & Diu
            26: "Dadra & Nagar Haveli", // Dadra & Nagar Haveli
            27: "Maharashtra", // Maharashtra
            28: "Andhra Pradesh (Old)", // Andhra Pradesh (Old)
            29: "Karnataka", // Karnataka
            30: "Goa", // Goa
            31: "Lakshadweep", // Lakshadweep
            32: "Kerala", // Kerala
            33: "Tamil Nadu", // Tamil Nadu
            34: "Puducherry", // Puducherry
            35: "Andaman & Nicobar Islands", // Andaman & Nicobar Islands
            36: "Telangana", // Telangana
            37: "Andhra Pradesh (New)", // Andhra Pradesh (New)
            97: "Other Territory", // Other Territory
        };
        if (currentStep === 2) {
            billMeta.billDate =
                preset.mode === "edit-bill"
                    ? billMeta.billDate
                    : await ipcRenderer.invoke("get-date");
            // Ensure billDate is always a Date object
            if (typeof billMeta.billDate === 'string') {
                billMeta.billDate = new Date(billMeta.billDate + (billMeta.billDate.includes('T') ? '' : 'T00:00:00.000Z'));
            }
            // Convert to IST (UTC+5:30) to get the correct local date
            const billDateObj = new Date(billMeta.billDate);
            const istOffset = 5.5 * 60 * 60 * 1000; // 5 hours 30 minutes in milliseconds
            const istDate = new Date(billDateObj.getTime() + istOffset);
            const dateStr = istDate.toISOString().split("T")[0];
            
            // Normalize billDate to midnight UTC of the IST date (prevents drift on subsequent edits)
            billMeta.billDate = new Date(dateStr + 'T00:00:00.000Z');
            
            document.querySelector(`[data-name="billDate"]`).value = dateStr; 
            // Bill Date mismatch bug - fixed
            if (!page2initialized) {
                currentBillNo =
                    preset.mode === "edit-bill"
                        ? billMeta.billNo
                        : await ipcRenderer.invoke("get-sale-bill-number");
                billMeta.billNo = currentBillNo;
                billMeta.billType = "regular";
                page2initialized = true;
            } else currentBillNo = billMeta.billNo;
            if (availableBillNo.length > 0) {
                let input = document.getElementById("bill-number-regular");
                input?.setAttribute("list", "available-bill-no-div");
            }
            // Default values for no manual typing
            document.querySelector(`[data-name="billNo"]`).value = billMeta.billNo;
            document.querySelector(`[data-name="shipTo"]`).value = customer.name;
            document.querySelector(`[data-name="shipAddr"]`).value =
                customer.address ?? "";
            document.querySelector(`[data-name="shipPh"]`).value =
                customer.phones?.[0] ?? "";
            document.querySelector(`[data-name="shipGST"]`).value =
                customer.gst ?? "";
            document.querySelector("[data-name='stateNcode']").value =
                typeof customer.gst !== ""
                    ? customer.gst.substring(0, 2) +
                    "-" +
                    gstStateCodes[customer.gst?.substring(0, 2)]
                    : "";
        }
        setFooter();
        if (currentStep === 3) {
            appendToHost(
                "#roll-text-template",
                document.querySelector("footer"),
                "DIV",
            );
            document
                .querySelector("footer .horizontal-scroll-list")
                .after(document.querySelector("#btn-container"));
        }
        if (currentStep === 4) page4Init();
        reInitFormData();
    } catch (err) {
        console.error("Error in mainForm:", err);
        showToastNotification(
            "Error loading page: " + err.message,
            ["animation-common", "move-left", "red-toast-box"],
            document.body,
        );
    }
}

function phoneRegExpInp(text) {
    let numHead = "(\\+\\d+ )*";
    text = text.replace(/(\+\d+ )*/, "");
    text =
        numHead +
        text.substring(0, text.length / 2) +
        " *" +
        text.substring(text.length / 2, text.length).trim();
    return text;
}

function advanceSet(target, newValue) {
    if (typeof target === "string") target = JSON.parse(target);
    target.push(newValue);
    return Array.from(new Set(target));
}

function page4Init() {
    try {
        let netAmtTax = Math.round(billMeta.netAmtTax);
        document.querySelector("#summary-div .highlight").textContent =
            Math.round(netAmtTax);
        document.querySelector("[data-name='netAmtTaxDel']").textContent =
            netAmtTax;
        let netPayment =
            "payment" in billMeta
                ? billMeta.payment.reduce?.((acc, obj) => acc + obj.payment, 0)
                : 0;
        if (netAmtTax - netPayment > 0) {
            document.querySelector(`[data-name="dueAmt"]`).textContent =
                netAmtTax - netPayment;
            document.querySelector(`[data-name="return"]`).textContent = 0;
        } else {
            document.querySelector(`[data-name="dueAmt"]`).textContent = 0;
            document.querySelector(`[data-name="return"]`).textContent =
                netPayment - netAmtTax;
        }
        if (probableGrps.length > 0)
            document
                .querySelector('button[data-cmd="grp-item"]')
                .removeAttribute("disabled");
        else
            document
                .querySelector('button[data-cmd="grp-item"]')
                .setAttribute("disabled", true);
        updatePayStatus();
    } catch (err) {
        console.error("Error in page4Init:", err);
        showToastNotification(
            "Error initializing payment page: " + err.message,
            ["animation-common", "move-left", "red-toast-box"],
            document.body,
        );
    }
}

function proceedOrFinishHandler(e) {
    try {
        e && e.preventDefault();
        if (e.type === "submit") {
            if (currentStep !== 3) {
                let formObjs = Object.fromEntries(new FormData(e.target).entries());
                if (currentStep === 1) {
                    let gst = formObjs.gst;
                    if (gst !== "") {
                        let flag = gstChecksum(gst);
                        ipcRenderer.send("log", {
                            title: "GST CHecksum",
                            message: { flag, gst },
                            func: "proceedOrFinishHandler function",
                        });
                        if (!flag)
                            showToastNotification(
                                "GST number may be not valid. You may consider a recheck.",
                                ["animation-common", "move-left", "red-toast-box"],
                                document.body,
                            );
                    } // GST Validation
                    igstFlag =
                        gst != "" &&
                        Number(gst.match(/\d\d/)?.[0]) != Number(_gst.match(/\d\d/)?.[0]);
                    customer = { ...customer, ...formObjs, phones: customer.phones };
                    if (!("id" in customer))
                        customer.id = uuid.v5(
                            customer.name + "_customer",
                            "6ba7b814-9dad-11d1-80b4-00c04fd430c8",
                        );
                    customer.phones = advanceSet(customer.phones, formObjs.phones);
                } else {
                    // Step 2 & 4
                    if ("autoBill" in formObjs) formObjs.autoBill = true;
                    if (
                        billMeta.deliveryType === "transport" &&
                        !("transportId" in billMeta)
                    )
                        billMeta.transportId = uuid.v5(
                            billMeta.transportName,
                            "6ba7b814-9dad-11d1-80b4-00c04fd430c8",
                        );
                    if (!("discVal" in billMeta)) billMeta.discVal = 0;
                    // Convert billDate string from form to Date object at midnight UTC to prevent timezone drift
                    if (formObjs.billDate && typeof formObjs.billDate === 'string') {
                        formObjs.billDate = new Date(formObjs.billDate + 'T00:00:00.000Z');
                    }
                    billMeta = { ...billMeta, ...formObjs };
                    if (billMeta.billType === "monthly" && billMeta.billNo === "reserve")
                        billMeta.billNo = currentBillNo;
                }
            } // Step 1,2 & 4
            else {
                probableGrps = [];
                nocFlag = true;
                orderItems.forEach(async (itemObj) => {
                    let grpObj = probableGrps.find((obj) => obj.rate === itemObj.rate);
                    if (itemObj.type !== "grp") {
                        if (!grpObj)
                            probableGrps.push({
                                rate: itemObj.rate,
                                items: [itemObj],
                            });
                        else grpObj.items.push(itemObj);
                    }
                    if (!("id" in itemObj)) {
                        [...document.querySelectorAll(".body.row")].forEach((row) => {
                            if (row.dataset.sellId === itemObj.sellId) {
                                itemObj.name = row.querySelector('[data-name="name"]').value;
                                itemObj.hsn = row.querySelector('[data-name="hsn"]').value;
                            }
                        });
                        let obj = await ipcRenderer.invoke("create-stock", itemObj);
                        itemObj.id = obj.id;
                    }
                    if (itemObj.sgst === 0 || itemObj.cgst === 0 || itemObj.igst === 0) {
                        // No GST Check
                        if (!igstFlag) {
                            // SGST CGST Case.
                            itemObj.sgst =
                                itemObj.sgst == 0
                                    ? Number(
                                        document.querySelector(
                                            `.body.row[data-sell-id="${itemObj.sellId}"] input[data-name="sgst"]`,
                                        ).value,
                                    )
                                    : itemObj.sgst;
                            itemObj.cgst =
                                itemObj.cgst == 0
                                    ? Number(
                                        document.querySelector(
                                            `.body.row[data-sell-id="${itemObj.sellId}"] input[data-name="cgst"]`,
                                        ).value,
                                    )
                                    : itemObj.cgst;
                            if (
                                typeof preset.default_gst !== "number" &&
                                (itemObj.sgst == 0 || itemObj.cgst == 0)
                            ) {
                                nocFlag = false;
                                document
                                    .querySelector(
                                        `.body.row[data-sell-id="${itemObj.sellId}"] input[data-name="sgst"]`,
                                    )
                                    .focus();
                                showToastNotification(
                                    "Tax Rate cannot be 0.",
                                    ["animation-common", "move-left", "red-toast-box"],
                                    document.body,
                                );
                            } else if (
                                (itemObj.sgst == 0 || itemObj.cgst == 0) &&
                                preset.default_gst > 0
                            ) {
                                console.log(
                                    "No GST set, applying preset default gst",
                                    preset.default_gst,
                                );
                                itemObj.sgst = preset.default_gst / 2;
                                itemObj.cgst = preset.default_gst / 2;
                            }
                        } else {
                            // IGST Case
                            itemObj.igst =
                                itemObj.igst == 0
                                    ? Number(
                                        document.querySelector(
                                            `.body.row[data-sell-id="${itemObj.sellId}"] input[data-name="igst"]`,
                                        ).value,
                                    )
                                    : itemObj.igst;
                            if (typeof preset.default_gst !== "number" && itemObj.igst == 0) {
                                nocFlag = false;
                                document
                                    .querySelector(
                                        `.body.row[data-sell-id="${itemObj.sellId}"] input[data-name="igst"]`,
                                    )
                                    .focus();
                                showToastNotification(
                                    "Tax Rate cannot be 0.",
                                    ["animation-common", "move-left", "red-toast-box"],
                                    document.body,
                                );
                            } else if (itemObj.igst == 0 && preset.default_gst > 0)
                                itemObj.igst = preset.default_gst;
                        }
                    }
                    if (itemObj.rate == 0) {
                        // 0 Rate Check
                        itemObj.rate = Number(
                            document.querySelector(
                                `.body.row[data-sell-id="${itemObj.sellId}"] input[data-name="standardSellPrice"]`,
                            ).value,
                        );
                        if (itemObj.rate == 0) {
                            nocFlag = false;
                            document
                                .querySelector(
                                    `.body.row[data-sell-id="${itemObj.sellId}"] input[data-name="standardSellPrice"]`,
                                )
                                .focus();
                            showToastNotification(
                                "Rate cannot be 0.",
                                ["animation-common", "move-left", "red-toast-box"],
                                document.body,
                            );
                        } else nocFlag = true;
                    }
                });
                if (
                    !["netQty", "netAmt", "netAmtTax"].every((key) => key in billMeta)
                ) {
                    let reducedOrder = reduceOrder();
                    billMeta.netQty = reducedOrder.netQty;
                    billMeta.netAmt = roundOffTo2DecimalPlace(reducedOrder.netAmt);
                    billMeta.netAmtTax = roundOffTo2DecimalPlace(reducedOrder.netAmtTax);
                }
                probableGrps = probableGrps.filter((obj) => obj.items.length !== 1);
            } // Step 3
            if (nocFlag) currentStep++;
        } else if (e.type === "click" && e.target.dataset.type === "back") {
            currentStep--;
            if (currentStep === 2) {
                orderItems
                    .filter((obj) => !("name" in obj))
                    .forEach((obj) => {
                        let { sellId } = obj;
                        let bodyRow = document.querySelector(
                            `.body.row[data-sell-id="${sellId}"]`,
                        );
                        obj.name = bodyRow.querySelector("input[data-name='name']").value;
                        obj.hsn = bodyRow.querySelector("input[data-name='hsn']").value;
                    });
            }
        }
        if (nocFlag) {
            document.getElementById("page-header").innerHTML = stepDetail();
            mainForm();
        }
    } catch (err) {
        console.error("Error in proceedOrFinishHandler:", err);
        showToastNotification(
            "Error processing form: " + err.message,
            ["animation-common", "move-left", "red-toast-box"],
            document.body,
        );
    }
}

function showItemMergeOpts() {
    try {
        removeAllElem("main *");
        appendToHost("#item-group-option-template", "main", "div");
        [...document.querySelectorAll("#btn-container button")].forEach((btn) => {
            btn.classList.add("hide");
            if (btn.dataset.type === "grp-pg-btn") btn.classList.remove("hide");
        });
    } catch (err) {
        console.error("Error in showItemMergeOpts:", err);
    }
}

function revealMoreGrpOpts(e, mode) {
    try {
        let page = traverseParent(e.target, "page");
        if (mode === 1) {
            ["#price-selector-div", "#old-grp", "#create-grp-btn"].forEach((id) =>
                page.querySelector(id).classList.remove("hide"),
            );
            let select = page.querySelector("#price-selector-div select");
            probableGrps.forEach((obj) => {
                let option = document.createElement("option");
                select.appendChild(option);
                option.value = obj.rate;
                option.textContent = obj.rate;
            });
        } else if (mode === 2) {
            removeAllElem(".item");
            let selectedRate = Number(e.target.value);
            let itemsForPrice = probableGrps.find(
                (obj) => obj.rate === selectedRate,
            )?.items;
            let itemHost = page.querySelector("#old-item-host");
            itemsForPrice.forEach((itemObj) => {
                let child = appendToHost("#grp-item-template", itemHost, "div");
                child.dataset.obj = JSON.stringify(itemObj);
                [...child.querySelectorAll("p")].forEach((p) => {
                    p.textContent = itemObj[p.dataset.name];
                });
            });
        }
    } catch (err) {
        console.error("Error in revealMoreGrpOpts:", err);
    }
}

function createNewGrp(e) {
    try {
        e.stopPropagation();
        let page = traverseParent(e.target, "page");
        let selectedRate = Number(page.querySelector("select").value);
        let newGrpItems = [
            ...document.querySelectorAll("#old-item-host .item>input"),
        ]
            .filter((item) => item.checked === true)
            .map((checkbox) => JSON.parse(checkbox.parentNode.dataset.obj));
        let qty = 0;
        newGrpItems.forEach((obj) => {
            let grpObj = probableGrps.find((obj) => obj.rate === selectedRate);
            grpObj.items.splice(
                grpObj.items.find((_obj) => _obj.id === obj.id),
                1,
            );
            orderItems = orderItems.filter((_obj) => _obj.id != obj.id);
            qty += roundOffTo2DecimalPlace(obj.qty);
        });
        let newId = uuid.v4();
        let desc = newGrpItems.reduce((acc, obj, i, self) => {
            acc += obj.name + "-" + obj.qty + obj.sellUnit;
            if (i < self.length - 1) acc += ", ";
            return acc;
        }, "");
        // Proceed by adding label for new group and aggregate qty for new group.
        let modal = createModal("new-grp-label");
        let child = appendToHost("#new-grp-label-form-template", modal, "FORM");
        child.dataset.obj = JSON.stringify({
            newGrpItems,
            selectedRate,
            newId,
            qty,
            desc,
        });
        child.dataset.id = newId;
        modal.querySelector("input").focus();
        document.querySelector(".cover").addEventListener("click", closeModal);
    } catch (err) {
        console.error("Error in createNewGrp:", err);
        showToastNotification(
            "Error creating group: " + err.message,
            ["animation-common", "move-left", "red-toast-box"],
            document.body,
        );
    }
}

function showPage4(e, cmd) {
    try {
        if (cmd === "cancel-grp")
            orderItems = orderItems.reduce((acc, obj) => {
                if (obj.type !== "grp") acc.push(obj);
                else obj.items.forEach((obj) => acc.push(obj));
                return acc;
            }, []);
        else
            orderItems.forEach((obj) => {
                if (obj.type === "grp")
                    obj.desc = obj.items.reduce((acc, obj, i, self) => {
                        acc += obj.name + ": " + obj.qty + capitalize(obj.sellUnit);
                        if (i < self.length - 1) acc += ", ";
                        return acc;
                    }, "");
            });
        currentStep = 4;
        document.getElementById("page-header").innerHTML = stepDetail();
        mainForm();
    } catch (err) {
        console.error("Error in showPage4:", err);
    }
}

function addDescToItem(e) {
    try {
        e.preventDefault();
        let cmd = e.target.dataset.cmd;
        let descDiv =
            bodyRow.querySelector(".desc-div") || e.target.closest(".desc-div");
        if (cmd === "rej") {
            descDiv.querySelector("input").value = "";
            if ("desc" in selectedItem) selectedItem.desc = "";
        } else selectedItem.desc = descDiv.querySelector("input").value;
        descDiv.classList.add("hide");
    } catch (err) {
        console.error("Error in addDescToItem:", err);
    }
}

function addLabelToGrp(e) {
    try {
        e.preventDefault();
        let label = e.target.label.value;
        let newId = e.target.dataset.id;
        let { desc, newGrpItems, qty, selectedRate } = JSON.parse(
            e.target.dataset.obj,
        );
        orderItems.push({
            items: newGrpItems,
            rate: selectedRate,
            id: newId,
            qty,
            label,
            type: "grp",
            ...["hsn", "sellUnit", "sgst", "cgst", "igst"].reduce((acc, key) => {
                if (key in newGrpItems[0] && newGrpItems[0][key])
                    acc[key] = newGrpItems[0][key];
                return acc;
            }, {}),
            desc,
        });
        [...document.querySelectorAll("#old-grp .item")].forEach((itemDiv) => {
            if (itemDiv.querySelector("input").checked) itemDiv.remove();
        });
        closeModal();
    } catch (err) {
        console.error("Error in addLabelToGrp:", err);
    }
}

function cancelAction() {
    ipcRenderer.send("cancel-sale-bill", currentStep);
}

ipcRenderer.on("get-current-step", cancelAction);

function addPhone(e) {
    let customerPhoneInput = document.getElementById("phones");
    customer.phones = advanceSet(
        customer?.phones ?? [],
        customerPhoneInput.value,
    );
    customerPhoneInput.value = "";
    customerPhoneInput.focus();
    customerPhoneInput.setAttribute("placeholder", "Add new phone number");
}

function displaySection() {
    try {
        if (currentStep !== 3) return;
        removeAllElem(".page #page3-summary-div");
        appendToHost(
            "#summary-div-template",
            document.querySelector("#page-3"),
            "DIV",
        );
        let summaryDiv = document.querySelector("#page3-summary-div");
        [
            ...summaryDiv.querySelectorAll("#product-summary>.summary-col .blue"),
        ].forEach((p) => {
            if (
                p.dataset.name === "specialPrice" &&
                typeof selectedItem.specialPrice === "string"
            ) {
                let sorted;
                try {
                    sorted = JSON.parse(selectedItem.specialPrice || "[]");
                } catch (err) {
                    sorted = [];
                }
                sorted = sorted
                    .filter((obj) => obj.customerId == customer.id)
                    .sort((obj1, obj2) => {
                        if (new Date(obj1.billDate) < new Date(obj2.billDate)) return 1;
                        else if (new Date(obj1.billDate) == new Date(obj2.billDate))
                            return 0;
                        else return -1;
                    });
                p.textContent = sorted?.[0]?.rate ?? 0;
            } else if (
                p.dataset.name === "quantity" &&
                selectedItem.type !== "service"
            ) {
                let quantity = selectedItem.quantity ?? 0;
                let totalQty = orderItems.reduce((acc, obj) => {
                    if (
                        obj.id === selectedItem.id &&
                        "qty" in obj &&
                        "id" in selectedItem &&
                        "id" in obj
                    ) {
                        let res = unitMap.find((uObj) => obj?.sellUnit in uObj);
                        let multiplier =
                            typeof res === "object" ? Object.values(res)[0] : 1;
                        return acc + obj.qty * multiplier;
                    } else return acc;
                }, 0);
                p.textContent = quantity - totalQty;
                if (Math.sign(quantity - totalQty) < 0) p.classList.add("red");
                else p.classList.remove("red");
            } else if (p.dataset.name === "standardSellPrice") {
                let rate = Number(selectedItem.standardSellPrice);
                if (rate === NaN) rate = 0;
                else rate = Math.round(rate);
                p.textContent = roundOffTo2DecimalPlace(rate);
            } else p.textContent = selectedItem[p.dataset.name] ?? "";
        });
        let reducedOrder = reduceOrder();
        // console.log(reducedOrder)
        billMeta.netQty = reducedOrder.netQty;
        billMeta.netAmt = roundOffTo2DecimalPlace(reducedOrder.netAmt);
        billMeta.netAmtTax = roundOffTo2DecimalPlace(reducedOrder.netAmtTax);
        billMeta.netTax = roundOffTo2DecimalPlace(
            billMeta.netAmtTax - billMeta.netAmt,
        );
        [...summaryDiv.querySelectorAll("#bill-summary .highlight")].forEach(
            (p) =>
            (p.textContent = !isNaN(reducedOrder[p.dataset.name])
                ? roundOffTo2DecimalPlace(reducedOrder[p.dataset.name])
                : p.textContent),
        );
    } catch (err) {
        console.error("Error in displaySection:", err);
        showToastNotification(
            "Error displaying summary: " + err.message,
            ["animation-common", "move-left", "red-toast-box"],
            document.body,
        );
    }
}

function deleteRow() {
    try {
        orderItems = deleteRowCommon(bodyRow, orderItems, "sellId");
        displaySection();
    } catch (err) {
        console.error("Error in deleteRow:", err);
        showToastNotification(
            "Error deleting row: " + err.message,
            ["animation-common", "move-left", "red-toast-box"],
            document.body,
        );
    }
}

function updatePayStatus(e) {
    try {
        if (billMeta.billType !== "regular") {
            billMeta.paymentStatus = false;
            return showToastNotification(
                "Monthly bills are marked as unpaid",
                ["animation-common", "move-left", "red-toast-box"],
                "page-4",
                32,
            );
        }
        billMeta.paymentStatus =
            "paymentStatus" in billMeta ? billMeta.paymentStatus : false;
        if (e) billMeta.paymentStatus = e.target.value === "true";
        if (billMeta.paymentStatus)
            showToastNotification(
                "Bill marked as paid",
                ["animation-common", "move-left", "blue-toast-box"],
                "page-4",
                32,
            );
        else
            showToastNotification(
                "Bill marked as unpaid",
                ["animation-common", "move-left", "red-toast-box"],
                "page-4",
                32,
            );
    } catch (err) {
        console.error("Error in updatePayStatus:", err);
    }
}

function showPrintDialog() {
    if (payment.length === 0) payment.push({ type: "due" });
    ipcRenderer.send("show-print-modal", { pageFit: "-o fit-to-page" });
}

ipcRenderer.on("print-obj", (e, printObj) => {
    try {
        billMeta.printObj = printObj;
        if (preset.target === "salePage" && preset.mode === "edit-bill") {
            ipcRenderer.send("cancel-sale-bill", currentStep);
            printObj.customer = customer;
            return ipcRenderer.send(
                "add-item-to-bill",
                preset.itemList,
                orderItems,
                billMeta,
                customer,
                printObj,
            );
        }
        ipcRenderer.send("salepage-print-doc", { billMeta, customer, orderItems });
    } catch (err) {
        console.error("Error in print-obj handler:", err);
        showToastNotification(
            "Error processing print: " + err.message,
            ["animation-common", "move-left", "red-toast-box"],
            document.body,
        );
    }
});

function saveExit() {
    try {
        if (preset.target === "salePage" && preset.mode === "edit-bill") {
            ipcRenderer.send("cancel-sale-bill", currentStep);
            return ipcRenderer.send(
                "add-item-to-bill",
                preset.itemList,
                orderItems,
                billMeta,
                customer,
            );
        }
        if (preset.target === "salePage" && preset.mode === "new-sale")
            ipcRenderer.send("save-exit-sale-bill", {
                billMeta,
                customer,
                orderItems,
            });
        else
            showToastNotification(
                "Please wait, databse initialization is in progress.",
                ["animation-common", "move-left", "red-toast-box"],
                "page-4",
                32,
            );
    } catch (err) {
        console.error("Error in saveExit:", err);
        showToastNotification(
            "Error saving: " + err.message,
            ["animation-common", "move-left", "red-toast-box"],
            document.body,
        );
    }
}

function setShipInfo(e) {
    try {
        let val = e.target.value;
        let option = shipInfoDatalist.querySelector(`option[value="${val}"]`);
        let { shipAddr, shipPh, shipGST, shipTo } = { ...option.dataset };
        document.querySelector('[data-name="shipTo"]').value = shipTo;
        document.querySelector('[data-name="shipAddr"]').value = shipAddr;
        document.querySelector('[data-name="shipPh"]').value = shipPh;
        document.querySelector('[data-name="shipGST"]').value = shipGST;
    } catch (err) {
        console.error("Error in setShipInfo:", err);
    }
}

/* Keyboard Shortcuts Section */ /***************/
document.addEventListener("keydown", (e) => {
    try {
        if (e.key === "Escape") {
            if (document.querySelector(".modal:not(.hide)")) {
                closeModal();
                return;
            }
            let cancelBtn = document.querySelector('[data-type="cancel"]');
            if (cancelBtn && !cancelBtn.classList.contains("hide")) {
                cancelBtn.click();
            }
        } else if (e.ctrlKey && e.shiftKey && e.key === "Enter" && currentStep == 2) {
            assignDeliveryOptions({ value: "hand" });
            document.querySelector("[data-type='proceed']").click();
            billMeta.deliveryType = "hand";
        } else if (e.ctrlKey && e.key === "Enter" && currentStep < 4)
            document.querySelector("[data-type='proceed']").click();
        else if (e.ctrlKey && e.key === "Enter" && currentStep === 4)
            document.querySelector('[data-type="save"]').click();
        else if (e.ctrlKey && e.key === "s" && currentStep === 4) {
            e.preventDefault();
            document.querySelector('[data-type="save"]')?.click();
        } else if (e.ctrlKey && e.key === "+"){
            document.querySelector("#add-item>button").click();
            bodyRow = e.target.closest(".body.row");
        }
        else if (e.ctrlKey && e.key === "Backspace" && currentStep > 1){
            document.querySelector('[data-type="back"]').click();
        }
        else if (
            e.ctrlKey &&
            e.key === "p" &&
            currentStep === 4 &&
            billMeta.billType === "regular"
        )
            document.querySelector(`[data-type="print"]`).click();
        else if (e.ctrlKey && e.key === "r" && currentStep === 3)
            e.target.closest(".body.row").focus();
        else if (!e.ctrlKey && !e.shiftKey && e.key === "ArrowDown" && currentStep === 3 && typeof bodyRow !== "undefined") {
            bodyRow = [...document.querySelectorAll(".body.row")].filter(
                (row) => document.activeElement === row,
            )[0];
            if (bodyRow) {
                bodyRow = bodyRow.nextElementSibling;
                bodyRow.focus();
            } else if (document.activeElement.nodeName !== "INPUT") {
                bodyRow = document.querySelector(".body.row");
                bodyRow.focus();
            }
        } else if (!e.ctrlKey && !e.shiftKey && e.key === "ArrowUp" && currentStep === 3 && typeof bodyRow !== "undefined") {
            bodyRow = [...document.querySelectorAll(".body.row")].filter(
                (row) => document.activeElement === row,
            )[0];
            if (bodyRow) {
                bodyRow = bodyRow.previousElementSibling;
                bodyRow?.focus();
            } else if (document.activeElement.nodeName !== "INPUT") {
                bodyRow = document.querySelector(".body.row");
                bodyRow?.focus();
            }
        } else if (e.key === "Enter" && currentStep === 3 && typeof bodyRow !== "undefined") {
            [...bodyRow.querySelectorAll(".body.row")]
                .filter((row) => document.activeElement === row)[0]
                .querySelector('input[data-name="name"]')
                .focus();
        } else if (e.shiftKey && e.key === "Delete" && currentStep === 3 && typeof bodyRow !== "undefined") {
            if (bodyRow.id === "table") bodyRow = document.activeElement;
            bodyRow = bodyRow.classList.contains("row")
                ? bodyRow
                : document.activeElement;
            let rowNo = [...document.querySelectorAll(".body.row")].indexOf(bodyRow);
            if (rowNo === -1) return;
            deleteRow();
            bodyRow = document.querySelectorAll(".body.row")[rowNo - 1];
            if (!bodyRow) bodyRow = document.querySelector(".body.row");
            bodyRow?.focus();
        } else if (
            e.shiftKey &&
            e.key === "Insert" &&
            currentStep === 3 &&
            typeof bodyRow !== "undefined"
        ) {
            bodyRow.querySelector(".desc-div").classList.remove("hide");
            bodyRow.querySelector(".desc-div input").focus();
            return;
        } else if (
            bodyRow &&
            e.shiftKey &&
            e.key === "Enter" &&
            currentStep === 3 &&
            !bodyRow.querySelector(".desc-div").classList.contains("hide")
        )
            bodyRow.querySelector(".desc-cnf-btn").click();
        else if (
            bodyRow &&
            e.shiftKey &&
            e.key === "Backspace" &&
            currentStep === 3 &&
            !bodyRow.querySelector(".desc-div").classList.contains("hide")
        )
            bodyRow.querySelector(".desc-rej-btn").click();
        else if (
            e.ctrlKey &&
            e.shiftKey &&
            (e.key === "ArrowUp" || e.key === "ArrowDown") &&
            currentStep === 3
        ) {
            let focusedElem = document.activeElement;
            if (typeof bodyRow === "undefined") {
                bodyRow = [...document.querySelectorAll(".body.row")].filter(
                    (row) => document.activeElement === row,
                )[0];
                bodyRow = e.target.closest(".body.row");
            } else if (bodyRow.id === "table") {
                bodyRow = document.activeElement.closest(".body.row");
            }
            let prevRow = bodyRow.previousElementSibling;
            let nextRow = bodyRow.nextElementSibling;
            if (e.key === "ArrowDown" && nextRow)
                // Already at the bottom
                nextRow.after(bodyRow);
            else if (e.key === "ArrowUp" && prevRow)
                // Already at the top
                prevRow.before(bodyRow);
            [...document.querySelectorAll(".body.row")].forEach((row, index) => {
                // Update row numbers after rearrangement
                row.querySelector("p").textContent = index + 1;
            });
            focusedElem.focus();
        }
    } catch (err) {
        console.error("Error in keydown handler:", err);
    }
});
