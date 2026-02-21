@echo off
cd /d "%~dp0.."
echo === Install Transcriber as Windows Service ===
echo.

if exist daemon rmdir /s /q daemon >nul 2>&1

echo Installing Windows Service...
call npx tsx scripts/install-service.ts
if %ERRORLEVEL% neq 0 (
    echo ERROR: Installation failed. Run as Administrator.
    echo.
    pause
    exit /b 1
)

set "SERVICE_NAME="
sc.exe query "Transcriber" >nul 2>&1 && set "SERVICE_NAME=Transcriber"
if not defined SERVICE_NAME sc.exe query "transcriber.exe" >nul 2>&1 && set "SERVICE_NAME=transcriber.exe"
if not defined SERVICE_NAME sc.exe query "transcriber" >nul 2>&1 && set "SERVICE_NAME=transcriber"

if not defined SERVICE_NAME (
    echo ERROR: Service was not registered.
    echo Try scripts\uninstall-service.bat and run this script again.
    echo.
    pause
    exit /b 1
)

echo Service installed: "%SERVICE_NAME%"
echo.
pause
