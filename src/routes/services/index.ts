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
    pythonExe: "python\\python.exe",
    mainScript: "ComfyUI\\main.py",
    port: 8188,
    processName: "python.exe",
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

    // 先检查 ComfyUI 是否在运行
    const comfyRunning = await checkPort(CONFIG.comfyui.port);
    if (comfyRunning) {
      return res.status(400).send({
        success: false,
        message: `ComfyUI 正在运行 (端口 ${CONFIG.comfyui.port})。请先停止 ComfyUI 再启动 Qwen3（5080 16GB 无法同时运行两者）。`,
      });
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

    // 先检查 Qwen3 是否在运行
    const qwen3Running = await checkPort(CONFIG.qwen3.port);
    if (qwen3Running) {
      return res.status(400).send({
        success: false,
        message: `Qwen3 正在运行 (端口 ${CONFIG.qwen3.port})。请先停止 Qwen3 再启动 ComfyUI（5080 16GB 无法同时运行两者）。`,
      });
    }

    // 启动 ComfyUI: python\python.exe ComfyUI\main.py --listen --port 8188
    const proc = spawn(pythonPath, [scriptPath, "--listen", "--port", String(CONFIG.comfyui.port)], {
      cwd: rootDir,
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    proc.unref();
    runningProcesses.comfyui = proc;

    res.send({
      success: true,
      message: "ComfyUI 已启动，等待初始化...",
    });
  } catch (e: any) {
    res.status(500).send({ success: false, message: e.message });
  }
});

/** 停止所有服务 */
router.post("/stop-all", async (_req: Request, res: Response) => {
  try {
    // 杀掉 Qwen3 进程
    try { spawn("taskkill", ["/f", "/im", "llama-server.exe"]); } catch {}
    // 杀掉 ComfyUI 占用的端口进程
    try {
      const port = CONFIG.comfyui.port;
      const { execSync } = await import("child_process");
      const pidInfo = execSync(`netstat -ano | findstr ":${port} "`).toString();
      const matches = pidInfo.match(/(\d+)\s*$/m);
      if (matches) {
        spawn("taskkill", ["/f", "/pid", matches[1]]);
      }
    } catch {}

    runningProcesses = {};
    res.send({ success: true, message: "所有服务已停止" });
  } catch (e: any) {
    res.status(500).send({ success: false, message: e.message });
  }
});

export default router;
