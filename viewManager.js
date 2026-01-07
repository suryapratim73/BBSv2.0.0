const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { app } = require('electron');

/**
 * ViewManager - Manages HTML view paths with server fallback
 * 
 * This module provides centralized view path management:
 * 1. Checks for custom views from server
 * 2. Falls back to standard template directory
 * 3. Caches server responses for performance
 */

// Cache for server-fetched views
const viewCache = new Map();
const SERVER_CHECK_TIMEOUT = 3000; // 3 seconds timeout for server requests

// Configuration
let serverConfig = {
    enabled: false,
    baseUrl: null,
    viewEndpoint: '/api/views'
};

// Base directories
const TEMPLATE_DIR = path.join(__dirname, 'template', 'html');
const CUSTOM_VIEWS_DIR = path.join(
    process.env.APP_ENV === "PROD" 
        ? app.getPath("appData") 
        : __dirname,
    'views'
);

/**
 * Initialize view manager with server configuration
 * @param {Object} config - Server configuration
 * @param {boolean} config.enabled - Whether to check server for views
 * @param {string} config.baseUrl - Base URL of the server
 * @param {string} config.viewEndpoint - Endpoint for view requests
 */
function initialize(config = {}) {
    const { appLogger } = require('./common');
    serverConfig = { ...serverConfig, ...config };
    
    // Create custom views directory if it doesn't exist
    if (!fs.existsSync(CUSTOM_VIEWS_DIR)) {
        try {
            fs.mkdirSync(CUSTOM_VIEWS_DIR, { recursive: true });
        } catch (error) {
            appLogger({ title: 'ViewManager Init Error', message: `Failed to create custom views directory: ${error.message}` });
        }
    }
    
    appLogger({ message: 'ViewManager initialized', serverEnabled: serverConfig.enabled });
}

/**
 * Get view path for a given view name
 * @param {string} viewName - Name of the view (without .html extension)
 * @param {Object} options - Additional options
 * @param {boolean} options.forceServer - Force server check even if cached
 * @param {boolean} options.fallbackOnly - Skip server check and use fallback directly
 * @returns {Promise<string>} - Path to the HTML file
 */
async function getViewPath(viewName, options = {}) {
    const { forceServer = false, fallbackOnly = false } = options;
    
    // Ensure .html extension
    const fileName = viewName.endsWith('.html') ? viewName : `${viewName}.html`;
    const viewKey = fileName.replace('.html', '');
    
    // Check cache first (unless force refresh)
    if (!forceServer && viewCache.has(viewKey)) {
        const cachedPath = viewCache.get(viewKey);
        if (fs.existsSync(cachedPath)) {
            return cachedPath;
        } else {
            viewCache.delete(viewKey);
        }
    }
    
    // Check custom views directory first
    const customViewPath = path.join(CUSTOM_VIEWS_DIR, fileName);
    if (fs.existsSync(customViewPath)) {
        viewCache.set(viewKey, customViewPath);
        return customViewPath;
    }
    
    // Check server for custom view (if enabled and not fallback-only mode)
    if (!fallbackOnly && serverConfig.enabled && serverConfig.baseUrl) {
        try {
            const serverPath = await checkServerForView(viewKey, fileName);
            if (serverPath) {
                return serverPath;
            }
        } catch (error) {
            const { appLogger } = require('./common');
            appLogger({ message: `Server check failed for view ${viewKey}: ${error.message}` });
            // Continue to fallback
        }
    }
    
    // Fallback to standard template directory
    const templatePath = path.join(TEMPLATE_DIR, fileName);
    
    if (fs.existsSync(templatePath)) {
        viewCache.set(viewKey, templatePath);
        return templatePath;
    }
    
    // View not found
    throw new Error(`View "${fileName}" not found in custom views, server, or template directory`);
}

/**
 * Check server for custom view
 * @param {string} viewKey - View identifier
 * @param {string} fileName - File name with extension
 * @returns {Promise<string|null>} - Path to downloaded view or null
 */
async function checkServerForView(viewKey, fileName) {
    const { appLogger } = require('./common');
    try {
        const url = `${serverConfig.baseUrl}${serverConfig.viewEndpoint}/${viewKey}`;
        
        const response = await axios.get(url, {
            timeout: SERVER_CHECK_TIMEOUT,
            validateStatus: (status) => status === 200 || status === 404
        });
        
        if (response.status === 404) {
            // View not available on server
            return null;
        }
        
        // Save the view content to custom views directory
        const customPath = path.join(CUSTOM_VIEWS_DIR, fileName);
        fs.writeFileSync(customPath, response.data, 'utf8');
        
        viewCache.set(viewKey, customPath);
        appLogger({ message: `Downloaded custom view from server: ${viewKey}` });
        
        return customPath;
    } catch (error) {
        if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            appLogger({ message: `Server unreachable for view ${viewKey}` });
        } else {
            appLogger({ title: 'ViewManager Error', message: `Error fetching view from server: ${error.message}` });
        }
        return null;
    }
}

/**
 * Get view path synchronously (uses cached or template directory only)
 * @param {string} viewName - Name of the view
 * @returns {string} - Path to the HTML file
 */
function getViewPathSync(viewName) {
    const fileName = viewName.endsWith('.html') ? viewName : `${viewName}.html`;
    const viewKey = fileName.replace('.html', '');
    
    // Check cache
    if (viewCache.has(viewKey)) {
        const cachedPath = viewCache.get(viewKey);
        if (fs.existsSync(cachedPath)) {
            return cachedPath;
        }
    }
    
    // Check custom views
    const customViewPath = path.join(CUSTOM_VIEWS_DIR, fileName);
    if (fs.existsSync(customViewPath)) {
        viewCache.set(viewKey, customViewPath);
        return customViewPath;
    }
    
    // Fallback to template
    const templatePath = path.join(TEMPLATE_DIR, fileName);
    if (fs.existsSync(templatePath)) {
        viewCache.set(viewKey, templatePath);
        return templatePath;
    }
    
    throw new Error(`View "${fileName}" not found`);
}

/**
 * List all available views
 * @returns {Object} - Object containing arrays of custom, template, and all views
 */
function listAvailableViews() {
    const { appLogger } = require('./common');
    const customViews = [];
    const templateViews = [];
    
    // Get custom views
    if (fs.existsSync(CUSTOM_VIEWS_DIR)) {
        try {
            const files = fs.readdirSync(CUSTOM_VIEWS_DIR);
            customViews.push(...files.filter(f => f.endsWith('.html')).map(f => f.replace('.html', '')));
        } catch (error) {
            appLogger({ title: 'ViewManager Error', message: `Error reading custom views directory: ${error.message}` });
        }
    }
    
    // Get template views
    if (fs.existsSync(TEMPLATE_DIR)) {
        try {
            const files = fs.readdirSync(TEMPLATE_DIR);
            templateViews.push(...files.filter(f => f.endsWith('.html')).map(f => f.replace('.html', '')));
        } catch (error) {
            appLogger({ title: 'ViewManager Error', message: `Error reading template directory: ${error.message}` });
        }
    }
    
    // Combine and deduplicate
    const allViews = [...new Set([...customViews, ...templateViews])];
    
    return {
        custom: customViews,
        template: templateViews,
        all: allViews
    };
}

/**
 * Clear the view cache
 * @param {string} viewName - Optional specific view to clear, or clears all if omitted
 */
function clearCache(viewName = null) {
    const { appLogger } = require('./common');
    if (viewName) {
        const viewKey = viewName.replace('.html', '');
        viewCache.delete(viewKey);
        appLogger({ message: `Cleared cache for view: ${viewKey}` });
    } else {
        viewCache.clear();
        appLogger({ message: 'Cleared all view cache' });
    }
}

/**
 * Refresh a specific view from server
 * @param {string} viewName - Name of the view to refresh
 * @returns {Promise<string>} - Path to refreshed view
 */
async function refreshView(viewName) {
    clearCache(viewName);
    return await getViewPath(viewName, { forceServer: true });
}

/**
 * Delete a custom view
 * @param {string} viewName - Name of the view to delete
 */
function deleteCustomView(viewName) {
    const { appLogger } = require('./common');
    const fileName = viewName.endsWith('.html') ? viewName : `${viewName}.html`;
    const customPath = path.join(CUSTOM_VIEWS_DIR, fileName);
    
    if (fs.existsSync(customPath)) {
        fs.unlinkSync(customPath);
        clearCache(viewName);
        appLogger({ message: `Deleted custom view: ${viewName}` });
        return true;
    }
    
    return false;
}

/**
 * Get the standard template path (for backward compatibility)
 * @param {string} viewName - Name of the view
 * @returns {string} - Relative path to template
 */
function getTemplatePath(viewName) {
    const fileName = viewName.endsWith('.html') ? viewName : `${viewName}.html`;
    return `./template/html/${fileName}`;
}

module.exports = {
    initialize,
    getViewPath,
    getViewPathSync,
    getTemplatePath,
    listAvailableViews,
    clearCache,
    refreshView,
    deleteCustomView,
    TEMPLATE_DIR,
    CUSTOM_VIEWS_DIR
};
