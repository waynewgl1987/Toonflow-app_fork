/**
 * 服务管理 API - 启动/停止 Qwen3 和 ComfyUI
 * 这些路由在 JWT 中间件之前注册，从 localhost 访问无需认证
 */
import { Router, Request, Response } from "express";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import net from "net";

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
    // pythonw.exe 是无窗口版本，不产生控制台窗口
    pythonExe: "python\\pythonw.exe",
    mainScript: "ComfyUI\\main.py",
    port: 8188,
    processName: "pythonw.exe",
  },
};

// 存储子进程引用
let runningProcesses: { qwen3?: ChildProcess; comfyui?: ChildProcess } = {};

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

/** 杀掉进程 */
async function killProcess(processName: string): Promise<void> {
  try {
    spawn("taskkill", ["/f", "/im", processName]);
    // 等待进程退出
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } catch {}
}

/** 获取所有服务状态 */
async function getServicesStatus() {
  const [qwen3PortBusy, comfyPortBusy] = await Promise.all([
    checkPort(CONFIG.qwen3.port),
    checkPort(CONFIG.comfyui.port),
  ]);

  return {
    qwen3: {
      running: qwen3PortBusy,
      port: CONFIG.qwen3.port,
      name: CONFIG.qwen3.name,
    },
    comfyui: {
      running: comfyPortBusy,
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

    // 自动停止冲突服务（ComfyUI），释放显存
    const comfyRunning = await checkPort(CONFIG.comfyui.port);
    if (comfyRunning) {
      console.log(`[服务] ComfyUI 正在运行，自动停止以释放显存`);
      try { spawn("taskkill", ["/f", "/im", "pythonw.exe"]); spawn("taskkill", ["/f", "/im", "python.exe"]); } catch {}
      await new Promise(r => setTimeout(r, 2000));
    }

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

    // 自动停止冲突服务（Qwen3），释放显存
    const qwen3Running = await checkPort(CONFIG.qwen3.port);
    if (qwen3Running) {
      console.log(`[服务] Qwen3 正在运行，自动停止以释放显存`);
      try { spawn("taskkill", ["/f", "/im", "llama-server.exe"]); } catch {}
      await new Promise(r => setTimeout(r, 2000));
    }

    // 日志输出到项目 logs 目录
    const logDir = path.join(process.cwd(), "data", "logs");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const comfyLogPath = path.join(logDir, "comfyui_console.log");
    const logFd = fs.openSync(comfyLogPath, "a");
    fs.writeSync(logFd, `\n--- ComfyUI start at ${new Date().toISOString()} ---\n`);

    console.log(`[ComfyUI] 启动中: ${pythonPath} ${scriptPath} --listen --port ${CONFIG.comfyui.port}`);
    console.log(`[ComfyUI] 日志文件: ${comfyLogPath}`);

    // 启动 ComfyUI: python\python.exe ComfyUI\main.py --listen --port 8188
    const proc = spawn(pythonPath, [scriptPath, "--listen", "--port", String(CONFIG.comfyui.port)], {
      cwd: rootDir,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    proc.unref();
    runningProcesses.comfyui = proc;

    // 监听进程事件 (stdio已重定向到文件, 这里只记录进程生命周期)
    proc.on("error", (err) => {
      const msg = `[ComfyUI] 进程错误: ${err.message}`;
      console.error(msg);
      try { fs.writeSync(logFd, `\n${msg}\n`); } catch {}
    });
    proc.on("exit", (code, signal) => {
      const msg = `[ComfyUI] 进程退出 code=${code} signal=${signal}`;
      console.log(msg);
      try {
        fs.writeSync(logFd, `\n--- ${msg} at ${new Date().toISOString()} ---\n`);
        fs.closeSync(logFd);
      } catch {}
    });

    res.send({
      success: true,
      message: `ComfyUI 已启动，日志: ${comfyLogPath}`,
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
      const { execSync } = require("child_process");
      const pidInfo = execSync(`netstat -ano | findstr ":${port} "`).toString();
      const lines = pidInfo.trim().split("\n");
      for (const line of lines) {
        const m = line.match(/(\d+)\s*$/m);
        if (m) spawn("taskkill", ["/f", "/pid", m[1]]);
      }
    } catch {}

    runningProcesses = {};
    res.send({ success: true, message: "所有服务已停止" });
  } catch (e: any) {
    res.status(500).send({ success: false, message: e.message });
  }
});

export default router;
