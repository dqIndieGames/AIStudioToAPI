param(
    [int]$ServerPid = 0,
    [string]$ProjectDir = "",
    [string]$StartCmd = "",
    [string]$Title = "AIStudioToAPI",
    [string]$OpenUrl = "",
    [string]$TrayLogPath = "",
    [string]$ReadyFilePath = ""
)

$ErrorActionPreference = "Stop"

function Write-TrayLog {
    param([string]$Message)
    try {
        $line = "{0} [Tray] {1}" -f ([DateTime]::Now.ToString("yyyy-MM-dd HH:mm:ss.fff")), $Message
        Write-Host $line

        if (-not $TrayLogPath) { return }
        $dir = Split-Path -Parent $TrayLogPath
        if ($dir -and -not (Test-Path -LiteralPath $dir)) {
            New-Item -Path $dir -ItemType Directory -Force | Out-Null
        }
        Add-Content -LiteralPath $TrayLogPath -Value $line -Encoding UTF8
    } catch {}
}

function Set-TrayReady {
    param([string]$Status = "ready")
    try {
        if (-not $ReadyFilePath) { return }
        $dir = Split-Path -Parent $ReadyFilePath
        if ($dir -and -not (Test-Path -LiteralPath $dir)) {
            New-Item -Path $dir -ItemType Directory -Force | Out-Null
        }
        Set-Content -LiteralPath $ReadyFilePath -Value $Status -Encoding UTF8
    } catch {}
}

function New-TrayIcon {
    param([int]$Size = 32)
    $bitmap = $null
    $graphics = $null
    $iconHandle = [IntPtr]::Zero
    try {
        $bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

        $rect = New-Object System.Drawing.Rectangle(0, 0, $Size - 1, $Size - 1)
        $baseBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
            $rect,
            [System.Drawing.Color]::FromArgb(255, 69, 114, 255),
            [System.Drawing.Color]::FromArgb(255, 132, 63, 255),
            315
        )
        $shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(65, 8, 16, 48))
        $ringPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(220, 255, 255, 255), 2)
        $centerBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(245, 255, 255, 255))
        $accentBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 65, 229, 255))
        $highlightBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(90, 255, 255, 255))

        try {
            $graphics.FillEllipse($shadowBrush, 3, 4, $Size - 7, $Size - 7)
            $graphics.FillEllipse($baseBrush, 2, 2, $Size - 5, $Size - 5)
            $graphics.DrawEllipse($ringPen, 2, 2, $Size - 5, $Size - 5)

            $centerSize = [Math]::Floor($Size * 0.34)
            $centerX = [Math]::Floor(($Size - $centerSize) / 2)
            $centerY = [Math]::Floor(($Size - $centerSize) / 2) + 1
            $graphics.FillEllipse($centerBrush, $centerX, $centerY, $centerSize, $centerSize)

            $dotSize = [Math]::Max(3, [Math]::Floor($Size * 0.12))
            $dotX = $centerX + $centerSize - $dotSize + 1
            $dotY = $centerY + 1
            $graphics.FillEllipse($accentBrush, $dotX, $dotY, $dotSize, $dotSize)

            $graphics.FillEllipse($highlightBrush, 7, 6, [Math]::Floor($Size * 0.46), [Math]::Floor($Size * 0.24))
        } finally {
            $baseBrush.Dispose()
            $shadowBrush.Dispose()
            $ringPen.Dispose()
            $centerBrush.Dispose()
            $accentBrush.Dispose()
            $highlightBrush.Dispose()
        }

        $iconHandle = $bitmap.GetHicon()
        $rawIcon = [System.Drawing.Icon]::FromHandle($iconHandle)
        $iconClone = [System.Drawing.Icon]$rawIcon.Clone()
        $rawIcon.Dispose()
        return $iconClone
    } catch {
        return $null
    } finally {
        if ($iconHandle -ne [IntPtr]::Zero) {
            [void][Win32.NativeMethods]::DestroyIcon($iconHandle)
        }
        if ($graphics) { $graphics.Dispose() }
        if ($bitmap) { $bitmap.Dispose() }
    }
}

$notifyIcon = $null
$menu = $null
$timer = $null
$serverProcess = $null
$trayIcon = $null

try {
    $ui = [Environment]::UserInteractive
    $sessionId = -1
    $sessionName = $env:SESSIONNAME
    if (-not $sessionName) { $sessionName = "unknown" }

    $identity = "unknown"
    $hostName = "unknown"
    $explorerExists = $false
    try { $sessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId } catch {}
    try { $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name } catch {}
    try { $hostName = $Host.Name } catch {}
    try { $explorerExists = [bool](Get-Process -Name explorer -ErrorAction SilentlyContinue) } catch {}

    Write-TrayLog "bootstrap started, pid=$PID, serverPid=$ServerPid, userInteractive=$ui"
    Write-TrayLog "interactive-diagnosis: sessionId=$sessionId, sessionName=$sessionName, host=$hostName, identity=$identity, explorerExists=$explorerExists"

    if (-not $ui) {
        Write-TrayLog "exit: non-interactive session cannot show tray icon. diag(sessionId=$sessionId, sessionName=$sessionName, host=$hostName, identity=$identity, explorerExists=$explorerExists)"
        exit 2
    }

    $explorer = Get-Process -Name explorer -ErrorAction SilentlyContinue
    if (-not $explorer) {
        Write-TrayLog "exit: explorer.exe not found."
        exit 3
    }

    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition '
        [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Auto)]
        public static extern bool DestroyIcon(System.IntPtr handle);
    '

    $menu = New-Object System.Windows.Forms.ContextMenuStrip
    $openItem = New-Object System.Windows.Forms.ToolStripMenuItem
    $restartItem = New-Object System.Windows.Forms.ToolStripMenuItem
    $exitItem = New-Object System.Windows.Forms.ToolStripMenuItem
    $openItem.Text = "Open"
    $restartItem.Text = "Restart"
    $exitItem.Text = "Exit"

    [void]$menu.Items.Add($openItem)
    [void]$menu.Items.Add($restartItem)
    [void]$menu.Items.Add($exitItem)

    $notifyIcon = New-Object System.Windows.Forms.NotifyIcon
    $trayIcon = New-TrayIcon -Size 32
    if ($trayIcon) {
        $notifyIcon.Icon = $trayIcon
    } else {
        $notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
        Write-TrayLog "custom icon failed, fallback to system icon."
    }
    $notifyIcon.Text = $Title
    $notifyIcon.ContextMenuStrip = $menu
    $notifyIcon.Visible = $true
    $notifyIcon.BalloonTipTitle = $Title
    $notifyIcon.BalloonTipText = "Tray is running. Expand notification area if icon is hidden."
    $notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
    $notifyIcon.ShowBalloonTip(2500)

    Set-TrayReady "ready"
    Write-TrayLog "notify icon visible."

    if ($ServerPid -gt 0) {
        try {
            $serverProcess = [System.Diagnostics.Process]::GetProcessById($ServerPid)
        } catch {
            Write-TrayLog "server process not found at startup."
        }
    }

    $openItem.add_Click({
        if ($OpenUrl) { Start-Process -FilePath $OpenUrl | Out-Null }
    })

    $restartItem.add_Click({
        Write-TrayLog "restart clicked."
        if ($StartCmd -and (Test-Path -LiteralPath $StartCmd)) {
            Start-Process -FilePath $StartCmd -WorkingDirectory $ProjectDir | Out-Null
        } elseif ($ProjectDir) {
            $cmd = "cd /d `"$ProjectDir`" && npm run start"
            Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "start `"$Title`" cmd /k `"$cmd`"" | Out-Null
        }

        if ($ServerPid -gt 0) {
            try { Stop-Process -Id $ServerPid -Force | Out-Null } catch {}
        }

        if ($timer) { $timer.Stop() }
        if ($notifyIcon) { $notifyIcon.Visible = $false }
        Set-TrayReady "restart"
        [System.Windows.Forms.Application]::Exit()
    })

    $exitItem.add_Click({
        Write-TrayLog "exit clicked."
        if ($ServerPid -gt 0) {
            try { Stop-Process -Id $ServerPid -Force | Out-Null } catch {}
        }

        if ($timer) { $timer.Stop() }
        if ($notifyIcon) { $notifyIcon.Visible = $false }
        Set-TrayReady "exit"
        [System.Windows.Forms.Application]::Exit()
    })

    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 1000
    $timer.add_Tick({
        if ($serverProcess -and $serverProcess.HasExited) {
            Write-TrayLog "server process ended, tray exiting."
            if ($notifyIcon) { $notifyIcon.Visible = $false }
            Set-TrayReady "server-exited"
            [System.Windows.Forms.Application]::Exit()
        }
    })
    $timer.Start()

    [System.Windows.Forms.Application]::Run()
    Write-TrayLog "application loop ended."
} catch {
    Write-TrayLog ("fatal: " + $_.Exception.Message)
    Set-TrayReady "fatal"
    exit 1
} finally {
    if ($timer) { try { $timer.Stop() } catch {} }
    if ($notifyIcon) {
        try { $notifyIcon.Visible = $false } catch {}
        try { $notifyIcon.Dispose() } catch {}
    }
    if ($menu) { try { $menu.Dispose() } catch {} }
    if ($trayIcon) { try { $trayIcon.Dispose() } catch {} }
}
