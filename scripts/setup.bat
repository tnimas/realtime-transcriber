@echo off
echo === Transcriber Service Setup ===

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js not found. Install from https://nodejs.org/
    pause
    exit /b 1
)

echo Installing dependencies...
call npm install

echo Downloading models...
call npx tsx scripts/download-models.ts

echo.
echo Setup complete! To run standalone:
echo   npx tsx src/index.ts
echo.
echo To install as Windows Service (run as Administrator):
echo   npx tsx scripts/install-service.ts
echo.
pause
