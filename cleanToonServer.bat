@echo off
chcp 65001 >nul
title Toonflow Cleanup Tool
echo ============================================
echo   Toonflow AI - Cleanup Tool
echo ============================================
echo.

cd /d "%~dp0"

echo [1/3] Cleaning up debug log files...
if exist "data\logs" (
    del /f /q "data\logs\server_*.log"     2>nul
    del /f /q "data\logs\serve_*.log"      2>nul
    del /f /q "data\logs\diag*.log"        2>nul
    del /f /q "data\logs\final_trace*.log" 2>nul
    del /f /q "data\logs\timing*.log"      2>nul
    del /f /q "data\logs\test_*.log"       2>nul
    del /f /q "data\logs\analysis-*.log"   2>nul
    del /f /q "data\logs\analysis-test.log" 2>nul
    del /f /q "data\logs\app_test.log"     2>nul
    del /f /q "data\logs\*.txt"            2>nul
    if exist "data\logs\app.log" (
        for %%I in ("data\logs\app.log") do if %%~zI GTR 104857600 (
            break > "data\logs\app.log"
        )
    )
    echo   [OK] Done
) else (
    echo   [INFO] Logs directory not found
)

echo [2/3] Killing server process on port 10588 (PID精准杀, 不杀其他Node进程)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":10588 " ^| findstr LISTENING') do (
    taskkill /f /pid %%a >nul 2>&1
)
echo   [OK] Port 10588 freed

echo [3/3] Cleaning up profile files...
if exist "CPU.*.cpuprofile" del /f /q "CPU.*.cpuprofile" 2>nul
if exist "data\*.txt" del /f /q "data\*.txt" 2>nul
echo   [OK] Done

echo.
echo ============================================
echo   Cleanup complete!
echo   Run start-toonflow.bat to start server
echo ============================================
echo.
pause
