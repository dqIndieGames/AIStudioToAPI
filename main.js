/**
 * File: main.js
 * Description: Main entry file that initializes and starts the AIStudio To API proxy server system
 *
 * Author: Ellinav, iBenzene, bbbugg
 */

// Load environment variables based on NODE_ENV
const path = require("path");
const envFile = process.env.NODE_ENV === "production" ? ".env" : ".env.development";
require("dotenv").config({ path: path.resolve(__dirname, envFile) });

const ProxyServerSystem = require("./src/core/ProxyServerSystem");
const TrayLauncher = require("./src/utils/TrayLauncher");

/**
 * Initialize and start the server
 */
const initializeServer = async () => {
    // [变更] 保持早启动托盘，并注入 ready 检查时长提升可观测性
    const initialAuthIndex = parseInt(process.env.INITIAL_AUTH_INDEX, 10) || null;
    const envHost = process.env.HOST || "0.0.0.0";
    const envPort = parseInt(process.env.PORT, 10) || 7860;
    const trayReadyCheckMs = parseInt(process.env.TRAY_READY_CHECK_MS, 10) || 1800;
    const openHost = envHost === "0.0.0.0" ? "127.0.0.1" : envHost;
    const openUrl = `http://${openHost}:${envPort}/`;

    try {
        const serverSystem = new ProxyServerSystem();
        // Launch tray early so it shows up even if startup is still in progress.
        TrayLauncher.start(serverSystem.logger, {
            projectDir: __dirname,
            title: "AIStudioToAPI",
            openUrl,
            readyCheckMs: trayReadyCheckMs,
        });
        await serverSystem.start(initialAuthIndex);
    } catch (error) {
        console.error("❌ Server startup failed:", error.message);
        process.exit(1);
    }
};

// If this file is run directly, start the server
if (require.main === module) {
    initializeServer();
}

module.exports = { initializeServer, ProxyServerSystem };
