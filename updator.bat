@echo off
echo ---Message from updator.bat---
echo Parent PID: %1
echo Installer: %2

REM Wait for parent process to fully exit (check if PID exists at all)
echo Waiting for parent process to exit...
:wait_loop
tasklist /FI "PID eq %1" 2>NUL | find "%1">NUL
if "%ERRORLEVEL%"=="0" (
    timeout /t 1 /nobreak >NUL
    goto wait_loop
)

echo Parent process closed, running installer...
%2

echo Update complete, launching app...
start "" "%HOMEDRIVE%%HOMEPATH%\AppData\Local\Programs\bbs\BBS.exe"

echo Waiting for app process to start...
:wait_for_app
tasklist /FI "IMAGENAME eq BBS.exe" 2>NUL | find "BBS.exe">NUL
if "%ERRORLEVEL%"=="1" (
    timeout /t 1 /nobreak >NUL
    goto wait_for_app
)

echo App started, sending update complete notification via protocol...
start bbs://update-complete

exit