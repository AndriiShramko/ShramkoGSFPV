@echo off
rem Shramko RC bridge: the DJI RC 2's sticks for the ShramkoGSFPV page (see README.md next to this file).
rem Leave this window open while you fly; close it or press Ctrl+C to stop.
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
    py -3 -X utf8 rc_bridge.py %*
) else (
    python -X utf8 rc_bridge.py %*
)
pause
