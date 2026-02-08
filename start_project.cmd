@echo off
setlocal EnableExtensions
set "PROJECT_DIR=%~dp0"
set "LOG_DIR=%PROJECT_DIR%logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

set "SERVER_LOG=%LOG_DIR%\server.log"
set "RUN_TITLE=AIStudioToAPI"

if /i "%~1"=="debug" (
	rem [调试] debug 模式：开新窗口运行且日志输出到实时窗口命令台，同时输出到文件日志
	start "%RUN_TITLE%-Debug" cmd /k "cd /d %~dp0 && set TRAY_DEBUG=true && set TRAY_READY_CHECK_MS=3000 && echo [INFO] TRAY_DEBUG=true && echo [INFO] tray log: %~dp0logs\tray.log && npm run start"
) else (
	rem [修改点] 普通模式也开启 TRAY_DEBUG，托盘日志会出现在弹出的 CMD
	start "%RUN_TITLE%" cmd /k "cd /d %~dp0 && set TRAY_DEBUG=true && echo [INFO] TRAY_DEBUG=true && echo [INFO] tray log: %~dp0logs\tray.log && npm run start"
)

endlocal
