@echo off
chcp 65001 >nul
title Toonflow - 显存模式切换 (5080 16GB)
color 0f

echo ============================================
echo   5080 16GB 显存模式切换
echo   Toonflow AI
echo ============================================
echo.
echo  [1] 启动 Qwen3 (llama.cpp)
echo     端口: 8787
echo     用途: 剧本生成 / 分镜 / Agent 对话
echo.
echo  [2] 启动 ComfyUI (绘世启动器)
echo     端口: 8188
echo     用途: 图像生成 / 视频生成
echo.
echo  [3] 停止所有 GPU 进程
echo.
echo  [Q] 退出
echo.
echo ============================================
echo  重要: 5080 16GB 一次只能运行一个！
echo  用 ComfyUI 前必须先关掉 Qwen3，反之亦然。
echo ============================================
echo.

set /p choice="请选择 [1/2/3/Q]: "

if "%choice%"=="1" (
    echo.
    echo [Qwen3] 正在检查端口 8788 是否被占用...
    netstat -ano | findstr ":8788 " >nul 2>&1
    if not errorlevel 1 (
        echo [警告] ComfyUI 似乎正在运行 (端口 8788)！
        echo 请先选择 [3] 停止所有进程，或手动关闭 ComfyUI。
        echo.
        pause
        exit /b
    )
    echo [Qwen3] 启动 Qwen3-35B-A3B...
    echo [Qwen3] 等待约 1-2 分钟加载模型...
    echo [Qwen3] 加载完成后 Toonflow 即可使用文本功能
    echo.
    start "Qwen3" cmd /c "D:\LlamaCpp\qwen3-35b_a3b_22gb_full_default_VL_Official.bat"
    timeout /t 2 >nul
    echo [Qwen3] 已启动！请等待模型加载完成后再使用 Toonflow。
    echo.
    pause
)

if "%choice%"=="2" (
    echo.
    echo [ComfyUI] 正在检查端口 8787 是否被占用...
    netstat -ano | findstr ":8787 " >nul 2>&1
    if not errorlevel 1 (
        echo [警告] Qwen3 似乎正在运行 (端口 8787)！
        echo 请先选择 [3] 停止所有进程，或手动关闭 Qwen3。
        echo.
        pause
        exit /b
    )
    echo [ComfyUI] 启动绘世启动器...
    start "" "E:\AI\ComfyAI_Video-ShortVideo\ComfyUI纯包\ComfyUI\绘世启动器.exe"
    echo [ComfyUI] 绘世启动器已启动！
    echo [ComfyUI] 请在绘世启动器中点击"一键启动"。
    echo.
    pause
)

if "%choice%"=="3" (
    echo.
    echo [停止] 正在搜索并终止 GPU 进程...
    
    :: 停止 llama-server (Qwen3)
    taskkill /f /im llama-server.exe 2>nul
    taskkill /f /im llama-cli.exe 2>nul
    
    :: 停止 ComfyUI 相关进程
    taskkill /f /im python.exe 2>nul
    taskkill /f /im python3.exe 2>nul
    
    :: 停止绘世启动器
    taskkill /f /im 绘世启动器.exe 2>nul
    taskkill /f /im A绘世启动器.exe 2>nul
    taskkill /f /im launcher.exe 2>nul
    
    echo [停止] 进程清理完成。
    echo [注意] 如果有残留进程，请手动检查任务管理器。
    echo.
    pause
)

if /i "%choice%"=="Q" (
    exit /b
)
