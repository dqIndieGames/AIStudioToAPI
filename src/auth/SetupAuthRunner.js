/**
 * File: src/auth/SetupAuthRunner.js
 * Description: Runs setup-auth in a controllable subprocess for Windows-friendly auth setup
 *
 * Author: Codex
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

class SetupAuthRunner {
    constructor(serverSystem) {
        this.serverSystem = serverSystem;
        this.logger = serverSystem.logger;
        this.process = null;
        this.state = {
            error: null,
            exitCode: null,
            finishedAt: null,
            lastAuthFile: null,
            lastAuthIndex: null,
            mode: "create",
            pid: null,
            running: false,
            startedAt: null,
            targetIndex: null,
        };
        this._continueSent = false;
    }

    _resetState() {
        this.state = {
            error: null,
            exitCode: null,
            finishedAt: null,
            lastAuthFile: null,
            lastAuthIndex: null,
            mode: "create",
            pid: null,
            running: false,
            startedAt: null,
            targetIndex: null,
        };
        this._continueSent = false;
    }

    _findLatestAuthFile() {
        const authDir = path.join(process.cwd(), "configs", "auth");
        if (!fs.existsSync(authDir)) return { file: null, index: null };
        const files = fs
            .readdirSync(authDir)
            .filter(name => /^auth-\d+\.json$/i.test(name))
            .map(name => {
                const match = name.match(/^auth-(\d+)\.json$/i);
                return { index: match ? parseInt(match[1], 10) : null, name };
            })
            .filter(item => Number.isInteger(item.index));
        if (files.length === 0) return { file: null, index: null };
        files.sort((a, b) => b.index - a.index);
        return { file: files[0].name, index: files[0].index };
    }

    start(options = {}) {
        if (this.process) {
            return { message: "setupAuthAlreadyRunning", ok: false, status: 409 };
        }

        this._resetState();

        const mode = options.mode === "relogin" ? "relogin" : "create";
        const targetIndex = Number.isInteger(options.targetIndex) ? options.targetIndex : null;
        if (mode === "relogin" && !Number.isInteger(targetIndex)) {
            return { message: "errorInvalidIndex", ok: false, status: 400 };
        }

        this.state.mode = mode;
        this.state.targetIndex = targetIndex;

        const nodePath = process.execPath;
        const scriptPath =
            mode === "relogin"
                ? path.join(process.cwd(), "scripts", "auth", "reloginAuth.js")
                : path.join(process.cwd(), "scripts", "auth", "setupAuth.js");
        const args = mode === "relogin" ? [scriptPath, String(targetIndex)] : [scriptPath];
        const env = {
            ...process.env,
            SETUP_AUTH_LANG: process.env.SETUP_AUTH_LANG || "zh",
            SETUP_AUTH_MODE: mode,
            SETUP_AUTH_TARGET_INDEX: Number.isInteger(targetIndex) ? String(targetIndex) : "",
            SystemRoot: process.env.SystemRoot || process.env.WINDIR || "C:\\Windows",
        };

        try {
            const child = spawn(nodePath, args, {
                cwd: process.cwd(),
                env,
                stdio: ["pipe", "pipe", "pipe"],
            });
            this.process = child;
            this.state.running = true;
            this.state.startedAt = Date.now();
            this.state.pid = child.pid || null;
            this._continueSent = false;

            child.stdout.on("data", data => {
                this.logger.info(`[SetupAuth] ${String(data).trim()}`);
            });
            child.stderr.on("data", data => {
                this.logger.warn(`[SetupAuth] ${String(data).trim()}`);
            });

            child.on("error", err => {
                this.state.error = err.message || String(err);
                this.logger.error(`[SetupAuth] Process error: ${this.state.error}`);
            });

            child.on("close", code => {
                this.state.running = false;
                this.state.exitCode = code;
                this.state.finishedAt = Date.now();

                if (mode === "relogin") {
                    this.state.lastAuthFile = Number.isInteger(targetIndex) ? `auth-${targetIndex}.json` : null;
                    this.state.lastAuthIndex = targetIndex;
                } else {
                    const latest = this._findLatestAuthFile();
                    this.state.lastAuthFile = latest.file;
                    this.state.lastAuthIndex = latest.index;
                }

                try {
                    this.serverSystem.authSource.reloadAuthSources();
                } catch (error) {
                    this.logger.error(`[SetupAuth] Failed to reload auth sources: ${error.message}`);
                }

                this.logger.info(`[SetupAuth] Completed with code ${code}`);
                this.process = null;
            });

            return {
                message: mode === "relogin" ? "setupAuthReloginStarted" : "setupAuthStarted",
                ok: true,
                status: 200,
            };
        } catch (error) {
            this.process = null;
            this.state.running = false;
            this.state.error = error.message || String(error);
            return {
                error: this.state.error,
                message: mode === "relogin" ? "setupAuthReloginStartFailed" : "setupAuthStartFailed",
                ok: false,
                status: 500,
            };
        }
    }

    continue() {
        if (!this.process || !this.state.running) {
            return { message: "setupAuthNotRunning", ok: false, status: 409 };
        }

        if (this.process.stdin && !this.process.stdin.destroyed) {
            try {
                this.process.stdin.write("\n");
                this._continueSent = true;
                return { message: "setupAuthContinueSent", ok: true, status: 200 };
            } catch (error) {
                return {
                    error: error.message || String(error),
                    message: "setupAuthContinueFailed",
                    ok: false,
                    status: 500,
                };
            }
        }

        return { message: "setupAuthContinueFailed", ok: false, status: 500 };
    }

    cancel() {
        if (!this.process || !this.state.running) {
            return { message: "setupAuthNotRunning", ok: false, status: 409 };
        }

        try {
            this.process.kill();
            return { message: "setupAuthCancelSuccess", ok: true, status: 200 };
        } catch (error) {
            return { error: error.message || String(error), message: "setupAuthCancelFailed", ok: false, status: 500 };
        }
    }

    getStatus() {
        return {
            ...this.state,
            continueSent: this._continueSent,
        };
    }
}

module.exports = SetupAuthRunner;
