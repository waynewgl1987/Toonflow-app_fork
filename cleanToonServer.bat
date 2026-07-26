@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Toonflow Cleanup Tool
echo ============================================
echo   Toonflow AI - Cleanup &amp; Reset Tool
echo ============================================
echo.

cd /d "%~dp0"

:: ─── 1. Kill all stale Node.js processes ─────────────────────────────────
echo [1/5] Killing stale Node.js processes...
taskkill /f /im node.exe >nul 2>&1
if errorlevel 1 (
    echo   [INFO] No stale processes found
) else (
    echo   [OK] Stale processes terminated
    timeout /t 2 /nobreak >nul
)

:: ─── 2. Kill process on port 10588 ──────────────────────────────────────
echo [2/5] Freeing port 10588...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":10588 " ^| findstr LISTENING') do (
    taskkill /f /pid %%a >nul 2>&1
    echo   [OK] Process on port 10588 (PID %%a) killed
)
timeout /t 2 /nobreak >nul

:: ─── 3. Truncate oversized app.log ──────────────────────────────────────
echo [3/5] Checking log files...
if exist "data\logs\app.log" (
    for %%I in ("data\logs\app.log") do (
        echo   app.log size: %%~zI bytes
        if %%~zI GTR 10485760 (
            echo   [OK] Truncating app.log (over 10MB)...
            break > "data\logs\app.log"
        ) else (
            echo   [INFO] app.log is small, no truncation needed.
        )
    )
) else (
    echo   [INFO] app.log not found.
)

:: ─── 4. Truncate oversized generation logs ──────────────────────────────
echo [4/5] Checking generation logs...
for %%F in ("data\logs\generation-*.log") do (
    if exist "%%F" (
        for %%I in ("%%F") do (
            if %%~zI GTR 10485760 (
                echo   [OK] Truncating %%~nxF (%%~zI bytes)...
                break > "%%F"
            )
        )
    )
)

:: ─── 5. Check disk space ────────────────────────────────────────────────
echo [5/5] Checking disk space...
wmic logicaldisk where "DeviceID='%CD:~0,2%'" get Size,FreeSpace /format:csv 2>nul | findstr /v "Node" | findstr /v "^$" >nul
if not errorlevel 1 (
    for /f "tokens=2,3 delims=," %%a in ('wmic logicaldisk where "DeviceID='%CD:~0,2%'" get Size,FreeSpace /format:csv ^| findstr /v "Node" ^| findstr /v "^$"') do (
        set /a "freeGB=%%b / 1073741824"
        echo   Free space on %CD:~0,2%: approximately !freeGB! GB
    )
)

echo.
echo ============================================
echo   Cleanup complete! You can now run:
echo   start-toonflow.bat
echo ============================================
echo.
pause
