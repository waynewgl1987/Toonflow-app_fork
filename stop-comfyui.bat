@echo off
chcp 65001 >nul
title Stop ComfyUI Service
echo ============================================
echo   ComfyUI - Service Stopper
echo ============================================
echo.

cd /d "%~dp0"

echo [1/2] Finding ComfyUI process on port 8188...
set PID=
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8188 " ^| findstr LISTENING') do (
    set PID=%%a
)
if defined PID (
    echo   Found PID=%PID%, terminating...
    taskkill /f /pid %PID% >nul 2>&1
    if errorlevel 1 (
        echo   [WARN] Failed to kill PID %PID%
    ) else (
        echo   [OK] Process on port 8188 terminated
    )
) else (
    echo   [INFO] No process listening on port 8188
)

:: Also kill any process bound to 8188 (including TIME_WAIT remnants)
echo.
echo [2/2] Cleaning up lingering connections on port 8188...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8188 "') do (
    for /f %%b in ("%%a") do (
        if not "%%b"=="" (
            taskkill /f /pid %%b >nul 2>&1
        )
    )
)
echo   [OK] Done

echo.
echo ============================================
echo   ComfyUI service stopped.
echo ============================================
echo.
pause
