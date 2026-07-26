@echo off
chcp 65001 >nul
title Toonflow AI

:: Force kill ALL stale node.exe processes (ensures no file handles locked)
echo [INFO] Cleaning up any stale Node.js processes...
taskkill /f /im node.exe >nul 2>&1
if errorlevel 1 (
    echo [INFO] No stale processes found
) else (
    echo [INFO] Stale processes terminated
    timeout /t 2 /nobreak >nul
)

:: Kill old process on port 10588 (if any)
echo [INFO] Checking port 10588...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":10588 " ^| findstr LISTENING') do (
    echo [INFO] Found old process on port 10588 PID=%%a, stopping...
    taskkill /f /pid %%a >nul 2>&1
)

echo ============================================
echo   Toonflow AI - One-Click Start
echo ============================================
echo.

cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Please install Node.js 23.11.1+
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [INFO] Installing dependencies...
    echo.
    where yarn >nul 2>&1
    if errorlevel 1 (
        echo [INFO] Installing yarn package manager...
        call npm install -g yarn
    )
    call yarn install --production
    if errorlevel 1 (
        echo [ERROR] Dependency installation failed
        pause
        exit /b 1
    )
) else (
    echo [INFO] Dependencies ready
)

echo.

set NODE_ENV=prod
set PORT=10588
set OSSURL=http://127.0.0.1:10588/

echo [LAUNCH] Starting Toonflow server...
echo [URL]    http://localhost:10588/
echo [PORT]   10588
echo.

:: Ensure log directory exists
if not exist "data\logs" mkdir data\logs

:: Truncate oversized app.log to prevent fs.readFileSync blocking (issue fixed in logger.ts)
if exist "data\logs\app.log" (
    for %%I in ("data\logs\app.log") do if %%~zI GTR 104857600 (
        echo [INFO] Truncating oversized app.log (%%~zI bytes ^> 100MB^)...
        break > "data\logs\app.log"
        echo [INFO] app.log truncated.
    )
)

:: Start server in background (inherits env vars), output to log files
start /b "" node --import tsx start.js > "data\logs\server_stdout.log" 2> "data\logs\server_stderr.log"

:: Wait for server to be ready (up to 120 seconds, with progress feedback)
echo [WAIT] Waiting for server to start (up to 120s)...
echo [WAIT] Checking every 3 seconds...
echo.
set WAIT_SEC=0
:WAIT_LOOP
timeout /t 3 /nobreak >nul
set /a WAIT_SEC+=3
netstat -ano 2>nul | findstr ":10588 " | findstr LISTENING >nul 2>&1
if not errorlevel 1 goto SERVER_READY
if %WAIT_SEC% geq 30 (
    echo [WAIT] Still waiting... %WAIT_SEC%s elapsed (timeout: 120s)
    echo [WAIT] Latest server output:
    echo ----------------------------------------
    type data\logs\server_stdout.log 2>nul
    echo.
    type data\logs\server_stderr.log 2>nul
    echo ----------------------------------------
    echo.
)
if %WAIT_SEC% lss 120 goto WAIT_LOOP

echo.
echo ============================================
echo  [ERROR] Server did not start within 120s
echo ============================================
echo.
echo Possible causes:
echo   1. Port 10588 is held by another process (TIME_WAIT)
echo   2. Database initialization is slow or stuck
echo   3. Missing dependencies or Node.js version mismatch
echo.
echo === Last stdout (server_stdout.log) ===
type data\logs\server_stdout.log 2>nul
echo.
echo === Last stderr (server_stderr.log) ===
type data\logs\server_stderr.log 2>nul
echo.
echo === Recent app logs ===
type data\logs\app.log 2>nul
echo.
pause
exit /b 1

:SERVER_READY
echo [WAIT] Server responded after %WAIT_SEC%s

echo [READY] Server started!
echo.
echo Default login: admin / admin123
echo URL: http://localhost:10588/
echo Dashboard: http://localhost:10588/control.html
echo.

:: Open browser
start http://localhost:10588/

echo ============================================
echo  Server is running. Close this window to stop.
echo ============================================

:: Wait for user to close
pause >nul
echo [STOP] Stopping server...
taskkill /f /im node.exe >nul 2>&1
echo [STOP] Done.
pause