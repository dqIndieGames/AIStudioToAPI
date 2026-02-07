/**
 * File: src/utils/TrayLauncher.js
 * Description: Windows tray launcher (restart/exit) without UI dependencies
 *
 * Author: Codex
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { TextDecoder } = require("util");

const utf8Decoder = new TextDecoder("utf-8", { fatal: false });
let gb18030Decoder = null;
try {
    gb18030Decoder = new TextDecoder("gb18030", { fatal: false });
} catch {}

function appendTrayLog(trayLogPath, message) {
    try {
        const line = `${new Date().toISOString()} [TrayLauncher] ${message}`;
        fs.appendFileSync(trayLogPath, `${line}\n`, { encoding: "utf8" });
    } catch {}
}

function decodePowerShellOutput(chunk) {
    try {
        const buffer = Buffer.from(chunk);
        const utf8Text = utf8Decoder.decode(buffer);
        if (!gb18030Decoder) {
            return utf8Text;
        }
        const gbText = gb18030Decoder.decode(buffer);
        const utf8Bad = (utf8Text.match(/�/g) || []).length;
        const gbBad = (gbText.match(/�/g) || []).length;
        return gbBad < utf8Bad ? gbText : utf8Text;
    } catch {
        return String(chunk);
    }
}

class TrayLauncher {
    static start(logger, options = {}) {
        // [变更] 增加 tray.log + tray.ready 握手，并支持 TRAY_DEBUG 观察启动过程
        const info = logger?.info ? logger.info.bind(logger) : console.log;
        const warn = logger?.warn ? logger.warn.bind(logger) : console.warn;

        if (process.platform !== "win32") {
            warn(`[Tray] Skipped: platform ${process.platform} is not win32.`);
            return null;
        }

        if (String(process.env.DISABLE_TRAY || "").toLowerCase() === "true") {
            info("[Tray] Disabled by DISABLE_TRAY=true.");
            return null;
        }

        const projectDir = options.projectDir || process.cwd();
        const trayScript = path.join(__dirname, "..", "..", "scripts", "tray", "tray.ps1");
        if (!fs.existsSync(trayScript)) {
            warn(`[Tray] Tray script not found: ${trayScript}.`);
            return null;
        }

        const logsDir = path.join(projectDir, "logs");
        const trayLogPath = path.join(logsDir, "tray.log");
        const readyFilePath = path.join(logsDir, "tray.ready");

        try {
            fs.mkdirSync(logsDir, { recursive: true });
            if (fs.existsSync(readyFilePath)) {
                fs.unlinkSync(readyFilePath);
            }
            appendTrayLog(trayLogPath, "prepare: launch requested");
        } catch (error) {
            warn(`[Tray] Failed to prepare log/ready files: ${error.message}`);
        }

        const startCmd = path.join(projectDir, "start_project.cmd");
        const debugTray = String(process.env.TRAY_DEBUG || "").toLowerCase() === "true";
        const envReadyCheckMs = parseInt(process.env.TRAY_READY_CHECK_MS, 10);
        const optReadyCheckMs = parseInt(options.readyCheckMs, 10);
        let readyCheckMs = 1800;
        if (Number.isFinite(envReadyCheckMs)) {
            readyCheckMs = Math.max(envReadyCheckMs, 500);
        } else if (Number.isFinite(optReadyCheckMs)) {
            readyCheckMs = Math.max(optReadyCheckMs, 500);
        }

        const args = [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-STA",
            "-File",
            trayScript,
            "-ServerPid",
            String(process.pid),
            "-ProjectDir",
            projectDir,
            "-StartCmd",
            startCmd,
            "-Title",
            options.title || "AIStudioToAPI",
            "-OpenUrl",
            options.openUrl || "",
            "-TrayLogPath",
            trayLogPath,
            "-ReadyFilePath",
            readyFilePath,
        ];

        try {
            const child = spawn("powershell.exe", args, {
                detached: false,
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: !debugTray,
            });

            child.stdout?.on("data", (chunk) => {
                const text = decodePowerShellOutput(chunk);
                appendTrayLog(trayLogPath, `stdout: ${text.trimEnd()}`);
                if (debugTray) {
                    process.stdout.write(text);
                }
            });

            child.stderr?.on("data", (chunk) => {
                const text = decodePowerShellOutput(chunk);
                appendTrayLog(trayLogPath, `stderr: ${text.trimEnd()}`);
                if (debugTray) {
                    process.stderr.write(text);
                }
            });

            child.on("error", (error) => {
                appendTrayLog(trayLogPath, `spawn error: ${error.message}`);
                warn(`[Tray] Failed to launch tray process: ${error.message}`);
            });

            child.on("exit", (code, signal) => {
                appendTrayLog(trayLogPath, `process exit: code=${code}, signal=${signal || "none"}`);
                if (code && code !== 0) {
                    warn(
                        `[Tray] Tray process exited early with code=${code}, signal=${signal || "none"}, log=${trayLogPath}`
                    );
                }
            });

            const readyTimer = setTimeout(() => {
                if (fs.existsSync(readyFilePath)) {
                    info(`[Tray] Ready confirmed. openUrl=${options.openUrl || ""}`);
                    return;
                }
                warn(`[Tray] Ready marker not found after ${readyCheckMs}ms. log=${trayLogPath}`);
            }, readyCheckMs);
            if (readyTimer.unref) {
                readyTimer.unref();
            }

            info(`[Tray] Launch requested. pid=${child.pid}, log=${trayLogPath}`);
            return child;
        } catch (error) {
            warn(`[Tray] Failed to launch tray: ${error.message}`);
            return null;
        }
    }
}

module.exports = TrayLauncher;
