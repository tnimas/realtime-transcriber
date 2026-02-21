@echo off
cd /d "%~dp0.."
echo === Transcriber Cleanup ===
echo.
echo This will remove local runtime files:
echo   - daemon
echo   - models
echo   - node_modules
echo   - config.json
echo.
echo Transcription logs will NOT be deleted.
echo Windows Service will NOT be modified.
echo.
set /p CONFIRM="Continue? [y/N]: "
if /i not "%CONFIRM%"=="y" (
    echo Cancelled.
    pause
    exit /b 0
)

echo.
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
echo Cleanup complete. Run scripts\setup.bat for a clean install.
echo.
pause
