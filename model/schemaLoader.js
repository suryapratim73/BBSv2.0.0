/**
 * Schema Loader - Deserialize JSON schemas to Sequelize-compatible objects
 * Converts __FUNCTION__ placeholders back to actual DataTypes/UUIDV4
 */

/**
 * Deserialize JSON schema to Sequelize-compatible object
 * @param {string} jsonString - JSON string with __FUNCTION__ placeholders
 * @param {object} DataTypes - Sequelize DataTypes object
 * @param {function} UUIDV4 - Optional UUIDV4 function
 * @returns {object} Deserialized schema object
 */
function deserializeSchema(jsonString, DataTypes, UUIDV4) {
    const schemaObj = JSON.parse(jsonString);
    
    const deserialize = (obj) => {
        if (typeof obj === 'string') {
            // Handle UUIDV4 function
            if (obj === '__FUNCTION__:UUIDV4' && UUIDV4) {
                return UUIDV4;
            }
            // Handle DataTypes references
            if (obj.startsWith('DataTypes.')) {
                const typePath = obj.replace('DataTypes.', '').split('.');
                let result = DataTypes;
                for (const key of typePath) {
                    result = result[key];
                }
                return result;
            }
            return DataTypes[obj] || obj;
        }
        
        if (typeof obj === 'object' && obj !== null) {
            const result = {};
            for (const [key, value] of Object.entries(obj)) {
                if(key === 'version') 
                    continue; // Skip version key during deserialization
                result[key] = deserialize(value);
            }
            return result;
        }
        
        return obj;
    };
    
    return deserialize(schemaObj);
}

/**
 * Extract version string from schema object
 * Handles both string format ("2.19.17") and object format (char by char)
 * @param {object} schemaObj - Parsed schema object
 * @returns {string|null} Version string or null if not found
 */
function extractVersion(schemaObj) {
    if (!schemaObj || !schemaObj.version) {
        return null;
    }
    
    const version = schemaObj.version;
    
    // If version is already a string
    if (typeof version === 'string') {
        return version;
    }
    // If version is an object (char by char format from server)
    if (typeof version === 'object') {
        // Convert object like {"0":{"0":"2"},"1":{"0":"."},...} to "2.19.17"
        const keys = Object.keys(version).sort((a, b) => parseInt(a) - parseInt(b));
        return keys.map(key => version[key]["0"] || version[key]).join('');
    }
    
    return null;
}

module.exports = { deserializeSchema, extractVersion };
