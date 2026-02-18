@echo off
cd /d "%~dp0.."
echo === Transcriber Service Uninstall ===
echo.
echo This will remove the service, models, and dependencies.
echo Transcription logs will NOT be deleted.
echo.
set /p CONFIRM="Continue? [y/N]: "
if /i not "%CONFIRM%"=="y" (
    echo Cancelled.
    pause
    exit /b 0
)

echo.
sc query transcriber.exe >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo No service found, skipping.
    goto :cleanup
)

echo Stopping Windows Service...
sc stop transcriber.exe >nul 2>&1

:wait_stop
sc query transcriber.exe 2>nul | find "STOPPED" >nul 2>&1
if %ERRORLEVEL% neq 0 (
    timeout /t 1 /nobreak >nul
    goto :wait_stop
)

echo Removing Windows Service...
sc delete transcriber.exe >nul 2>&1
echo Service removed.

:cleanup

echo Removing daemon files...
if exist daemon rmdir /s /q daemon

echo Removing models...
if exist models rmdir /s /q models

echo Removing node_modules...
if exist node_modules rmdir /s /q node_modules

echo Removing config.json...
if exist config.json del config.json

if exist node_modules (
    echo.
    echo WARNING: Some files could not be deleted. Close any running Node
    echo processes and try again, or delete node_modules manually.
)

echo.
echo Uninstall complete. Run scripts\setup.bat for a clean install.
echo.
pause
