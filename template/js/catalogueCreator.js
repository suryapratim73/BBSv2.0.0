/**
 * catalogueCreator.js
 *
 * Catalogue Creator — allows users to categorize stock items for kiosk display.
 * Items are grouped by the "key" property in pInfo.
 * Users can drag-and-drop items into categories, add/remove items,
 * and attach reference pictures.
 */

const { ipcRenderer } = require("electron");
const { toggleDevTool } = require("../js/common");

toggleDevTool(document);

// ---- State ----
let catalogueData = [];          // All stock items with pInfo
let categories = {};            // { categoryKey: [itemId, ...] }
let categoryOrder = [];         // Order of categories for display
let allItemsMap = {};           // { itemId: itemObject } for fast lookup
let currentRefPicItemId = null; // Track which item's ref pics are being viewed
let isDirty = false;            // Track unsaved changes

// ---- Initialization ----
document.addEventListener("DOMContentLoaded", async () => {
    await loadCatalogueData();
    renderAll();
    setupKeyboardShortcuts();
});

/**
 * Load all catalogue data from the backend
 */
async function loadCatalogueData() {
    try {
        let items = await ipcRenderer.invoke("get-catalogue-data");
        catalogueData = items || [];
        allItemsMap = {};
        catalogueData.forEach(item => {
            allItemsMap[item.id] = item;
        });
        buildCategoriesFromData();
    } catch (err) {
        console.error("Failed to load catalogue data:", err);
        showToast("Failed to load data", "error");
    }
}

/**
 * Build categories from the "key" property in each item's pInfo
 */
function buildCategoriesFromData() {
    categories = {};
    categoryOrder = [];

    catalogueData.forEach(item => {
        let key = item.pInfo?.key;
        if (key && typeof key === "string" && key.trim() !== "") {
            key = key.trim();
            if (!categories[key]) {
                categories[key] = [];
                categoryOrder.push(key);
            }
            categories[key].push(item.id);
        }
    });
}

/**
 * Get uncategorized items (no "key" in pInfo or empty key)
 */
function getUncategorizedItems() {
    let categorizedIds = new Set();
    Object.values(categories).forEach(idList => {
        idList.forEach(id => categorizedIds.add(id));
    });
    return catalogueData.filter(item => !categorizedIds.has(item.id));
}

/**
 * Render the entire catalogue UI
 */
function renderAll() {
    renderUncategorizedPanel();
    renderCategoriesPanel();
    updateCounts();
}

/**
 * Render the uncategorized items panel
 */
function renderUncategorizedPanel() {
    let container = document.getElementById("uncategorized-list");
    if (!container) return;

    let uncategorized = getUncategorizedItems();
    container.innerHTML = "";

    if (uncategorized.length === 0) {
        container.innerHTML = '<div class="empty-state">All items are categorized!</div>';
        return;
    }

    uncategorized.forEach(item => {
        let card = createItemCard(item);
        container.appendChild(card);
    });
}

/**
 * Render all category sections
 */
function renderCategoriesPanel() {
    let container = document.getElementById("categories-container");
    if (!container) return;

    container.innerHTML = "";

    if (categoryOrder.length === 0) {
        container.innerHTML = '<div class="empty-state">No categories yet. Click "+ New Category" to create one.</div>';
        return;
    }

    categoryOrder.forEach(categoryKey => {
        let section = createCategorySection(categoryKey);
        container.appendChild(section);
    });
}

/**
 * Create an item card element from a template
 */
function createItemCard(item) {
    let template = document.getElementById("item-card-template");
    let card = template.content.cloneNode(true).querySelector(".item-card");

    card.setAttribute("data-item-id", item.id);
    card.querySelector(".item-name").textContent = item.name;
    card.querySelector(".item-type").textContent = item.type || "—";
    card.querySelector(".item-price").textContent = "₹" + (item.standardSellPrice || 0);

    // Render ref pic thumbnails
    let refPicsContainer = card.querySelector("[data-ref-pics]");
    let refPics = item.pInfo?.refPics || [];
    refPics.forEach(picPath => {
        let thumb = createRefPicThumb(picPath);
        refPicsContainer.appendChild(thumb);
    });

    return card;
}

/**
 * Create a category section from template
 */
function createCategorySection(categoryKey) {
    let template = document.getElementById("category-section-template");
    let section = template.content.cloneNode(true).querySelector(".category-section");

    section.setAttribute("data-category-key", categoryKey);
    section.querySelector(".category-name-input").value = categoryKey;

    let itemIds = categories[categoryKey] || [];
    section.querySelector(".category-item-count").textContent = itemIds.length + " items";

    let itemsContainer = section.querySelector(".category-items");
    itemIds.forEach(id => {
        let item = allItemsMap[id];
        if (item) {
            let card = createItemCard(item);
            itemsContainer.appendChild(card);
        }
    });

    return section;
}

/**
 * Create a reference picture thumbnail
 */
function createRefPicThumb(picPath) {
    let template = document.getElementById("ref-pic-thumb-template");
    let thumb = template.content.cloneNode(true).querySelector(".ref-pic-thumb");

    thumb.setAttribute("data-pic-path", picPath);
    // Use file:// protocol for local images
    thumb.querySelector("img").src = "file://" + picPath.replace(/\\/g, "/");

    return thumb;
}

/**
 * Update item counts
 */
function updateCounts() {
    let uncategorized = getUncategorizedItems();
    let countEl = document.getElementById("uncategorized-count");
    if (countEl) {
        countEl.textContent = uncategorized.length;
    }

    // Update each category's item count
    document.querySelectorAll(".category-section").forEach(section => {
        let key = section.getAttribute("data-category-key");
        let count = (categories[key] || []).length;
        let countEl = section.querySelector(".category-item-count");
        if (countEl) {
            countEl.textContent = count + " items";
        }
    });
}

// ---- Drag and Drop ----
let draggedItemId = null;

function handleDragStart(event) {
    let card = event.target.closest(".item-card");
    if (!card) return;

    draggedItemId = card.getAttribute("data-item-id");
    card.classList.add("dragging");

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draggedItemId);
}

function handleDragEnd(event) {
    let card = event.target.closest(".item-card");
    if (card) {
        card.classList.remove("dragging");
    }

    // Remove all drag-over highlights
    document.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));

    draggedItemId = null;
}

function handleDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    // Highlight the drop zone
    let dropZone = event.target.closest(".category-items, .panel-body, .category-section");
    if (dropZone) {
        // For category-section, highlight its items container
        if (dropZone.classList.contains("category-section")) {
            dropZone.classList.add("drag-over");
        } else {
            dropZone.classList.add("drag-over");
        }
    }
}

function handleDrop(event, targetCategoryKey) {
    event.preventDefault();

    // Remove all drag-over highlights
    document.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));

    let itemId = event.dataTransfer.getData("text/plain") || draggedItemId;
    if (!itemId) return;

    // Determine the actual target category
    let categorySection = event.target.closest(".category-section");
    if (categorySection) {
        targetCategoryKey = categorySection.getAttribute("data-category-key");
    }

    let isUncategorizedPanel = event.target.closest(".uncategorized-panel");

    // If dropped on uncategorized panel, remove from category
    if (isUncategorizedPanel) {
        removeItemFromAllCategories(itemId);
        isDirty = true;
        renderAll();
        return;
    }

    // If dropped on a specific category
    if (targetCategoryKey && targetCategoryKey !== "") {
        moveItemToCategory(itemId, targetCategoryKey);
        isDirty = true;
        renderAll();
    }
}

/**
 * Move an item to a specific category
 */
function moveItemToCategory(itemId, categoryKey) {
    // Remove from all existing categories first
    removeItemFromAllCategories(itemId);

    // Add to the target category
    if (!categories[categoryKey]) {
        categories[categoryKey] = [];
        if (!categoryOrder.includes(categoryKey)) {
            categoryOrder.push(categoryKey);
        }
    }

    if (!categories[categoryKey].includes(itemId)) {
        categories[categoryKey].push(itemId);
    }
}

/**
 * Remove an item from all categories
 */
function removeItemFromAllCategories(itemId) {
    Object.keys(categories).forEach(key => {
        categories[key] = categories[key].filter(id => id !== itemId);
        if (categories[key].length === 0) {
            delete categories[key];
            categoryOrder = categoryOrder.filter(k => k !== key);
        }
    });
}

/**
 * Remove an item from its current category (button click)
 */
function removeItemFromCategory(event) {
    event.stopPropagation();
    let card = event.target.closest(".item-card");
    if (!card) return;

    let itemId = card.getAttribute("data-item-id");
    removeItemFromAllCategories(itemId);
    isDirty = true;
    renderAll();
    showToast("Item removed from category", "success");
}

// ---- Category Management ----

/**
 * Add a new empty category
 */
function addCategory() {
    let newKey = "New Category";
    let counter = 1;

    // Ensure unique name
    while (categories[newKey]) {
        newKey = "New Category " + counter;
        counter++;
    }

    categories[newKey] = [];
    categoryOrder.push(newKey);
    isDirty = true;
    renderAll();

    // Focus the new category's name input
    setTimeout(() => {
        let sections = document.querySelectorAll(".category-section");
        let lastSection = sections[sections.length - 1];
        if (lastSection) {
            let input = lastSection.querySelector(".category-name-input");
            if (input) {
                input.focus();
                input.select();
            }
        }
    }, 100);
}

/**
 * Handle category rename
 */
function handleCategoryRename(event) {
    let input = event.target;
    let section = input.closest(".category-section");
    if (!section) return;

    let oldKey = section.getAttribute("data-category-key");
    let newKey = input.value.trim();

    if (!newKey || newKey === oldKey) {
        // Revert to old name
        input.value = oldKey;
        return;
    }

    // Check for duplicate names
    if (categories[newKey] && newKey !== oldKey) {
        showToast("A category with this name already exists", "error");
        input.value = oldKey;
        return;
    }

    // Rename the category
    if (categories[oldKey]) {
        categories[newKey] = categories[oldKey];
        delete categories[oldKey];
        categoryOrder = categoryOrder.map(k => k === oldKey ? newKey : k);
        section.setAttribute("data-category-key", newKey);
    }

    isDirty = true;
}

/**
 * Delete a category (items return to uncategorized)
 */
function deleteCategory(event) {
    event.stopPropagation();
    let section = event.target.closest(".category-section");
    if (!section) return;

    let categoryKey = section.getAttribute("data-category-key");

    if (confirm(`Delete category "${categoryKey}"? Items will return to uncategorized.`)) {
        delete categories[categoryKey];
        categoryOrder = categoryOrder.filter(k => k !== categoryKey);
        isDirty = true;
        renderAll();
        showToast(`Category "${categoryKey}" deleted`, "success");
    }
}

// ---- Item Management ----

/**
 * Show the add item modal
 */
function showAddItemModal() {
    let template = document.getElementById("add-item-modal-template");
    let modal = template.content.cloneNode(true);
    document.body.appendChild(modal);
}

/**
 * Close the add item modal
 */
function closeAddItemModal() {
    let modal = document.querySelector(".add-item-modal");
    let cover = document.querySelector(".cover");
    if (modal) modal.remove();
    if (cover) cover.remove();
}

/**
 * Create a new stock item from the modal form
 */
async function createItem() {
    let name = document.getElementById("new-item-name")?.value?.trim();
    if (!name) {
        showToast("Item name is required", "error");
        return;
    }

    let itemObj = {
        name: name,
        type: document.getElementById("new-item-type")?.value?.trim() || "",
        unit: document.getElementById("new-item-unit")?.value?.trim() || "Kg",
        hsn: parseInt(document.getElementById("new-item-hsn")?.value) || 7318,
        standardSellPrice: parseFloat(document.getElementById("new-item-price")?.value) || 0
    };

    try {
        let newItem = await ipcRenderer.invoke("create-catalogue-item", itemObj);
        if (newItem) {
            catalogueData.push(newItem);
            allItemsMap[newItem.id] = newItem;
            isDirty = true;
            closeAddItemModal();
            renderAll();
            showToast(`Item "${name}" created`, "success");
        } else {
            showToast("Failed to create item", "error");
        }
    } catch (err) {
        console.error("Error creating item:", err);
        showToast("Error creating item", "error");
    }
}

// ---- Save Catalogue ----

/**
 * Save all catalogue categories to the backend
 */
async function saveCatalogue() {
    let btn = document.getElementById("btn-save");
    if (btn) {
        btn.disabled = true;
        btn.textContent = "Saving...";
    }

    // Build the save payload: each item gets its category key
    let items = [];

    // Items in categories
    Object.keys(categories).forEach(categoryKey => {
        (categories[categoryKey] || []).forEach(itemId => {
            items.push({ id: itemId, key: categoryKey });
        });
    });

    // Uncategorized items get an empty key
    let categorizedIds = new Set(items.map(i => i.id));
    catalogueData.forEach(item => {
        if (!categorizedIds.has(item.id)) {
            items.push({ id: item.id, key: "" });
        }
    });

    try {
        // Listen for the response
        ipcRenderer.once("catalogue-save-response", (event, response) => {
            if (btn) {
                btn.disabled = false;
                btn.textContent = "Save Catalogue";
            }

            if (response.success) {
                isDirty = false;
                showToast("Catalogue saved successfully!", "success");
                // Reload data to sync with backend
                loadCatalogueData().then(() => renderAll());
            } else {
                showToast("Save failed: " + (response.error || "Unknown error"), "error");
            }
        });

        ipcRenderer.send("save-catalogue-categories", { items });
    } catch (err) {
        console.error("Error saving catalogue:", err);
        if (btn) {
            btn.disabled = false;
            btn.textContent = "Save Catalogue";
        }
        showToast("Error saving catalogue", "error");
    }
}

// ---- Reference Pictures ----

/**
 * Handle reference picture button click on an item card
 */
function handleRefPic(event) {
    event.stopPropagation();
    let card = event.target.closest(".item-card");
    if (!card) return;

    let itemId = card.getAttribute("data-item-id");
    currentRefPicItemId = itemId;
    showRefPicViewer(itemId);
}

/**
 * Show the reference picture viewer modal
 */
function showRefPicViewer(itemId) {
    let item = allItemsMap[itemId];
    if (!item) return;

    let template = document.getElementById("ref-pic-viewer-template");
    let viewer = template.content.cloneNode(true);

    viewer.querySelector("#ref-pic-item-name").textContent = "Reference Pictures — " + item.name;

    document.body.appendChild(viewer);

    renderRefPicsInViewer(itemId);
}

/**
 * Render reference pictures in the viewer
 */
function renderRefPicsInViewer(itemId) {
    let body = document.getElementById("ref-pic-viewer-body");
    if (!body) return;

    let item = allItemsMap[itemId];
    if (!item) return;

    let refPics = item.pInfo?.refPics || [];
    body.innerHTML = "";

    refPics.forEach(picPath => {
        let thumb = createRefPicThumb(picPath);
        body.appendChild(thumb);
    });
}

/**
 * Add a reference picture from the viewer modal
 */
async function addRefPicFromViewer() {
    if (!currentRefPicItemId) return;

    try {
        let result = await ipcRenderer.invoke("add-ref-pic", currentRefPicItemId);
        if (result.success) {
            // Update local data
            let item = allItemsMap[currentRefPicItemId];
            if (item) {
                if (!item.pInfo) item.pInfo = {};
                item.pInfo.refPics = result.refPics;
            }
            isDirty = true;
            renderRefPicsInViewer(currentRefPicItemId);
            // Also update the item card in the background
            renderAll();
            showToast("Reference picture added", "success");
        } else if (!result.cancelled) {
            showToast("Failed to add picture: " + (result.error || ""), "error");
        }
    } catch (err) {
        console.error("Error adding ref pic:", err);
        showToast("Error adding reference picture", "error");
    }
}

/**
 * Remove a reference picture
 */
function removeRefPic(event) {
    event.stopPropagation();
    let thumb = event.target.closest(".ref-pic-thumb");
    if (!thumb) return;

    let picPath = thumb.getAttribute("data-pic-path");
    if (!picPath || !currentRefPicItemId) return;

    if (!confirm("Remove this reference picture?")) return;

    ipcRenderer.once("ref-pic-removed", (event, response) => {
        if (response.success) {
            // Update local data
            let item = allItemsMap[response.itemId];
            if (item) {
                if (!item.pInfo) item.pInfo = {};
                item.pInfo.refPics = response.refPics;
            }
            isDirty = true;
            renderRefPicsInViewer(currentRefPicItemId);
            renderAll();
            showToast("Reference picture removed", "success");
        }
    });

    ipcRenderer.send("remove-ref-pic", { itemId: currentRefPicItemId, picPath });
}

/**
 * Close the reference picture viewer
 */
function closeRefPicViewer() {
    let modal = document.querySelector(".ref-pic-viewer-modal");
    let cover = document.querySelector(".cover");
    if (modal) modal.remove();
    if (cover) cover.remove();
    currentRefPicItemId = null;
}

// ---- Search ----

/**
 * Handle search input
 */
function handleSearch(event) {
    let query = event.target.value.trim().toLowerCase();

    document.querySelectorAll(".item-card").forEach(card => {
        let itemName = card.querySelector(".item-name")?.textContent?.toLowerCase() || "";
        let itemType = card.querySelector(".item-type")?.textContent?.toLowerCase() || "";

        if (!query || itemName.includes(query) || itemType.includes(query)) {
            card.classList.remove("hidden-by-search");
            if (query) card.classList.add("search-match");
            else card.classList.remove("search-match");
        } else {
            card.classList.add("hidden-by-search");
            card.classList.remove("search-match");
        }
    });
}

// ---- Toast Notifications ----

/**
 * Show a temporary toast message
 */
function showToast(message, type) {
    // Remove any existing toast
    let existingToast = document.querySelector(".save-toast");
    if (existingToast) existingToast.remove();

    let toast = document.createElement("div");
    toast.className = "save-toast " + (type || "success");
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 2500);
}

// ---- Keyboard Shortcuts ----

/**
 * Set up keyboard shortcuts
 */
function setupKeyboardShortcuts() {
    document.addEventListener("keydown", (event) => {
        // Ctrl+S or Ctrl+Shift+S to save
        if ((event.ctrlKey || event.metaKey) && event.key === "s") {
            event.preventDefault();
            saveCatalogue();
        }
        // Escape to close modals
        if (event.key === "Escape") {
            closeAddItemModal();
            closeRefPicViewer();
        }
    });
}

// ---- Dirty State Warning ----

/**
 * Warn user about unsaved changes before closing
 */
window.addEventListener("beforeunload", (event) => {
    if (isDirty) {
        event.preventDefault();
        event.returnValue = "You have unsaved changes. Are you sure you want to leave?";
        return event.returnValue;
    }
});

// ---- Expose functions for HTML onclick handlers (global scope) ----
// These need to be on window because the HTML uses inline onclick attributes
window.handleSearch = handleSearch;
window.saveCatalogue = saveCatalogue;
window.showAddItemModal = showAddItemModal;
window.closeAddItemModal = closeAddItemModal;
window.createItem = createItem;
window.handleDragStart = handleDragStart;
window.handleDragEnd = handleDragEnd;
window.handleDragOver = handleDragOver;
window.handleDrop = handleDrop;
window.handleRefPic = handleRefPic;
window.removeRefPic = removeRefPic;
window.closeRefPicViewer = closeRefPicViewer;
window.removeItemFromCategory = removeItemFromCategory;
window.addCategory = addCategory;
window.handleCategoryRename = handleCategoryRename;
window.deleteCategory = deleteCategory;

// Expose for the viewer's "Add Picture" button
document.addEventListener("click", (event) => {
    if (event.target.id === "btn-add-pic") {
        addRefPicFromViewer();
    }
});
