/**
 * File: scripts/auth/reloginAuth.js
 * Description: Re-login helper for a specific auth index using Camoufox.
 */

const { firefox } = require("playwright");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const targetIndex = Number.parseInt(process.argv[2] || "", 10);
const lang = (process.env.SETUP_AUTH_LANG || "zh").trim().toLowerCase();
const getText = (zh, en) => (lang === "en" ? en : zh);

const resolveCamoufoxPath = () => {
    if (process.env.CAMOUFOX_EXECUTABLE_PATH) return process.env.CAMOUFOX_EXECUTABLE_PATH;
    if (process.platform === "win32") return path.join(PROJECT_ROOT, "camoufox", "camoufox.exe");
    if (process.platform === "linux") return path.join(PROJECT_ROOT, "camoufox-linux", "camoufox");
    if (process.platform === "darwin") {
        return path.join(PROJECT_ROOT, "camoufox-macos", "Camoufox.app", "Contents", "MacOS", "camoufox");
    }
    throw new Error(getText(`不支持的系统: ${process.platform}`, `Unsupported platform: ${process.platform}`));
};

const waitForContinue = () =>
    new Promise(resolve => {
        process.stdin.setEncoding("utf8");
        process.stdin.resume();
        process.stdin.once("data", () => resolve());
    });

const atomicWriteJson = (filePath, payload) => {
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf-8");
    fs.renameSync(tempPath, filePath);
};

const main = async () => {
    if (!Number.isInteger(targetIndex) || targetIndex < 0) {
        throw new Error(getText("无效账号索引。", "Invalid account index."));
    }

    const authPath = path.join(PROJECT_ROOT, "configs", "auth", `auth-${targetIndex}.json`);
    if (!fs.existsSync(authPath)) {
        throw new Error(getText(`认证文件不存在: ${authPath}`, `Auth file not found: ${authPath}`));
    }

    const camoufoxPath = resolveCamoufoxPath();
    if (!fs.existsSync(camoufoxPath)) {
        throw new Error(getText(`找不到 Camoufox: ${camoufoxPath}`, `Camoufox not found: ${camoufoxPath}`));
    }

    const raw = fs.readFileSync(authPath, "utf-8");
    const authData = JSON.parse(raw);

    let browser = null;
    try {
        browser = await firefox.launch({
            executablePath: camoufoxPath,
            headless: false,
        });

        const context = await browser.newContext({ storageState: authData });
        const page = await context.newPage();
        await page.goto(
            "https://aistudio.google.com/u/0/apps/bundled/blank?showPreview=true&showCode=true&showAssistant=true",
            {
                timeout: 120000,
                waitUntil: "domcontentloaded",
            }
        );

        console.log(
            getText(
                `\n[Relogin] 已打开账号 #${targetIndex}，请检查是否失效并完成登录。`,
                `\n[Relogin] Account #${targetIndex} is open. Please verify session and login if needed.`
            )
        );
        console.log(
            getText(
                "[Relogin] 完成后在页面点击“我已完成重新登录”继续。",
                "[Relogin] Click continue in Web UI after you finish."
            )
        );
        await waitForContinue();

        const updated = await context.storageState();
        authData.cookies = updated.cookies;
        authData.origins = updated.origins;

        atomicWriteJson(authPath, authData);
        console.log(getText(`[Relogin] 已更新 auth-${targetIndex}.json`, `[Relogin] Updated auth-${targetIndex}.json`));

        await context.close();
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }
    }
};

main().catch(error => {
    console.error(getText("错误:", "ERROR:"), error.message || error);
    process.exit(1);
});
