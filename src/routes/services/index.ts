/**
 * 服务管理 API - 启动/停止 Qwen3 和 ComfyUI
 * 这些路由在 JWT 中间件之前注册，从 localhost 访问无需认证
 */
import { Router, Request, Response } from "express";
import { spawn, ChildProcess, execSync } from "child_process";
import path from "path";
import fs from "fs";
import net from "net";
import http from "http";
import logger from "@/logger";

const router = Router();

// ============================================================
// 配置（用户可自行修改路径）
// ============================================================
const CONFIG = {
  qwen3: {
    name: "Qwen3 (llama.cpp)",
    batPath: "D:\\LlamaCpp\\qwen3-35b_a3b_22gb_full_default_VL_Official.bat",
    port: 8787,
    processName: "llama-server.exe",
  },
  comfyui: {
    name: "ComfyUI",
    rootDir: "E:\\AI\\ComfyAI_Video-ShortVideo\\ComfyUI纯包\\ComfyUI",
    // 使用 python.exe（控制台应用），不用 pythonw.exe（GUI应用）
    // python.exe 可以通过 stdio 重定向正常捕获输出
    pythonExe: "python\\python.exe",
    mainScript: "ComfyUI\\main.py",
    port: 8188,
    processName: "python.exe",
  },
};

// 存储子进程引用
let runningProcesses: { qwen3?: ChildProcess; comfyui?: ChildProcess } = {};

// 启动状态追踪：记录每个服务的启动时间，用于显示"启动中"状态
const startingTimestamps: Record<string, number> = {};

// ============================================================
// 工具函数
// ============================================================

/** 检查端口是否被占用（通过尝试连接，比 listen 更可靠） */
function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1500);
    socket.on("connect", () => { socket.destroy(); resolve(true); });
    socket.on("error", () => { socket.destroy(); resolve(false); });
    socket.on("timeout", () => { socket.destroy(); resolve(false); });
    socket.connect(port, "127.0.0.1");
  });
}

/** 检查进程是否存活 */
function isProcessRunning(processName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const cmd = spawn("tasklist", ["/FI", `IMAGENAME eq ${processName}`, "/NH"]);
    let output = "";
    cmd.stdout.on("data", (data: Buffer) => (output += data.toString()));
    cmd.on("close", () => {
      resolve(output.includes(processName));
    });
    cmd.on("error", () => resolve(false));
  });
}

/** 杀掉指定名称的进程 */
async function killProcess(processName: string): Promise<void> {
  try {
    spawn("taskkill", ["/f", "/im", processName]);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } catch {}
}

/** 强制释放指定端口：查找占用端口的进程并 kill */
function killProcessOnPort(port: number): void {
  try {
    const pidInfo = execSync(`netstat -ano | findstr ":${port} "`).toString();
    if (pidInfo) {
      const lines = pidInfo.trim().split("\n");
      for (const line of lines) {
        const m = line.match(/(\d+)\s*$/m);
        if (m) {
          try { spawn("taskkill", ["/f", "/pid", m[1]]); } catch {}
        }
      }
    }
  } catch {}
}

/** 等待端口完全释放（不再被活动进程占用），超时返回 false */
async function waitForPortClosed(port: number, timeoutMs: number = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const output = execSync(`netstat -ano | findstr ":${port} "`, { timeout: 3000 }).toString().trim();
      if (!output) return true; // 完全没任何记录 = 已释放

      // 过滤掉 TIME_WAIT 的残留记录（PID=0，进程已死但端口未完全释放）
      // 只关心还有有效 PID 的连接
      const lines = output.split('\n').filter((l: string) => l.trim());
      let hasActiveProcess = false;
      for (const line of lines) {
        const m = line.match(/(\d+)\s*$/m);
        if (m && m[1] !== '0') { hasActiveProcess = true; break; }
      }
      if (!hasActiveProcess) return true; // 所有连接都是残留的 TIME_WAIT（PID=0）

    } catch {
      return true; // findstr 没找到匹配 = 端口已释放
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** 判断服务是否处于"启动中"状态（端口未开但 60 秒内有启动记录） */
function isStarting(key: string): boolean {
  const ts = startingTimestamps[key];
  if (!ts) return false;
  if (Date.now() - ts > 60000) { delete startingTimestamps[key]; return false; }
  return true;
}

/**
 * 后台检测 ComfyUI 启动结果（不阻塞响应）
 * 每 5 秒检查一次端口和 API 就绪状态，最多检查 3 分钟
 */
async function checkComfyuiStartResult(port: number, logPath: string): Promise<void> {
  // 在后台执行，不 await
  (async () => {
    const startTime = Date.now();
    const maxWait = 180000; // 3 分钟
    let lastLogTime = 0;

    while (Date.now() - startTime < maxWait) {
      await new Promise(r => setTimeout(r, 5000));

      // 检查端口是否开放
      const portOpen = await checkPort(port);
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      if (portOpen) {
        // 端口已开，检查 API 是否就绪
        const apiReady = await checkApiReady(port);
        if (apiReady) {
          const msg = `[ComfyUI] 启动成功！端口 ${port} 已就绪（耗时 ${elapsed} 秒）`;
          console.log(msg);
          try { fs.appendFileSync(logPath, `\n${msg}\n`); } catch {}
          logger.genLog({ event: "comfyui_start_success", port, elapsed });
        } else {
          const msg = `[ComfyUI] 端口已开，API 加载中...（${elapsed}s）`;
          if (elapsed - lastLogTime >= 15) {
            console.log(msg);
            logger.genLog({ event: "comfyui_start_loading", port, elapsed });
            lastLogTime = elapsed;
          }
        }
        return;
      }

      // 端口未开，但仍在等待
      if (elapsed % 30 === 0 || elapsed === 10) {
        const msg = `[ComfyUI] 启动中...（${elapsed}s / 180s）`;
        console.log(msg);
        logger.genLog({ event: "comfyui_start_waiting", port, elapsed });
      }
    }

    // 超时
    const msg = `[ComfyUI] 启动超时（${maxWait / 1000} 秒），请检查日志: ${logPath}`;
    console.error(msg);
    try { fs.appendFileSync(logPath, `\n${msg}\n`); } catch {}
    logger.genLog({ event: "comfyui_start_timeout", port, logPath });
  })();
}

/** 检查 API 是否就绪（非 503 即视为就绪） */
function checkApiReady(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/object_info`, { timeout: 5000 }, (res) => {
      res.resume();
      resolve(res.statusCode !== 503);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

/** 获取所有服务状态 */
async function getServicesStatus() {
  const [qwen3PortBusy, comfyPortBusy] = await Promise.all([
    checkPort(CONFIG.qwen3.port),
    checkPort(CONFIG.comfyui.port),
  ]);

  const qwen3Running = qwen3PortBusy;
  const comfyRunning = comfyPortBusy;

  return {
    qwen3: {
      running: qwen3Running,
      status: qwen3Running ? "running" : isStarting("qwen3") ? "starting" : "stopped",
      port: CONFIG.qwen3.port,
      name: CONFIG.qwen3.name,
    },
    comfyui: {
      running: comfyRunning,
      status: comfyRunning ? "running" : isStarting("comfyui") ? "starting" : "stopped",
      port: CONFIG.comfyui.port,
      name: CONFIG.comfyui.name,
    },
    note: "5080 16GB 显存一次只能运行一个服务",
  };
}

// ============================================================
// 路由
// ============================================================

/** 获取日志分析报告 */
router.get("/analysis", async (_req: Request, res: Response) => {
  try {
    const { analyze } = await import("@/utils/logAnalyzer");
    const report = analyze();
    res.json({ success: true, data: report });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/** 获取生成日志 */
router.get("/generation-log", async (_req: Request, res: Response) => {
  try {
    const logDir = path.join(process.cwd(), "data", "logs");
    const files = fs.readdirSync(logDir).filter(f => f.startsWith("generation-")).sort().reverse();
    if (files.length === 0) return res.json({ success: true, data: [] });
    const content = fs.readFileSync(path.join(logDir, files[0]), "utf-8");
    const lines = content.trim().split("\n").filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean);
    res.json({ success: true, data: lines });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/** 清空生成日志 */
router.post("/clear-log", async (_req: Request, res: Response) => {
  try {
    const logDir = path.join(process.cwd(), "data", "logs");
    const files = fs.readdirSync(logDir).filter(f => f.startsWith("generation-")).sort().reverse();
    if (files.length > 0) {
      fs.writeFileSync(path.join(logDir, files[0]), "", "utf-8");
    }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/** 获取服务状态 */
router.get("/status", async (_req: Request, res: Response) => {
  try {
    const status = await getServicesStatus();
    res.send({ success: true, data: status });
  } catch (e: any) {
    res.status(500).send({ success: false, message: e.message });
  }
});

/** 启动 Qwen3 */
router.post("/start-qwen3", async (_req: Request, res: Response) => {
  try {
    const batPath = CONFIG.qwen3.batPath;
    if (!fs.existsSync(batPath)) {
      return res
        .status(400)
        .send({ success: false, message: `Qwen3 启动脚本不存在: ${batPath}` });
    }

    // ── 启动前清理 ──────────────────────────────────────────────
    // 注意：所有 kill 操作必须用 execSync（同步），防止异步 taskkill 误杀新进程
    // 1. 停止冲突服务 ComfyUI，释放显存
    const comfyRunning = await checkPort(CONFIG.comfyui.port);
    if (comfyRunning) {
      console.log(`[服务] ComfyUI 正在运行，自动停止以释放显存`);
      try { execSync("taskkill /f /im pythonw.exe", { stdio: "ignore" }); } catch {}
      try { execSync("taskkill /f /im python.exe", { stdio: "ignore" }); } catch {}
      await new Promise(r => setTimeout(r, 2000));
    }

    // 2. 清理已存在的 llama-server.exe 进程（同步）
    try { execSync("taskkill /f /im llama-server.exe", { stdio: "ignore" }); } catch {}

    // 3. 强制释放 8787 端口（处理 TIME_WAIT / 僵尸进程）
    killProcessOnPort(CONFIG.qwen3.port);

    // 4. 等待端口完全释放
    const portFreed = await waitForPortClosed(CONFIG.qwen3.port, 30000);
    if (!portFreed) {
      return res.status(400).send({
        success: false,
        message: `端口 ${CONFIG.qwen3.port} 仍被占用，等待 30 秒后仍未释放。请手动检查是否有其他程序占用该端口。`,
      });
    }

    // 记录启动时间（用于前端显示"启动中"状态）
    startingTimestamps["qwen3"] = Date.now();

    console.log(`[Qwen3] 启动命令: cmd.exe /c start "" ${batPath}`);
    console.log(`[Qwen3] 工作目录: ${path.dirname(batPath)}`);
    logger.genLog({ event: "qwen3_start_initiated", batPath });

    const dir = path.dirname(batPath);
    const file = path.basename(batPath);
    const proc = spawn("cmd.exe", ["/c", "start", "", file], {
      cwd: dir,
      detached: true,
      stdio: "ignore",
    });
    proc.unref();
    runningProcesses.qwen3 = proc;

    res.send({
      success: true,
      message: "Qwen3 已启动，等待约 1-2 分钟加载模型...",
    });
  } catch (e: any) {
    res.status(500).send({ success: false, message: e.message });
  }
});

/** 启动 ComfyUI */
router.post("/start-comfyui", async (_req: Request, res: Response) => {
  try {
    const rootDir = CONFIG.comfyui.rootDir;
    const pythonPath = path.join(rootDir, CONFIG.comfyui.pythonExe);
    const scriptPath = path.join(rootDir, CONFIG.comfyui.mainScript);
    if (!fs.existsSync(pythonPath)) {
      return res.status(400).send({ success: false, message: `ComfyUI Python 不存在: ${pythonPath}` });
    }
    if (!fs.existsSync(scriptPath)) {
      return res.status(400).send({ success: false, message: `ComfyUI 主脚本不存在: ${scriptPath}` });
    }

    // ── 启动前清理 ──────────────────────────────────────────────
    // 注意：所有 kill 操作必须用 execSync（同步）不能用 spawn（异步），
    // 否则异步 taskkill 会在新进程启动后仍然运行，误杀新启动的 python.exe！

    // 1. 停止冲突服务 Qwen3，释放显存
    const qwen3Running = await checkPort(CONFIG.qwen3.port);
    if (qwen3Running) {
      console.log(`[服务] Qwen3 正在运行，自动停止以释放显存`);
      try { execSync("taskkill /f /im llama-server.exe", { stdio: "ignore" }); } catch {}
      await new Promise(r => setTimeout(r, 2000));
    }

    // 2. 清理已存在的 ComfyUI python 进程（同步！防止异步误杀新进程）
    try { execSync("taskkill /f /im pythonw.exe", { stdio: "ignore" }); } catch {}
    try { execSync("taskkill /f /im python.exe", { stdio: "ignore" }); } catch {}

    // 3. 强制释放 8188 端口（同步！处理 TIME_WAIT / 僵尸进程）
    killProcessOnPort(CONFIG.comfyui.port);

    // 4. 等待端口完全释放
    const portFreed = await waitForPortClosed(CONFIG.comfyui.port, 30000);
    if (!portFreed) {
      return res.status(400).send({
        success: false,
        message: `端口 ${CONFIG.comfyui.port} 仍被占用，等待 30 秒后仍未释放。请手动检查是否有其他程序占用该端口。`,
      });
    }

    // 记录启动时间（用于前端显示"启动中"状态）
    startingTimestamps["comfyui"] = Date.now();

    // ── 日志输出 ────────────────────────────────────────────────
    const logDir = path.join(process.cwd(), "data", "logs");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const comfyLogPath = path.join(logDir, "comfyui_console.log");
    const logFd = fs.openSync(comfyLogPath, "a");
    fs.writeSync(logFd, `\n--- ComfyUI start at ${new Date().toISOString()} ---\n`);

    // ── 启动 ComfyUI ────────────────────────────────────────────
    // 使用 python.exe（控制台应用）+ 直接 spawn，stdout/stderr 重定向到日志文件
    // 注意：pythonw.exe (GUI应用) 在 detached 环境下无法初始化，改用 python.exe
    console.log(`[ComfyUI] 启动: ${pythonPath} ${scriptPath} --listen --port ${CONFIG.comfyui.port}`);
    console.log(`[ComfyUI] 工作目录: ${rootDir}`);
    console.log(`[ComfyUI] 日志文件: ${comfyLogPath}`);
    logger.genLog({ event: "comfyui_spawning", port: CONFIG.comfyui.port });

    const proc = spawn(pythonPath, [scriptPath, "--listen", "--port", String(CONFIG.comfyui.port)], {
      cwd: rootDir,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    proc.unref();

    proc.on("error", (err) => {
      const msg = `[ComfyUI] 进程错误: ${err.message}`;
      console.error(msg);
      try { fs.writeSync(logFd, `\n${msg}\n`); } catch {}
      logger.genLog({ event: "comfyui_start_error", error: err.message });
    });
    proc.on("exit", (code, signal) => {
      const msg = `[ComfyUI] 进程退出 code=${code} signal=${signal}`;
      console.log(msg);
      logger.genLog({ event: "comfyui_process_exit", code, signal, pythonPath });
      try {
        fs.writeSync(logFd, `\n--- ${msg} at ${new Date().toISOString()} ---\n`);
        fs.closeSync(logFd);
      } catch {}
    });

    // 后台监测启动进度
    logger.genLog({ event: "comfyui_start_initiated", port: CONFIG.comfyui.port });
    checkComfyuiStartResult(CONFIG.comfyui.port, comfyLogPath);

    res.send({
      success: true,
      message: `ComfyUI 已在后台启动，等待 1-2 分钟加载模型...`,
    });
  } catch (e: any) {
    console.error(`[ComfyUI] 启动失败:`, e);
    res.status(500).send({ success: false, message: e.message });
  }
});

/** 扫描可用工作流文件（用于供应商配置中的文件选择） */
router.get("/workflows", async (_req: Request, res: Response) => {
  try {
    const searchDirs = [
      path.join(process.cwd(), "ComfyUI", "workflows"),
      "E:\\AI\\ComfyAI_Video-ShortVideo\\工作流",
      "E:\\AI\\ComfyAI_Video-ShortVideo\\工作流\\LTX2.3",
      "E:\\AI\\ComfyAI_Video-ShortVideo\\工作流\\Wan2.2",
      "E:\\AI\\ComfyAI_Video-ShortVideo\\工作流\\原始工作流",
    ];
    const workflows: { path: string; name: string; size: number }[] = [];
    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        workflows.push({
          path: fullPath,
          name: file,
          size: stat.size,
        });
      }
    }
    res.json({ success: true, data: workflows });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/** 停止所有服务 */
router.post("/stop-all", async (_req: Request, res: Response) => {
  try {
    // 杀掉 Qwen3 (llama-server.exe)
    try { spawn("taskkill", ["/f", "/im", "llama-server.exe"]); } catch {}
    // 杀掉 ComfyUI (pythonw.exe / python.exe)
    try { spawn("taskkill", ["/f", "/im", "pythonw.exe"]); } catch {}
    try { spawn("taskkill", ["/f", "/im", "python.exe"]); } catch {}
    // 额外强制释放 8188 端口
    try {
      const port = CONFIG.comfyui.port;
      const pidInfo = execSync(`netstat -ano | findstr ":${port} "`).toString();
      const lines = pidInfo.trim().split("\n");
      for (const line of lines) {
        const m = line.match(/(\d+)\s*$/m);
        if (m) spawn("taskkill", ["/f", "/pid", m[1]]);
      }
    } catch {}

    runningProcesses = {};
    startingTimestamps["qwen3"] = 0;
    startingTimestamps["comfyui"] = 0;
    res.send({ success: true, message: "所有服务已停止" });
  } catch (e: any) {
    res.status(500).send({ success: false, message: e.message });
  }
});

export default router;
