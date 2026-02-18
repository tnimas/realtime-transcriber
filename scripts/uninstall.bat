@echo off
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
echo Stopping and removing Windows Service...
sc stop transcriber.exe >nul 2>&1
sc delete transcriber.exe >nul 2>&1
echo Service removed.

echo Removing daemon files...
if exist "%~dp0..\daemon" rmdir /s /q "%~dp0..\daemon"

echo Removing models...
if exist "%~dp0..\models" rmdir /s /q "%~dp0..\models"

echo Removing node_modules...
if exist "%~dp0..\node_modules" rmdir /s /q "%~dp0..\node_modules"

echo Removing config.json...
if exist "%~dp0..\config.json" del "%~dp0..\config.json"

echo.
echo Uninstall complete. Run scripts\setup.bat for a clean install.
echo.
pause
