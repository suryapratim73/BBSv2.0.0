# updator.ps1 - windowless post-download update installer (replaces updator.vbs)
#
# VBScript is no longer available by default on Windows 11 24H2+ (Microsoft
# deprecated it and moved it to Features-on-Demand), so updator.vbs silently
# failed to run there. Windows PowerShell 5.1 is built into every supported
# Windows and cannot be removed.
#
# Launched by main.js (updateCommon) as (single command string, shell:true -
# cmd.exe mediates the launch, the same shape the 2.21.x updator.bat used):
#   powershell.exe -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File updator.ps1
#                  <appPid> <installer.exe> <BBS.exe>
# Arguments are POSITIONAL (same contract as the old updator.vbs), each path
# double-quoted. Node spawns it with {shell:true, detached:true,
# windowsHide:true, stdio:'ignore'}; -WindowStyle Hidden hides the console
# window PowerShell shares with cmd.exe, so no terminal is ever visible.
#
# Flow:
#   1. Poll the Win32 process tree rooted at -AppPid (the Electron main
#      process). While the root is alive, keep re-collecting descendants so
#      children spawned during shutdown (renderers, portable python.exe,
#      print helpers, ...) are caught too. Then wait until every process we
#      ever saw has exited. Each PID is matched with its creation timestamp
#      so a recycled PID can never look like a live app process. 10-minute
#      cap; on timeout the user gets a message box - never a silent no-op.
#   2. Run the downloaded NSIS installer silently (/S) and wait for it.
#   3. Relaunch the app from its installed location. On success it is started
#      with the "bbs://update-complete" argument (main.js scans process.argv
#      for bbs:// URLs - the same mechanism updator.sh uses on Linux), on
#      failure without it.
#
# Progress and errors are appended to -LogFile (default:
# %APPDATA%\BBS\logs\updator.log).

param(
    [Parameter(Mandatory=$true, Position=0)][int]$AppPid,       # PID of the Electron main process
    [Parameter(Mandatory=$true, Position=1)][string]$Installer, # path to the downloaded NSIS installer
    [Parameter(Mandatory=$true, Position=2)][string]$AppExe,    # path to the installed app to relaunch
    [Parameter(Position=3)][string]$LogFile = (Join-Path $env:APPDATA 'BBS\logs\updator.log')
)

$ErrorActionPreference = 'SilentlyContinue'

function Write-Log([string]$msg) {
    try {
        $dir = Split-Path -Path $LogFile -Parent
        if (-not (Test-Path -Path $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
        }
        Add-Content -Path $LogFile -Encoding UTF8 -Value ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'), $msg)
    } catch { }
}

function Show-Error([string]$msg) {
    Write-Log "ERROR: $msg"
    try {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show($msg, 'BBS Updater',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
    } catch { }
    exit 1
}

# Creation timestamp of a process as a string, or $null when it isn't running.
function Get-CreationStamp([int]$pidToFind) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId = $pidToFind" -ErrorAction SilentlyContinue
    if ($p) { return $p.CreationDate.ToString('yyyy-MM-dd HH:mm:ss.fffffff') }
    return $null
}

# All PIDs in the subtree rooted at rootPid (root itself excluded).
function Get-DescendantPids([int]$rootPid) {
    $found = @()
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue($rootPid)
    while ($queue.Count -gt 0) {
        $parent = $queue.Dequeue()
        Get-CimInstance Win32_Process -Filter "ParentProcessId = $parent" -ErrorAction SilentlyContinue |
            ForEach-Object {
                if ($found -notcontains $_.ProcessId) {
                    $found += [int]$_.ProcessId
                    $queue.Enqueue([int]$_.ProcessId)
                }
            }
    }
    return ,$found
}

Write-Log "updator.ps1 started. AppPid=$AppPid Installer=$Installer AppExe=$AppExe"

if (-not (Test-Path -Path $Installer)) {
    Show-Error "BBS update cannot continue: the downloaded installer is missing:`n$Installer"
}

# --- 1. Wait for the app's whole process tree to exit -------------------------
Write-Log "Waiting for app process tree (root PID $AppPid) to exit..."
$deadline = (Get-Date).AddMinutes(10)
$seen = @{}   # pid -> creation stamp of every process spotted in the tree

# While the root is alive, keep refreshing the tree so children spawned during
# shutdown are caught as well.
while ((Get-CreationStamp $AppPid)) {
    $tree = @($AppPid) + @(Get-DescendantPids $AppPid)
    foreach ($p in $tree) {
        $stamp = Get-CreationStamp $p
        if ($stamp -and -not $seen.ContainsKey($p)) { $seen[$p] = $stamp }
    }
    Start-Sleep -Milliseconds 500
    if ((Get-Date) -ge $deadline) {
        Show-Error "BBS update cannot continue because the app is still running.`n`nClose BBS completely (Task Manager > End task on BBS.exe) and try installing the update again from Settings."
    }
}

# Root is gone - now wait for every descendant we ever saw to disappear.
$stillAlive = @()
while ((Get-Date) -lt $deadline) {
    $stillAlive = @($seen.Keys | Where-Object { (Get-CreationStamp $_) -eq $seen[$_] })
    if ($stillAlive.Count -eq 0) { break }
    Start-Sleep -Milliseconds 500
}
if ($stillAlive.Count -gt 0) {
    Write-Log "Timeout waiting for app processes to exit. Still running PIDs: $($stillAlive -join ', ')"
    Show-Error "BBS update cannot continue because the app is still running.`n`nClose BBS completely (Task Manager > End task on BBS.exe) and try installing the update again from Settings."
}
Write-Log "App process tree fully exited."

# --- 2. Run the installer silently and wait for it to finish ------------------
Write-Log "Launching installer: $Installer /S"
$inst = Start-Process -FilePath $Installer -ArgumentList '/S' -WorkingDirectory $env:TEMP -Wait -PassThru
$exitCode = $inst.ExitCode
Write-Log "Installer exited with code $exitCode"

# --- 3. Relaunch the app -------------------------------------------------------
if ($exitCode -eq 0) {
    Write-Log "Install succeeded - relaunching app with update-complete flag."
    Start-Process -FilePath $AppExe -ArgumentList 'bbs://update-complete'
} else {
    Write-Log "Install failed - relaunching app without update-complete flag."
    Start-Process -FilePath $AppExe
}
Write-Log "updator.ps1 finished."
