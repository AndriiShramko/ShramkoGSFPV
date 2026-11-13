@echo off
rem Shramko helper for DJI controllers: the DJI RC 2's sticks for the ShramkoGSFPV page (README.md in the public
rem repository, tools/rc-bridge). Needs no administrator rights and changes nothing in Windows, except one file in the
rem pilot's own Startup folder if he answers Y to "start with Windows". Leave the window open while you fly.
setlocal
title Shramko helper for DJI controllers
cd /d "%~dp0"
set "AUTO="
if /i "%~1"=="autostart" set "AUTO=1"

rem The program: rc_bridge.py next to this file; a second download is called "rc_bridge (1).py", so the newest wins.
set "BR="
for /f "delims=" %%F in ('dir /b /o-d "rc_bridge*.py" 2^>nul') do if not defined BR set "BR=%%F"
if not defined BR goto nofile

rem Python 3.8 or newer. A clean Windows has python.exe and python3.exe stubs (App execution aliases) that only print
rem "Python was not found" and end with 9009, so "where" is not enough: each candidate is run.
set "PY="
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 3)" >nul 2>nul && set "PY=py -3"
if not defined PY python -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 3)" >nul 2>nul && set "PY=python"
if not defined PY python3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 3)" >nul 2>nul && set "PY=python3"
if not defined PY goto nopython

rem Start with Windows: offered once, never done without a Y. One small file in the pilot's own Startup folder.
set "LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Shramko DJI helper.cmd"
set "ASKED=%LOCALAPPDATA%\ShramkoGSFPV\helper-autostart-asked.txt"
if defined AUTO goto run
if exist "%LINK%" goto run
if exist "%ASKED%" goto run
echo.
echo  Start this helper by itself whenever Windows starts? It then waits quietly until the simulator needs it.
choice /c YN /t 20 /d N /m " Y = yes, N = no (no by itself in 20 seconds)"
set "ANSWER=%errorlevel%"
if not exist "%LOCALAPPDATA%\ShramkoGSFPV" mkdir "%LOCALAPPDATA%\ShramkoGSFPV"
> "%ASKED%" echo asked
if not "%ANSWER%"=="1" goto run
> "%LINK%" echo @start "Shramko helper for DJI controllers" /min "%~f0" autostart
echo  Done: it starts with Windows from now on. Keep this folder where it is.
echo  To undo: press Win+R, type shell:startup, press Enter and delete "Shramko DJI helper".

:run
echo.
if defined AUTO goto runauto
%PY% -X utf8 "%BR%" %*
goto stopped
:runauto
%PY% -X utf8 "%BR%"
:stopped
echo.
echo  The helper stopped. Press any key to close this window.
pause >nul
exit /b

:nofile
echo.
echo  rc_bridge.py is not in this folder.
echo  Download both files from the simulator (Controls, Connect my controller) into one folder,
echo  then double-click start-dji-helper.cmd again.
echo.
pause
exit /b

:nopython
echo.
echo  Python is not on this computer (or it is older than 3.8). The helper is a small Python program.
echo  Install Python once: free, no administrator rights needed.
echo    Microsoft Store: https://apps.microsoft.com/detail/9PNRBTZXMB4Z  (Python 3.13, press Get)
echo    or python.org:   https://www.python.org/downloads/windows/  (Windows installer 64-bit, Install Now)
echo  Then double-click start-dji-helper.cmd again.
echo.
choice /c YN /m " Open Python in the Microsoft Store now"
if errorlevel 2 exit /b
start "" "ms-windows-store://pdp/?ProductId=9PNRBTZXMB4Z"
exit /b
