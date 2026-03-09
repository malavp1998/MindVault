const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Paths
const envPath = path.resolve(__dirname, '../.env');
const bgPath = path.resolve(__dirname, 'background.js');
const popupPath = path.resolve(__dirname, 'popup.js');

// 1. Read .env file
if (!fs.existsSync(envPath)) {
    console.error('❌ .env file not found. Could not sync extension config.');
    process.exit(1);
}

const envConfig = dotenv.parse(fs.readFileSync(envPath));
const appEnv = envConfig.APP_ENV || 'local';

console.log(`\n🔄 Syncing Chrome Extension to APP_ENV = "${appEnv}"...`);

// 2. Helper to replace the toggle
function syncFileEnv(filePath, filename) {
    if (!fs.existsSync(filePath)) {
        console.warn(`⚠️ Warning: ${filename} not found.`);
        return;
    }

    let content = fs.readFileSync(filePath, 'utf8');

    // Look for: const ENV = "local"; OR const ENV = "production";
    const regex = /const ENV = "(local|production)";/;

    if (content.match(regex)) {
        content = content.replace(regex, `const ENV = "${appEnv}";`);
        fs.writeFileSync(filePath, content);
        console.log(`✅ Updated ${filename} -> ${appEnv}`);
    } else {
        console.warn(`⚠️ Warning: Could not find 'const ENV = "..."' toggle in ${filename}`);
    }
}

// 3. Process files
syncFileEnv(bgPath, 'background.js');
syncFileEnv(popupPath, 'popup.js');

console.log('✨ Extension synchronization complete.\n');
