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

echo.
echo Select ASR model:
echo   1) Parakeet v3 - Multilingual (default)
echo   2) GigaAM v2 - Russian
echo.
set /p MODEL_CHOICE="Enter choice [1]: "
if "%MODEL_CHOICE%"=="" set MODEL_CHOICE=1

if "%MODEL_CHOICE%"=="2" (
    set MODEL_NAME=gigaam
) else (
    set MODEL_NAME=parakeet
)

echo.
echo Writing config.json with model=%MODEL_NAME%...

>config.json echo {
>>config.json echo   "model": "%MODEL_NAME%",
>>config.json echo   "outputDir": "%%USERPROFILE%%\\Documents\\Transcriptions\\",
>>config.json echo   "audioDevice": null,
>>config.json echo   "sampleRate": 16000,
>>config.json echo   "vadSilenceThreshold": 800,
>>config.json echo   "vadThreshold": 0.5,
>>config.json echo   "vadModelPath": "./models/silero_vad.onnx",
>>config.json echo   "speakerModelPath": "./models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx",
>>config.json echo   "speakerThreshold": 0.4
>>config.json echo }

echo Downloading models...
call npx tsx download-models.ts --model %MODEL_NAME%

echo.
echo Setup complete!
echo.
set /p INSTALL_SVC="Install and start as Windows Service? [Y/n]: "
if /i "%INSTALL_SVC%"=="n" goto :skip_service

echo.
echo Installing Windows Service...
call npx tsx scripts/install-service.ts
if %ERRORLEVEL% neq 0 (
    echo ERROR: Service installation failed. Try running setup as Administrator.
) else (
    echo Service installed and started.
)
goto :done

:skip_service
echo.
echo To run standalone:
echo   node start.js
echo.
echo To install as Windows Service later (run as Administrator):
echo   npx tsx scripts/install-service.ts

:done
echo.
pause
