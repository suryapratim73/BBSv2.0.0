/**
 * BBS Kiosk — Client-side logic for login and sale pages.
 *
 * Handles:
 *   - PIN-based login authentication
 *   - Product listing with configurable layout (uncategorized / auto-categorized / manual)
 *   - Cart management (add, remove, quantity change)
 *   - Customer search with debounce (conditionally shown per kiosk config)
 *   - Checkout flow with payment entry
 *   - Anonymous walk-in sales (when customer selector is disabled)
 */

(function () {
    // ===================== LOGIN PAGE =====================
    var pin = "";
    var pinEl = document.getElementById("pin-dots");
    var pinErr = document.getElementById("pin-error");

    /**
     * Updates the PIN dot indicators to reflect the current PIN length.
     */
    function updatePinDots() {
        if (!pinEl) return;
        var dots = pinEl.querySelectorAll("span");
        dots.forEach(function (d, i) { d.classList.toggle("filled", i < pin.length); });
    }

    // Attach PIN pad click handler (delegated from the pin-pad container)
    var pinPad = document.getElementById("pin-pad");
    if (pinPad) {
        pinPad.addEventListener("click", function (e) {
            var btn = e.target.closest("button");
            if (!btn) return;
            var num = btn.dataset.num;
            if (num === "clear") { pin = ""; pinErr.classList.add("hide"); }
            else if (num === "go") { submitPIN(); return; }
            else if (pin.length < 4) { pin += num; }

            updatePinDots();
            if (pin.length === 4) { setTimeout(submitPIN, 200); }
        });
    }

    /**
     * Submits the entered PIN to the kiosk server for authentication.
     * On success, stores the auth token as a cookie and redirects to the sale page.
     */
    function submitPIN() {
        if (pin.length < 4) return;
        fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pin: pin })
        }).then(function (r) { return r.json(); })
          .then(function (data) {
              if (data.success) {
                  document.cookie = "kiosk_token=" + data.token + "; path=/";
                  location.href = "/sale";
              } else {
                  pin = ""; updatePinDots();
                  pinErr.classList.remove("hide");
              }
          }).catch(function () { pin = ""; updatePinDots(); });
    }

    // ===================== SALE PAGE =====================
    var cart = [];                // shopping cart: array of {id, name, rate, unit, sgst, cgst, igst, hsn, qty}
    var products = [];           // raw product list from /api/products
    var selectedCustomer = null; // {id, name} of the selected customer from search
    var kioskConfig = {};        // configuration loaded from /api/config

    /**
     * Loads kiosk configuration from the server and applies it to the UI.
     */
    function loadConfig() {
        fetch("/api/config")
            .then(function (r) { return r.json(); })
            .then(function (config) {
                kioskConfig = config;
                applyConfig(config);
            })
            .catch(function () {
                // If config endpoint fails, use defaults (all features enabled)
                kioskConfig = {
                    includeCustomerSelector: true,
                    productLayout: "uncategorized",
                    generateReceipt: true
                };
            });
    }

    /**
     * Applies the loaded kiosk configuration to the sale page UI.
     * @param {object} config - Kiosk configuration from /api/config
     */
    function applyConfig(config) {
        // ---- Customer Selector Visibility ----
        var customerSection = document.getElementById("checkout-customer-section");
        var anonymousNote = document.getElementById("checkout-anonymous-note");

        if (config.includeCustomerSelector === false) {
            // Hide customer search, show anonymous walk-in note
            if (customerSection) customerSection.classList.add("hide");
            if (anonymousNote) anonymousNote.classList.remove("hide");
        } else {
            // Show customer search (default behavior)
            if (customerSection) customerSection.classList.remove("hide");
            if (anonymousNote) anonymousNote.classList.add("hide");
        }
    }

    /**
     * Loads the product list from the server and renders it.
     * The server returns data in the format matching the configured product layout.
     */
    function loadProducts() {
        fetch("/api/products")
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data && data.layout) {
                    products = data;
                    renderCategorizedProducts(data);
                } else if (Array.isArray(data)) {
                    products = data;
                    renderFlatProducts(products);
                } else if (data && data.products) {
                    products = data.products;
                    renderFlatProducts(products);
                } else {
                    document.getElementById("product-grid").innerHTML =
                        '<p class="loading">No products found.</p>';
                }
            }).catch(function () {
                document.getElementById("product-grid").innerHTML =
                    '<p class="loading">Failed to load products.</p>';
            });
    }

    /**
     * Renders products as a flat grid (uncategorized layout).
     * Each product is a clickable card that adds the item to the cart.
     * @param {Array} list - Array of product objects
     */
    function renderFlatProducts(list) {
        var grid = document.getElementById("product-grid");
        if (!list.length) {
            grid.innerHTML = '<p class="loading">No products found.</p>';
            return;
        }
        grid.innerHTML = list.map(function (p) {
            return buildProductCard(p);
        }).join("");
    }

    /**
     * Renders products organized by category groups.
     * @param {object} data - { layout, categories: { "Category": [items...] }, uncategorized: [items...] }
     */
    function renderCategorizedProducts(data) {
        var grid = document.getElementById("product-grid");
        var html = "";

        // Render categorized groups first
        if (data.categories) {
            var catNames = Object.keys(data.categories);
            catNames.forEach(function (catName) {
                var items = data.categories[catName];
                if (items && items.length > 0) {
                    html += '<div class="category-group">';
                    html += '<div class="category-header">' + esc(catName) + '</div>';
                    html += '<div class="category-items">';
                    html += items.map(function (p) {
                        return buildProductCard(p);
                    }).join("");
                    html += '</div></div>';
                }
            });
        }

        // Render uncategorized items at the bottom
        if (data.uncategorized && data.uncategorized.length > 0) {
            html += '<div class="category-group">';
            html += '<div class="category-header">Other</div>';
            html += '<div class="category-items">';
            html += data.uncategorized.map(function (p) {
                return buildProductCard(p);
            }).join("");
            html += '</div></div>';
        }

        if (!html) {
            grid.innerHTML = '<p class="loading">No products found.</p>';
            return;
        }
        grid.innerHTML = html;
    }

    /**
     * Builds the HTML string for a single product card.
     * @param {object} p - Product object {id, name, rate, unit, quantity}
     * @returns {string} HTML for the product card
     */
    function buildProductCard(p) {
        return '<div class="product-card" onclick="addToCart(\'' +
            (p.id || "").toString().replace(/'/g, "\\'") + '\')">' +
            '<div class="prod-name">' + esc(p.name) + '</div>' +
            '<div class="prod-rate">₹' + (p.rate || 0).toFixed(2) + '</div>' +
            '<div class="prod-unit">per ' + esc(p.unit || "pcs") + '</div>' +
            '<div class="prod-qty">Stock: ' + (p.quantity || 0) + '</div>' +
            '</div>';
    }

    /**
     * Escapes HTML special characters to prevent XSS.
     * @param {string} s - Raw string
     * @returns {string} HTML-escaped string
     */
    function esc(s) { return String(s).replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

    // ---- Cart Operations ----

    /**
     * Adds a product to the cart by its product ID.
     * If the product is already in the cart, increments quantity.
     * @param {string} prodId - Product UUID
     */
    window.addToCart = function (prodId) {
        // Find the product in either flat or categorized data
        var prod = findProductById(prodId);
        if (!prod) return;

        var existing = cart.find(function (c) { return String(c.id) === String(prod.id); });
        if (existing) {
            existing.qty++;
        } else {
            cart.push({
                id: prod.id,
                name: prod.name,
                rate: prod.rate,
                unit: prod.unit || "pcs",
                sgst: prod.sgst || 0,
                cgst: prod.cgst || 0,
                igst: prod.igst || 0,
                hsn: prod.hsn || "",
                qty: 1
            });
        }
        renderCart();
    };

    /**
     * Finds a product by ID in either flat arrays or categorized data structures.
     * @param {string} prodId - Product UUID to find
     * @returns {object|null} The product object, or null if not found
     */
    function findProductById(prodId) {
        // Check flat product list
        if (Array.isArray(products)) {
            return products.find(function (p) { return String(p.id) === String(prodId); });
        }
        // Check categorized structure (auto or manual layout)
        if (products && products.categories) {
            var catNames = Object.keys(products.categories);
            for (var i = 0; i < catNames.length; i++) {
                var items = products.categories[catNames[i]];
                var found = items.find(function (p) { return String(p.id) === String(prodId); });
                if (found) return found;
            }
        }
        if (products && products.uncategorized) {
            return products.uncategorized.find(function (p) { return String(p.id) === String(prodId); });
        }
        return null;
    }

    /** Removes an item from the cart by index. */
    window.removeFromCart = function (index) { cart.splice(index, 1); renderCart(); };

    /**
     * Changes the quantity of a cart item by a delta value.
     * Removes the item if quantity drops to 0 or below.
     * @param {number} index - Cart item index
     * @param {number} delta - Amount to adjust quantity by (+1 or -1)
     */
    window.changeQty = function (index, delta) {
        cart[index].qty += delta;
        if (cart[index].qty <= 0) cart.splice(index, 1);
        renderCart();
    };

    /** Clears all items from the cart. */
    window.clearCart = function () { cart = []; renderCart(); };

    /**
     * Renders the cart panel with all items, totals, and checkout button state.
     */
    function renderCart() {
        var total = 0;
        var itemsEl = document.getElementById("cart-items");
        var badge = document.getElementById("cart-badge");
        var btn = document.getElementById("btn-checkout");
        var totalEl = document.getElementById("cart-total");

        if (!cart.length) {
            itemsEl.innerHTML = '<p class="empty-cart">Cart is empty</p>';
            badge.textContent = "0 items";
            btn.disabled = true;
            totalEl.textContent = "₹0.00";
            return;
        }

        itemsEl.innerHTML = cart.map(function (item, i) {
            var lineTotal = item.qty * item.rate;
            total += lineTotal;
            return '<div class="cart-item">' +
                '<div><strong>' + esc(item.name) + '</strong><br>' +
                '<small>₹' + item.rate.toFixed(2) + '/' + esc(item.unit || "pcs") + '</small></div>' +
                '<div class="ci-qty">' +
                '<button onclick="changeQty(' + i + ',-1)">-</button>' +
                '<span>' + item.qty + '</span>' +
                '<button onclick="changeQty(' + i + ',1)">+</button>' +
                '</div>' +
                '<div>₹' + lineTotal.toFixed(2) + '</div>' +
                '<button class="ci-remove" onclick="removeFromCart(' + i + ')">✕</button>' +
                '</div>';
        }).join("");

        badge.textContent = cart.length + " items";
        btn.disabled = false;
        totalEl.textContent = "₹" + total.toFixed(2);
    }

    /**
     * Filters products by search query and re-renders the grid.
     * Handles both flat and categorized product data.
     */
    window.filterProducts = function () {
        var q = (document.getElementById("product-search").value || "").trim();
        if (!q) { renderFlatProducts(products); return; }
        if (q.length < 3) return; // show all until 3+ chars typed
        // Use server-side n-gram fuzzy search (same index as main app)
        fetch("/api/search?q=" + encodeURIComponent(q))
            .then(function (r) { return r.json(); })
            .then(function (results) {
                // Map search results back to product objects by name
                var matched = [];
                results.forEach(function (r) {
                    var p = products.find(function (p) { return p.name === r.name; });
                    if (p) matched.push(p);
                });
                if (matched.length === 0) {
                    document.getElementById("product-grid").innerHTML =
                        '<p class="loading">No products match "' + esc(q) + '"</p>';
                } else {
                    renderFlatProducts(matched);
                }
            })
            .catch(function () { /* keep current view on error */ });
    };

    /** Toggles the cart panel open/closed. */
    window.toggleCart = function () {
        document.getElementById("cart-panel").classList.toggle("open");
    };

    // ---- Checkout Flow ----

    /**
     * Opens the checkout overlay.
     * If customer selector is disabled, auto-enables the confirm button.
     */
    window.checkout = function () {
        if (!cart.length) return;

        // If customer selector is disabled, enable confirm button immediately
        if (kioskConfig.includeCustomerSelector === false) {
            document.getElementById("btn-confirm").disabled = false;
            selectedCustomer = null; // anonymous sale
        }

        document.getElementById("checkout-overlay").classList.remove("hide");
        renderCheckoutSummary();
    };

    /**
     * Renders the checkout summary showing item count and subtotal.
     */
    function renderCheckoutSummary() {
        var total = cart.reduce(function (acc, item) { return acc + item.qty * item.rate; }, 0);
        document.getElementById("checkout-summary").innerHTML =
            '<div><span>Items:</span><span>' + cart.length + '</span></div>' +
            '<div><span>Subtotal:</span><span>₹' + total.toFixed(2) + '</span></div>' +
            '<div class="cs-total"><span>Total:</span><span>₹' + total.toFixed(2) + '</span></div>';
    }

    /** Closes the checkout overlay and resets customer selection. */
    window.closeCheckout = function () {
        document.getElementById("checkout-overlay").classList.add("hide");
        selectedCustomer = null;
        var custResults = document.getElementById("customer-results");
        if (custResults) custResults.innerHTML = "";
        var custSearch = document.getElementById("customer-search");
        if (custSearch) custSearch.value = "";
        document.getElementById("btn-confirm").disabled = true;
    };

    // ---- Customer Search (debounced, 300ms) ----
    var custTimer = null;
    var custSearch = document.getElementById("customer-search");
    if (custSearch) {
        custSearch.addEventListener("input", function () {
            clearTimeout(custTimer);
            var q = custSearch.value.trim();
            if (q.length < 2) {
                document.getElementById("customer-results").innerHTML = "";
                return;
            }
            custTimer = setTimeout(function () {
                fetch("/api/customers?q=" + encodeURIComponent(q))
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        var el = document.getElementById("customer-results");
                        if (!Array.isArray(data) || !data.length) {
                            el.innerHTML = '<p style="padding:8px;color:#888;">No customers found</p>';
                            return;
                        }
                        el.innerHTML = data.map(function (c) {
                            return '<div class="cust-row" onclick="selectCustomer(\'' +
                                c.id + '\',\'' + esc(c.name).replace(/'/g, "\\'") + '\')">' +
                                '<strong>' + esc(c.name) + '</strong>' +
                                (c.phones ? '<br><small>' + esc(c.phones) + '</small>' : "") +
                                '</div>';
                        }).join("");
                    });
            }, 300);
        });
    }

    /**
     * Selects a customer from the search results.
     * @param {string} id - Customer UUID
     * @param {string} name - Customer display name
     */
    window.selectCustomer = function (id, name) {
        selectedCustomer = { id: id, name: name };
        document.getElementById("customer-search").value = name;
        document.getElementById("customer-results").innerHTML = "";
        document.getElementById("btn-confirm").disabled = false;
    };

    /**
     * Confirms the sale and sends it to the server.
     * Supports both identified customer sales and anonymous walk-in sales
     * depending on the kiosk configuration.
     */
    window.confirmSale = function () {
        // Require cart items
        if (!cart.length) return;

        // Require customer selection unless customer selector is disabled
        if (kioskConfig.includeCustomerSelector !== false && !selectedCustomer) return;

        var payment = parseFloat(document.getElementById("payment-amount").value) || 0;

        fetch("/api/sale", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                customerId: selectedCustomer ? selectedCustomer.id : null,
                customerName: selectedCustomer ? selectedCustomer.name : "Walk-in Customer",
                items: cart,
                payment: payment
            })
        }).then(function (r) { return r.json(); })
          .then(function (data) {
              if (data.success) {
                  cart = [];
                  renderCart();
                  closeCheckout();
                  // Show success toast
                  var toast = document.getElementById("toast");
                  toast.classList.remove("hide");
                  setTimeout(function () { toast.classList.add("hide"); }, 2000);
              }
          }).catch(function () {});
    };

    // ---- Initialize ----
    loadConfig();
    loadProducts();
    renderCart();
})();
