/**
 * 自动服务管理器
 * 在 AI 调用前自动检测并启动/停止所需服务
 *
 * 修复清单：
 * - 启动锁：防止并发多次启动 ComfyUI（避免窗口闪烁）
 * - 503 不杀进程：ComfyUI 启动时 /object_info 返回 503 是"模型加载中"的正常状态
 * - 服务相位追踪：知道服务处于 stopped/starting/ready 哪个阶段
 * - 去掉了对运行中任务的 /interrupt（ComfyUI 自己会排队）
 */
import { spawn, execSync } from "child_process";
import path from "path";
import fs from "fs";
import net from "net";
import http from "http";
import logger from "@/logger";

const SERVICES = {
  qwen3: {
    port: 8787,
    name: "Qwen3 (llama.cpp)",
    start: async () => {
      const batPath = "D:\\LlamaCpp\\qwen3-35b_a3b_22gb_full_default_VL_Official.bat";
      if (!fs.existsSync(batPath)) throw new Error(`Qwen3 启动脚本不存在: ${batPath}`);
      const dir = path.dirname(batPath);
      const file = path.basename(batPath);
      const proc = spawn("cmd.exe", ["/c", "start", "", file], { cwd: dir, detached: true, stdio: "ignore" });
      proc.unref();
    },
    stop: async () => {
      try { execSync("taskkill /f /im llama-server.exe", { stdio: "ignore" }); } catch {}
    },
  },
  comfyui: {
    port: 8188,
    name: "ComfyUI",
    start: async () => {
      const rootDir = "E:\\AI\\ComfyAI_Video-ShortVideo\\ComfyUI纯包\\ComfyUI";
      const pythonExe = path.join(rootDir, "python\\pythonw.exe");
      const mainScript = path.join(rootDir, "ComfyUI\\main.py");
      if (!fs.existsSync(pythonExe)) throw new Error(`ComfyUI Python 不存在: ${pythonExe}`);
      if (!fs.existsSync(mainScript)) throw new Error(`ComfyUI 主脚本不存在: ${mainScript}`);
      const logDir = path.join(process.cwd(), "data", "logs");
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      const comfyLogPath = path.join(logDir, "comfyui_console.log");
      const logFd = fs.openSync(comfyLogPath, "a");
      fs.writeSync(logFd, `\n--- ComfyUI (auto) start at ${new Date().toISOString()} ---\n`);

      // 使用 pythonw.exe（GUI 子系统应用），不会创建控制台窗口
      // 配合 detached:true 隔离进程组，关闭 ComfyUI 时不影响 Toonflow 主进程
      // 不要用 python.exe（控制台应用），spawn 时会弹出 CMD 窗口再隐藏导致闪烁
      const proc = spawn(pythonExe, [mainScript, "--listen", "--port", "8188"], {
        cwd: rootDir,
        detached: true,
        stdio: ["ignore", logFd, logFd],
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      });
      proc.on("error", (err) => {
        const msg = `[ComfyUI] 进程错误: ${err.message}`;
        console.error(msg);
        try { fs.writeSync(logFd, `\n${msg}\n`); } catch {}
        logger.genLog({ event: "comfyui_process_error", error: err.message });
      });
      proc.on("exit", (code, signal) => {
        const msg = `[ComfyUI] 进程退出 code=${code} signal=${signal}`;
        console.log(msg);
        logger.genLog({ event: "comfyui_process_exit", code, signal });
        try {
          fs.writeSync(logFd, `\n--- ${msg} at ${new Date().toISOString()} ---\n`);
          fs.closeSync(logFd);
        } catch {}
      });
      proc.unref();
    },
    stop: async () => {
      try {
        // 必须加 | findstr LISTENING，只杀监听该端口的服务进程
        // 否则会误杀有 WebSocket 连接到 ComfyUI 的 Node.js 进程自身
        const pidInfo = execSync(`netstat -ano | findstr ":8188 " | findstr LISTENING`).toString();
        if (pidInfo) {
          const lines = pidInfo.trim().split("\n");
          for (const line of lines) {
            const m = line.match(/(\d+)\s*$/m);
            if (m) execSync(`taskkill /f /pid ${m[1]}`, { stdio: "ignore" });
          }
        }
      } catch (e) {
        console.warn("[ComfyUI] 停止进程失败:", (e as Error).message);
      }
    },
  },
};

// ── 启动锁 ──────────────────────────────────────────────
// 防止并发多次启动同一个服务（多个生成任务同时调用 ensureService 时）
const startLocks: Record<string, Promise<void> | null> = {};

/** 串行化启动：同时只有一个启动流程在执行 */
async function lockedStart(key: string, fn: () => Promise<void>): Promise<void> {
  if (!startLocks[key]) {
    startLocks[key] = (async () => {
      try {
        await fn();
      } finally {
        startLocks[key] = null;
      }
    })();
  }
  await startLocks[key];
}

// ── 端口检测 ────────────────────────────────────────────

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

async function waitForPort(port: number, timeoutMs: number = 120000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const busy = await checkPort(port);
    if (busy) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

/** 检查 API 是否就绪：非 503 即视为已就绪 */
function checkApiReady(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/object_info`, { timeout: 5000 }, (res) => {
      res.resume();
      // 503 = 模型仍在加载, 其他状态码视为就绪
      resolve(res.statusCode !== 503);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

/** 等待 API 就绪（模型加载完毕），超时返回 false */
async function waitForApi(port: number, timeoutMs: number = 300000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await checkApiReady(port);
    if (ready) return true;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

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

function checkComfyQueue(port: number): Promise<{ running: number; queued: number }> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/queue`, { timeout: 15000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          const q = JSON.parse(data);
          const runningArr = q.queue_running ?? q.running ?? [];
          const queuedObj = q.queue_pending ?? q.queued ?? {};
          resolve({
            running: Array.isArray(runningArr) ? runningArr.length : (typeof runningArr === "number" ? runningArr : 0),
            queued: typeof queuedObj === "number" ? queuedObj : (Array.isArray(queuedObj) ? queuedObj.length : Object.keys(queuedObj).length),
          });
        } catch {
          resolve({ running: -1, queued: -1 });
        }
      });
    });
    req.on("error", () => resolve({ running: -1, queued: -1 }));
    req.on("timeout", () => { req.destroy(); resolve({ running: -1, queued: -1 }); });
  });
}

// ── 服务识别和冲突管理 ──────────────────────────────────

function getRequiredService(fnName: string, vendorId: string): "qwen3" | "comfyui" | null {
  if ((fnName === "textRequest" || fnName === "text") && vendorId === "openai") return "qwen3";
  if ((fnName === "imageRequest" || fnName === "videoRequest" || fnName === "ttsRequest") && vendorId === "comfyui") return "comfyui";
  return null;
}

async function stopConflict(target: "qwen3" | "comfyui"): Promise<void> {
  const other = target === "qwen3" ? SERVICES.comfyui : SERVICES.qwen3;
  const otherBusy = await checkPort(other.port);
  if (otherBusy) {
    logger.genLog({ event: "svc_auto_stop_conflict", service: other.name, port: other.port });
    await other.stop();
    for (let i = 0; i < 30; i++) {
      const stillBusy = await checkPort(other.port);
      if (!stillBusy) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

// ── ComfyUI 连续失败计数 ───────────────────────────────

const comfyFailCount: { count: number; lastTime: number } = { count: 0, lastTime: 0 };

export function recordComfyFailure(): boolean {
  comfyFailCount.count++;
  comfyFailCount.lastTime = Date.now();
  if (comfyFailCount.count >= 2) {
    comfyFailCount.count = 0;
    return true;
  }
  return false;
}

export function resetComfyFailure(): void {
  comfyFailCount.count = 0;
}

// ── 核心：ensureService ────────────────────────────────

/**
 * 确保 AI 调用所需的服务已启动并就绪
 *
 * 流程：
 *   1. 端口未开 → 启动服务（串行化锁）→ 等端口 → 等 API 就绪
 *   2. 端口已开 + API 就绪 → 直接返回（就绪状态）
 *   3. 端口已开 + 503    → 模型正在加载，等 API 就绪（不杀进程！）
 */
export async function ensureService(fnName: string, vendorId: string): Promise<boolean> {
  const required = getRequiredService(fnName, vendorId);
  if (!required) return true;

  const svc = SERVICES[required];

  // ── 安全守卫：ComfyUI 运行时禁止启动 Qwen3 ──
  // 防止任何代码路径意外启动 Qwen3 导致 ComfyUI 被杀
  if (required === "qwen3") {
    const comfyRunning = await checkPort(SERVICES.comfyui.port);
    if (comfyRunning) {
      logger.genLog({ event: "svc_guard_block_qwen3", reason: "ComfyUI 正在运行，禁止启动 Qwen3 以避免冲突" });
      throw new Error(
        "ComfyUI 正在运行，无法启动本地 Qwen3。\n" +
        "视频生产页面应使用云端 DeepSeek 模型进行文本处理。\n" +
        "如需使用本地 Qwen3，请先停止 ComfyUI。"
      );
    }
  }

  // ── 第 1 步：检查端口 ──
  let portOpen = await checkPort(svc.port);

  // ── 第 1.5 步：连续失败重启 ──
  if (required === "comfyui" && comfyFailCount.count >= 2 && !portOpen) {
    // 只有端口不在用的时候才触发重启
    // （如果端口开着但有故障，下面的 503 流程会处理）
    logger.genLog({ event: "svc_auto_restart_via_failcount", service: svc.name, port: svc.port, count: comfyFailCount.count });
    comfyFailCount.count = 0;
    await svc.stop();
    portOpen = false;
  }

  // ── 第 2 步：端口已开 → 检查 API 就绪 ──
  if (portOpen) {
    // 即使当前服务已在运行，也要确保另一个冲突服务已停止（释放 VRAM）
    const other = required === "comfyui" ? SERVICES.qwen3 : SERVICES.comfyui;
    const otherBusy = await checkPort(other.port);
    if (otherBusy) {
      logger.genLog({ event: "svc_auto_stop_conflict", service: other.name, port: other.port, reason: `${svc.name} 已运行，停止冲突服务释放显存` });
      await other.stop();
      // 等待端口释放
      for (let i = 0; i < 30; i++) {
        const stillBusy = await checkPort(other.port);
        if (!stillBusy) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    const apiReady = await checkApiReady(svc.port);
    if (apiReady) {
      // 服务完全就绪
      if (required === "comfyui") {
        const queue = await checkComfyQueue(svc.port);
        if (queue.running > 0 || queue.queued > 0) {
          logger.genLog({ event: "svc_auto_queue_active", service: svc.name, port: svc.port, queue });
        }
      }
      logger.genLog({ event: "svc_auto_ready", service: svc.name, port: svc.port });
      return true;
    }

    // 端口开但 API 返回 503（或无响应）
    // → 模型正在加载中，不要杀它，进入下面的等待流程
    logger.genLog({ event: "svc_auto_waiting_api", service: svc.name, port: svc.port,
      detail: "端口已开但服务未就绪（模型加载中），等待 API 就绪…" });

    const apiReady2 = await waitForApi(svc.port, 300000);
    if (!apiReady2) {
      logger.genLog({ event: "svc_auto_api_timeout", service: svc.name, port: svc.port });
      throw new Error(
        `服务 ${svc.name} 模型加载超时（5分钟）。\n` +
        `可能原因：\n` +
        `1. 显存不足，请关闭其他 GPU 应用后重试\n` +
        `2. 模型文件损坏或配置错误\n` +
        `3. 如果反复出现，请手动启动 ${svc.name} 查看具体错误`
      );
    }
    logger.genLog({ event: "svc_auto_api_ready", service: svc.name, port: svc.port });
    return true;
  }

  // ── 第 3 步：端口未开 → 启动服务 ──
  logger.genLog({ event: "svc_auto_start", service: svc.name, port: svc.port });

  // 使用启动锁防止并发多次启动
  await lockedStart(required, async () => {
    // 启动前先停冲突服务
    await stopConflict(required);
    await new Promise((r) => setTimeout(r, 2000));

    // 再次检查端口（可能在等待锁的过程中已被其他协程启动）
    const alreadyOpen = await checkPort(svc.port);
    if (alreadyOpen) {
      logger.genLog({ event: "svc_auto_already_started", service: svc.name, port: svc.port });
      return;
    }

    await svc.start();
    const portReady = await waitForPort(svc.port, 180000);
    if (!portReady) {
      throw new Error(`服务 ${svc.name} (端口 ${svc.port}) 启动超时（180秒），请手动检查服务状态`);
    }
    logger.genLog({ event: "svc_auto_started", service: svc.name, port: svc.port });
  });

  // ── 第 4 步：等待 API 就绪（模型加载） ──
  const apiReady = await waitForApi(svc.port, 300000);
  if (!apiReady) {
    logger.genLog({ event: "svc_auto_api_timeout", service: svc.name, port: svc.port });
    throw new Error(
      `服务 ${svc.name} 模型加载超时（5分钟）。\n` +
      `可能原因：\n` +
      `1. 显存不足，请关闭其他 GPU 应用后重试\n` +
      `2. 模型文件损坏或配置错误\n` +
      `3. 如果反复出现，请手动启动 ${svc.name} 查看具体错误`
    );
  }

  logger.genLog({ event: "svc_auto_api_ready", service: svc.name, port: svc.port });
  return true;
}

/** 停止指定服务（清理用） */
export async function stopService(required: "qwen3" | "comfyui"): Promise<void> {
  await SERVICES[required].stop();
}

/** 获取服务当前运行状态 */
export async function getServiceStatus(): Promise<Record<string, { running: boolean; port: number; name: string }>> {
  const [qwen3Busy, comfyBusy] = await Promise.all([
    checkPort(SERVICES.qwen3.port),
    checkPort(SERVICES.comfyui.port),
  ]);
  return {
    qwen3: { running: qwen3Busy, port: SERVICES.qwen3.port, name: SERVICES.qwen3.name },
    comfyui: { running: comfyBusy, port: SERVICES.comfyui.port, name: SERVICES.comfyui.name },
  };
}
