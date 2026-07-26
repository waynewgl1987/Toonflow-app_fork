/**
 * 自动服务管理器
 * 在 AI 调用前自动检测并启动/停止所需服务
 */
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import net from "net";
import http from "http";
import logger from "@/logger";

const SERVICES = {
  qwen3: {
    port: 8787,
    name: "Qwen3 (llama.cpp)",
    // 启动方式：执行 bat 文件
    start: async () => {
      const batPath = "D:\\LlamaCpp\\qwen3-35b_a3b_22gb_full_default_VL_Official.bat";
      if (!fs.existsSync(batPath)) throw new Error(`Qwen3 启动脚本不存在: ${batPath}`);
      const dir = path.dirname(batPath);
      const file = path.basename(batPath);
      const proc = spawn("cmd.exe", ["/c", "start", "", file], { cwd: dir, detached: true, stdio: "ignore" });
      proc.unref();
    },
    stop: async () => {
      try { spawn("taskkill", ["/f", "/im", "llama-server.exe"]); } catch {}
    },
  },
  comfyui: {
    port: 8188,
    name: "ComfyUI",
    start: async () => {
      const rootDir = "E:\\AI\\ComfyAI_Video-ShortVideo\\ComfyUI纯包\\ComfyUI";
      const pythonExe = path.join(rootDir, "python\\python.exe");
      const mainScript = path.join(rootDir, "ComfyUI\\main.py");
      if (!fs.existsSync(pythonExe)) throw new Error(`ComfyUI Python 不存在: ${pythonExe}`);
      if (!fs.existsSync(mainScript)) throw new Error(`ComfyUI 主脚本不存在: ${mainScript}`);
      const logFile = path.join(rootDir, "comfyui_console.log");
      const logFd = fs.openSync(logFile, "a");
      const proc = spawn(pythonExe, [mainScript, "--listen", "--port", "8188"], {
        cwd: rootDir,
        detached: true,
        stdio: ["ignore", logFd, logFd],
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      });
      proc.unref();
    },
    stop: async () => {
      try {
        const pidInfo = require("child_process").execSync(`netstat -ano | findstr ":8188 "`).toString();
        if (pidInfo) {
          const lines = pidInfo.Trim().Split("\n");
          for (const line of lines) {
            const m = line.match(/(\d+)\s*$/m);
            if (m) spawn("taskkill", ["/f", "/pid", m[1]]);
          }
        }
      } catch {}
    },
  },
};

/** 检查端口是否被占用（通过连接检测，更可靠） */
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

/** 等待端口被占用（服务启动完成），超时返回 false */
async function waitForPort(port: number, timeoutMs: number = 120000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const busy = await checkPort(port);
    if (busy) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

/** 检查 API 是否真正就绪（模型已加载完毕），非 503 即视为就绪 */
function checkApiReady(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/v1/models`, { timeout: 5000 }, (res) => {
      res.resume();
      // 503 = 模型仍在加载, 其他状态码（含 200/401 等）视为就绪
      resolve(res.statusCode !== 503);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

/** 等待 API 真正就绪（模型加载完毕），超时返回 false */
async function waitForApi(port: number, timeoutMs: number = 300000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await checkApiReady(port);
    if (ready) return true;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

/** 根据 fnName 判断需要哪个服务 */
function getRequiredService(fnName: string, vendorId: string): "qwen3" | "comfyui" | null {
  if ((fnName === "textRequest" || fnName === "text") && vendorId === "openai") return "qwen3";
  if ((fnName === "imageRequest" || fnName === "videoRequest" || fnName === "ttsRequest") && vendorId === "comfyui") return "comfyui";
  return null;
}

/** 停止另一个冲突的服务 */
async function stopConflict(target: "qwen3" | "comfyui"): Promise<void> {
  const other = target === "qwen3" ? SERVICES.comfyui : SERVICES.qwen3;
  const otherBusy = await checkPort(other.port);
  if (otherBusy) {
    logger.genLog({ event: "svc_auto_stop_conflict", service: other.name, port: other.port });
    await other.stop();
    // 等待端口释放
    for (let i = 0; i < 30; i++) {
      const stillBusy = await checkPort(other.port);
      if (!stillBusy) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

/**
 * 确保 AI 调用所需的服务已启动
 * @param fnName 函数名 (textRequest/imageRequest/videoRequest/ttsRequest)
 * @param vendorId 供应商 ID (openai/comfyui)
 * @returns 是否成功
 */
/** 等待端口释放，超时返回 false */
async function waitForPortClosed(port: number, timeoutMs: number = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const busy = await checkPort(port);
    if (!busy) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

export async function ensureService(fnName: string, vendorId: string): Promise<boolean> {
  const required = getRequiredService(fnName, vendorId);
  if (!required) return true; // 不需要特殊管理

  const svc = SERVICES[required];
  let portOpen = await checkPort(svc.port);

  if (portOpen) {
    const apiReady = await checkApiReady(svc.port);
    if (apiReady) return true; // 端口开 + API 就绪 → 正常运行

    // 端口开但 API 返回 503 → 进程僵死（显存不足/模型加载卡住）
    // 强杀后走下面的正常启动流程
    logger.genLog({ event: "svc_auto_zombie_kill", service: svc.name, port: svc.port });
    await svc.stop();
    const portFreed = await waitForPortClosed(svc.port, 30000);
    if (!portFreed) {
      logger.genLog({ event: "svc_auto_zombie_kill_failed", service: svc.name, port: svc.port });
      throw new Error(`服务 ${svc.name} 进程无法停止（端口 ${svc.port} 一直被占用），请手动结束 llama-server.exe 后重试`);
    }
    portOpen = false; // 标记为已停止，走启动流程
  }

  if (!portOpen) {
    logger.genLog({ event: "svc_auto_start", service: svc.name, port: svc.port });
    // 停止冲突服务（如 ComfyUI），释放 VRAM
    await stopConflict(required);
    // 额外等待 2 秒确保 VRAM 彻底释放
    await new Promise((r) => setTimeout(r, 2000));
    // 启动服务
    await svc.start();
    const portReady = await waitForPort(svc.port, 120000);
    if (!portReady) {
      logger.genLog({ event: "svc_auto_timeout", service: svc.name, port: svc.port });
      throw new Error(`服务 ${svc.name} (端口 ${svc.port}) 启动超时，请手动检查服务状态`);
    }
    logger.genLog({ event: "svc_auto_started", service: svc.name, port: svc.port });
  }

  // 等待 API 真正就绪（模型加载完毕），最多等 5 分钟
  const apiReady = await waitForApi(svc.port, 300000);
  if (!apiReady) {
    logger.genLog({ event: "svc_auto_api_timeout", service: svc.name, port: svc.port });
    throw new Error(
      `服务 ${svc.name} 模型加载超时（5分钟）。\n` +
      `可能原因：\n` +
      `1. 显存不足：模型 Qwen3.6-35B-A3B-Q4_K_M 约需 12-14GB 显存，请关闭其他 GPU 应用（如 ComfyUI、浏览器 GPU 加速）后重试\n` +
      `2. 模型文件损坏或路径错误，请检查 D:\\AIModels\\lmstudio-community\\ 下的 GGUF 文件\n` +
      `3. 如果反复出现，请手动启动 "${SERVICES.qwen3.name}" 的 bat 文件查看具体错误`
    );
  }

  logger.genLog({ event: "svc_auto_api_ready", service: svc.name, port: svc.port });
  return true;
}

/**
 * 停止指定服务（清理用）
 */
export async function stopService(required: "qwen3" | "comfyui"): Promise<void> {
  await SERVICES[required].stop();
}
