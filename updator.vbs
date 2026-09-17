' updator.vbs - runs the downloaded installer silently and relaunches BBS.
' Spawned by main.js (updateCommon) via wscript.exe. wscript is a GUI-only
' host, so no console window ever appears (unlike the old updator.bat).
'
' Arguments:
'   0 - PID of the app process to wait for
'   1 - full path to the downloaded installer (.exe)
'   2 - full path to the installed app executable to relaunch
Option Explicit
Dim sh, wmi, pid, installer, appExe, procs, waitCount, exitCode
Set sh = CreateObject("WScript.Shell")
pid = WScript.Arguments(0)
installer = WScript.Arguments(1)
appExe = WScript.Arguments(2)

' Wait for the app to fully exit (up to 60s) so the installer can replace
' its files without "file in use" errors.
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
waitCount = 0
On Error Resume Next
Do
    Set procs = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE ProcessId = " & pid)
    If procs.Count = 0 Then Exit Do
    WScript.Sleep 1000
    waitCount = waitCount + 1
    If waitCount >= 60 Then Exit Do
Loop
On Error GoTo 0

' Run the installer silently (/S = NSIS silent flag), window hidden,
' and wait until it finishes. Returns the installer's exit code.
exitCode = sh.Run("""" & installer & """ /S", 0, True)

' Relaunch the app from its installed location (the app has quit).
sh.Run """" & appExe & """", 1, False

' Only if the install succeeded: give the app time to boot, then fire the
' update-complete protocol so it shows the "Update Complete" notification.
If exitCode = 0 Then
    WScript.Sleep 10000
    sh.Run "bbs://update-complete", 0, False
End If
