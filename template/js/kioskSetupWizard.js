/**
 * kioskSetupWizard.js — Client-side logic for the Kiosk Setup Wizard
 *
 * Manages a 5-step configuration wizard that collects kiosk settings
 * and saves them to kioskConf.json on completion.
 *
 * Steps (0-indexed):
 *   0 — WiFi Setup (instructional, shows local IP)
 *   1 — Customer Selector toggle
 *   2 — Product Layout selection (uncategorized / auto / manual)
 *   3 — DB Connection mode (order-only / auto-bill)
 *   4 — Receipt Generation toggle
 */

const { ipcRenderer } = require("electron");

// ---- State ----
var currentStep = 0;                     // 0-indexed, current visible step
var totalSteps = 5;                      // total number of wizard steps
var wizardConfig = {
    pin: "1234",                         // default PIN (user can change later in settings)
    includeCustomerSelector: true,       // Step 2 default
    productLayout: "uncategorized",      // Step 3 default: "uncategorized" | "auto" | "manual"
    dbMode: "order-only",                // Step 4 default: "order-only" | "auto-bill"
    generateReceipt: true                // Step 5 default
};

// Track whether each step has been visited (for progress dots)
var visitedSteps = [true, false, false, false, false];

// ---- Initialization ----
function init() {
    // Fetch the local IP address from the main process for Step 1 display
    ipcRenderer.invoke("get-local-ip").then(function (ip) {
        var ipDisplay = document.getElementById("wizard-local-ip");
        if (ipDisplay) {
            ipDisplay.textContent = ip || "127.0.0.1";
        }
    }).catch(function () {
        var ipDisplay = document.getElementById("wizard-local-ip");
        if (ipDisplay) {
            ipDisplay.textContent = "Unable to detect IP";
        }
    });

    // Render the initial step
    renderStep(0);
}

// ---- Step Rendering ----
/**
 * Shows the specified step, updates progress dots, and manages Back button state.
 * @param {number} stepIndex - 0-indexed step to display
 */
function renderStep(stepIndex) {
    // Hide all steps
    var allSteps = document.querySelectorAll(".wizard-step");
    allSteps.forEach(function (step) {
        step.classList.remove("active");
    });

    // Show the target step
    var targetStep = document.getElementById("step-" + stepIndex);
    if (targetStep) {
        targetStep.classList.add("active");
    }

    // Mark this step as visited
    visitedSteps[stepIndex] = true;

    // Update progress dots
    updateProgressDots();

    // Update navigation buttons
    var btnBack = document.getElementById("btn-back");
    var btnNext = document.getElementById("btn-next");

    // Back button: disabled on first step
    btnBack.disabled = (stepIndex === 0);

    // Next button: change label on last step
    if (stepIndex === totalSteps - 1) {
        btnNext.textContent = "✓ Finish & Start Kiosk";
    } else {
        btnNext.textContent = "Next →";
    }

    // Restore previously selected options for this step (if user navigates back)
    restoreSelections(stepIndex);

    currentStep = stepIndex;
}

/**
 * Updates the progress dots at the top of the wizard.
 * - .active for the current step
 * - .done for previously visited steps (includes a checkmark)
 */
function updateProgressDots() {
    var dots = document.querySelectorAll(".step-dot");
    dots.forEach(function (dot, index) {
        // Remove all state classes
        dot.classList.remove("active", "done");

        if (index === currentStep) {
            dot.classList.add("active");
        } else if (visitedSteps[index]) {
            dot.classList.add("done");
        }
    });
}

// ---- Option Selection ----
/**
 * Handles selection of an option card within a step.
 * Stores the choice in wizardConfig and applies the .selected visual state.
 *
 * @param {string} configKey  - The key in wizardConfig to update (e.g., "productLayout")
 * @param {*}      value      - The value to store
 * @param {Element} cardElement - The clicked .option-card DOM element
 */
function selectOption(configKey, value, cardElement) {
    // Store the choice
    wizardConfig[configKey] = value;

    // Remove .selected from all sibling cards in the same option-list
    var parentList = cardElement.parentElement;
    if (parentList) {
        var cards = parentList.querySelectorAll(".option-card");
        cards.forEach(function (card) {
            card.classList.remove("selected");
        });
    }

    // Mark the clicked card as selected
    cardElement.classList.add("selected");
}

/**
 * Restores the visual selection state for the current step
 * based on the values already stored in wizardConfig.
 *
 * @param {number} stepIndex - The step being rendered
 */
function restoreSelections(stepIndex) {
    // Map step index to the config key used in that step
    var stepKeyMap = {
        1: "includeCustomerSelector",
        2: "productLayout",
        3: "dbMode",
        4: "generateReceipt"
    };

    var configKey = stepKeyMap[stepIndex];
    if (!configKey) return; // Step 0 has no selection

    var currentValue = wizardConfig[configKey];
    if (currentValue === undefined) return;

    // Find the matching option card and mark it selected
    var allCards = document.querySelectorAll("#step-" + stepIndex + " .option-card");
    allCards.forEach(function (card) {
        card.classList.remove("selected");
        var cardValue = card.getAttribute("data-value");
        // Compare values (handle boolean vs string)
        if (String(cardValue) === String(currentValue)) {
            card.classList.add("selected");
        }
    });
}

// ---- WiFi Guide Download ----

/**
 * Requests the main process to generate a WiFi Setup Guide PDF using pdfkit.
 * On success, shows a confirmation message with the file path.
 * On failure, shows an error in the download status element.
 */
function downloadWifiGuide() {
    var statusEl = document.getElementById("download-status");
    var btnEl = document.getElementById("btn-download-guide");

    // Show loading state
    btnEl.disabled = true;
    btnEl.textContent = "⏳ Generating PDF...";
    if (statusEl) statusEl.textContent = "Creating your WiFi setup guide...";

    ipcRenderer.invoke("generate-wifi-setup-pdf").then(function (result) {
        btnEl.disabled = false;
        btnEl.textContent = "📥 Download WiFi Setup Guide (PDF)";

        if (result && result.success) {
            // Success — show the file path
            if (statusEl) {
                statusEl.innerHTML = '✅ Guide saved to:<br><code style="font-size:0.75rem;word-break:break-all;">' +
                    escHTML(result.path) + '</code>';
                statusEl.style.color = "#2e7d32";
            }
        } else {
            // Failure — show error
            if (statusEl) {
                statusEl.textContent = "❌ Failed to generate PDF. " + (result && result.error ? result.error : "Unknown error.");
                statusEl.style.color = "#c62828";
            }
        }
    }).catch(function (err) {
        btnEl.disabled = false;
        btnEl.textContent = "📥 Download WiFi Setup Guide (PDF)";
        if (statusEl) {
            statusEl.textContent = "❌ Error: " + (err && err.message ? err.message : "Could not generate PDF.");
            statusEl.style.color = "#c62828";
        }
    });
}

/**
 * Escapes HTML characters in a string to prevent XSS.
 * Used when displaying user-facing paths or messages.
 * @param {string} str - Raw string to escape
 * @returns {string} HTML-escaped string
 */
function escHTML(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// ---- Navigation ----
/**
 * Advances to the next step. On the last step, validates and triggers the finish flow.
 */
function nextStep() {
    // Validate that the current step has a selection (steps 1-4 require selection)
    var stepKeyMap = {
        1: "includeCustomerSelector",
        2: "productLayout",
        3: "dbMode",
        4: "generateReceipt"
    };

    var configKey = stepKeyMap[currentStep];
    if (configKey) {
        // If no selection has been made for this step, show a brief highlight
        var selectedCard = document.querySelector("#step-" + currentStep + " .option-card.selected");
        if (!selectedCard) {
            // Flash the option cards to indicate selection is required
            var cards = document.querySelectorAll("#step-" + currentStep + " .option-card");
            cards.forEach(function (card) {
                card.style.borderColor = "#ff4444";
                setTimeout(function () {
                    card.style.borderColor = "";
                }, 600);
            });
            return;
        }
    }

    // If on the last step, finish the wizard
    if (currentStep >= totalSteps - 1) {
        finishSetup();
        return;
    }

    // Advance to the next step
    renderStep(currentStep + 1);
}

/**
 * Moves back to the previous step.
 */
function prevStep() {
    if (currentStep <= 0) return;
    renderStep(currentStep - 1);
}

// ---- Finish ----
/**
 * Saves the wizardConfig to kioskConf.json via IPC,
 * then triggers the kiosk server start and closes the wizard window.
 */
async function finishSetup() {
    try {
        // Save the configuration to disk
        await ipcRenderer.invoke("save-kiosk-config", wizardConfig);

        // Signal the main process to start the kiosk server with the new config
        ipcRenderer.send("start-kiosk-after-setup");

        // Close the wizard window
        window.close();
    } catch (err) {
        console.error("Kiosk setup wizard — failed to save config:", err);
        // Show error state on the finish button
        var btnNext = document.getElementById("btn-next");
        btnNext.textContent = "Error! Try Again";
        btnNext.style.background = "#ff4444";
        setTimeout(function () {
            btnNext.textContent = "✓ Finish & Start Kiosk";
            btnNext.style.background = "";
        }, 2000);
    }
}

// ---- Boot ----
init();
