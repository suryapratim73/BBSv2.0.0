Option Explicit
Dim sh, wmi, pid, installer, appExe, procs, waitCount, exitCode

' Ensure arguments are passed correctly
If WScript.Arguments.Count < 3 Then
    MsgBox "Updator Error: Missing required arguments.", vbCritical, "BBS Updater"
    WScript.Quit 1
End If

Set sh = CreateObject("WScript.Shell")
pid = WScript.Arguments(0)
installer = WScript.Arguments(1)
appExe = WScript.Arguments(2)

' Wait for the app to fully exit (up to 60s) so installer can replace files
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
waitCount = 0
On Error Resume Next
Do
    Set procs = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE ProcessId = " & pid)
    If Err.Number <> 0 Then Exit Do
    If procs.Count = 0 Then Exit Do
    WScript.Sleep 1000
    waitCount = waitCount + 1
    If waitCount >= 60 Then Exit Do
Loop
On Error GoTo 0

' Run the installer silently and wait until it finishes
exitCode = sh.Run("""" & installer & """ /S", 0, True)

' Relaunch the app from its installed location
sh.Run """" & appExe & """", 1, False

' Trigger update-complete protocol if install succeeded
If exitCode = 0 Then
    WScript.Sleep 10000
    sh.Run "bbs://update-complete", 0, False
End If
