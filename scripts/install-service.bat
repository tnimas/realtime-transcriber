@echo off
cd /d "%~dp0.."
echo === Install Transcriber as Windows Service ===
echo.
echo This requires Administrator privileges.
echo.

sc query transcriber.exe >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo Service already installed. Uninstall first with scripts\uninstall.bat
    pause
    exit /b 1
)

echo Installing Windows Service...
call npx tsx scripts/install-service.ts >nul
if %ERRORLEVEL% neq 0 (
    echo ERROR: Installation failed. Make sure you are running as Administrator.
) else (
    echo Service installed and started.
)
echo.
pause
