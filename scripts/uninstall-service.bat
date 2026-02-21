@echo off
cd /d "%~dp0.."
echo === Uninstall Transcriber Service ===
echo.

if not "%~1"=="" (
    echo Removing service "%~1"...
    sc stop "%~1" >nul 2>&1
    sc delete "%~1" >nul 2>&1
    echo Service uninstall complete.
    echo.
    pause
    exit /b 0
)

echo Stopping service...
sc stop "Transcriber" >nul 2>&1
sc stop "transcriber.exe" >nul 2>&1
sc stop "transcriber" >nul 2>&1

echo Removing service...
sc delete "Transcriber" >nul 2>&1
sc delete "transcriber.exe" >nul 2>&1
sc delete "transcriber" >nul 2>&1

echo Service uninstall complete.
echo.
pause
