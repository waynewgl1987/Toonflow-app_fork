import jwt from "jsonwebtoken";
import u from "@/utils";
import { Namespace, Socket } from "socket.io";
import * as agent from "@/agents/productionAgent/index";
import ResTool from "@/socket/resTool";
import net from "net";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import http from "http";
import logger from "@/logger";

async function verifyToken(rawToken: string): Promise<Boolean> {
  const setting = await u.db("o_setting").where("key", "tokenKey").select("value").first();
  if (!setting) return false;
  const { value: tokenKey } = setting;
  if (!rawToken) return false;
  const token = rawToken.replace("Bearer ", "");
  try {
    jwt.verify(token, tokenKey as string);
    return true;
  } catch (err) {
    return false;
  }
}

// ── ComfyUI 启动辅助 ─────────────────────────────────────

/** 检查端口是否开放 */
function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.on("connect", () => { socket.destroy(); resolve(true); });
    socket.on("error", () => { socket.destroy(); resolve(false); });
    socket.on("timeout", () => { socket.destroy(); resolve(false); });
    socket.connect(port, "127.0.0.1");
  });
}

/** 检查 ComfyUI API 是否就绪（非 503） */
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

/** 发送进度消息到聊天窗口（使用正确的消息格式） */
function emitProgress(socket: Socket, msgId: string, text: string, progress?: number) {
  const content: any = {
    type: "activity",
    id: `prog_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    data: { activityType: progress ? "progress" : "info", content: text },
  };
  if (progress !== undefined) content.data.progress = progress;
  socket.emit("content:add", { messageId: msgId, content, status: "streaming" });
}

/** 确保 ComfyUI 已启动，返回 true=就绪 */
async function ensureComfyUI(socket: Socket, resTool: ResTool): Promise<boolean> {
  const port = 8188;
  const running = await checkPort(port);
  if (running) return true; // 已运行

  // 创建一条系统消息用于显示进度
  const statusMsg = resTool.newMessage("assistant", "系统");
  const msgId = statusMsg.id;

  emitProgress(socket, msgId, "🚀 ComfyUI 未运行，正在启动...");
  logger.genLog({ event: "chat_auto_start_comfyui" });

  // 启动 ComfyUI（复用 services/index.ts 的路径）
  const rootDir = "E:\\AI\\ComfyAI_Video-ShortVideo\\ComfyUI纯包\\ComfyUI";
  const pythonPath = path.join(rootDir, "python\\pythonw.exe");
  const scriptPath = path.join(rootDir, "ComfyUI\\main.py");
  const logDir = path.join(process.cwd(), "data", "logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const comfyLogPath = path.join(logDir, "comfyui_console.log");
  const logFd = fs.openSync(comfyLogPath, "a");
  fs.writeSync(logFd, `\n--- ComfyUI (chat auto-start) at ${new Date().toISOString()} ---\n`);

  const proc = spawn(pythonPath, [scriptPath, "--listen", "--port", String(port)], {
    cwd: rootDir,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  proc.unref();

  // 轮询等待端口开放（最多 3 分钟）
  const startTime = Date.now();
  const maxWait = 180000;

  emitProgress(socket, msgId, "⏳ ComfyUI 启动中（首次加载模型约 30-90 秒）...");

  while (Date.now() - startTime < maxWait) {
    await new Promise(r => setTimeout(r, 3000));
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    if (await checkPort(port)) {
      // 端口已开
      emitProgress(socket, msgId, `✅ ComfyUI 已启动（${elapsed}秒），加载模型中...`, Math.min(85, 30 + elapsed));
      
      // 等待 API 就绪
      let apiReady = false;
      for (let i = 0; i < 20; i++) {
        apiReady = await checkApiReady(port);
        if (apiReady) break;
        await new Promise(r => setTimeout(r, 3000));
        const totalElapsed = Math.round((Date.now() - startTime) / 1000);
        emitProgress(socket, msgId, `✅ ComfyUI 已启动，模型加载中...（${totalElapsed}秒）`, Math.min(90, 40 + i * 2));
      }

      if (apiReady) {
        emitProgress(socket, msgId, `✅ ComfyUI 就绪（${Math.round((Date.now() - startTime) / 1000)}秒）`, 100);
        statusMsg.complete();
        logger.genLog({ event: "chat_auto_start_comfyui_success", elapsed: Math.round((Date.now() - startTime) / 1000) });
        try { fs.closeSync(logFd); } catch {}
        return true;
      }
      continue;
    }

    // 每 15 秒更新进度
    if (elapsed % 15 === 0) {
      emitProgress(socket, msgId, `⏳ ComfyUI 启动中...（${elapsed}秒 / 180秒）`, Math.min(50, Math.round(elapsed / 180 * 50)));
    }
  }

  // 超时
  emitProgress(socket, msgId, "❌ ComfyUI 启动超时，请到控制面板查看日志", 0);
  statusMsg.error("ComfyUI 自动启动超时（3分钟），请到控制面板手动启动");
  logger.genLog({ event: "chat_auto_start_comfyui_timeout" });
  try { fs.closeSync(logFd); } catch {}
  return false;
}

// ── 主逻辑 ──────────────────────────────────────────────

export default (nsp: Namespace) => {
  nsp.on("connection", async (socket: Socket) => {
    const token = socket.handshake.auth.token;
    if (!token || !(await verifyToken(token))) {
      console.log("[productionAgent] 连接失败，token无效");
      socket.disconnect();
      return;
    }
    let isolationKey = socket.handshake.auth.isolationKey;
    if (!isolationKey) {
      console.log("[productionAgent] 连接失败，缺少 isolationKey");
      socket.disconnect();
      return;
    }

    console.log("[productionAgent] 已连接:", socket.id);

    let resTool = new ResTool(socket, {
      projectId: socket.handshake.auth.projectId,
      scriptId: socket.handshake.auth.scriptId,
    });
    let abortController: AbortController | null = null;

    const thinkConfig: agent.AgentContext["thinkConfig"] = {
      think: false,
      thinlLevel: 0,
    };

    socket.on("updateContext", (data: { isolationKey: string; projectId: number; scriptId: number }, callback) => {
      isolationKey = data.isolationKey;
      resTool = new ResTool(socket, {
        projectId: data.projectId,
        scriptId: data.scriptId,
      });
      console.log("[productionAgent] 上下文已更新:", isolationKey);
      callback?.({ success: true });
    });

    socket.on("chat", async (data: { content: string; service?: string }) => {
      let { content, service } = data;
      // 从建议按钮点击的文本中识别服务类型
      if (!service) {
        if (content.endsWith("（文本模式）")) {
          service = "text";
          content = content.replace("（文本模式）", "").trim();
        } else if (content.endsWith("（生图模式）")) {
          service = "image";
          content = content.replace("（生图模式）", "").trim();
        }
      }
      abortController?.abort();
      abortController = new AbortController();
      const currentController = abortController;

      // ── 根据 service 参数决定行为 ──
      const isImageTask = service === "image";

      // ── 步骤 1：确保 ComfyUI 在运行（生图任务强制检查，文本任务也检查） ──
      if (isImageTask) {
        // 生图任务：必须等 ComfyUI 就绪
        const comfyReady = await ensureComfyUI(socket, resTool);
        if (!comfyReady) return;
        // 简单回复后返回
        const ackMsg = resTool.newMessage("assistant", "系统");
        ackMsg.text(`✅ ComfyUI 已就绪，正在执行生图任务：${content}`);
        ackMsg.complete();
        // 添加后续建议
        ackMsg.suggestion([
          { title: "💬 文本模型", prompt: "继续（文本模式）" },
          { title: "🎨 ComfyUI 生图", prompt: "继续（生图模式）" },
        ]);
        // 前端会通过 socket.io 重新发送 chat 消息
        return;
      }

      // ── 文本任务或默认 ──
      // 不强制等 ComfyUI（文本任务不需要 ComfyUI）
      // 但如果 ComfyUI 没运行，自动在后台启动（不阻塞）
      ensureComfyUI(socket, resTool).catch(() => {});

      // ── 处理聊天消息 ──
      const msg = resTool.newMessage("assistant", "视频策划");
      const ctx: agent.AgentContext = {
        socket,
        isolationKey,
        text: content,
        userMessageTime: new Date(msg.datetime).getTime() - 1,
        abortSignal: currentController.signal,
        resTool,
        msg,
        thinkConfig,
      };

      try {
        await agent.runDecisionAI(ctx);
        // AI 回复完成后，添加后续操作建议按钮
        msg.suggestion([
          { title: "💬 文本模型", prompt: "继续（文本模式）" },
          { title: "🎨 ComfyUI 生图", prompt: "继续（生图模式）" },
          { title: "🤖 自动选择", prompt: "继续" },
        ]);
      } catch (err: any) {
        if (err.name !== "AbortError" && !currentController.signal.aborted) {
          console.error("[productionAgent] chat error:", u.error(err).message);
          msg.error(u.error(err).message);
        }
      } finally {
        if (abortController === currentController) {
          abortController = null;
        }
      }
    });

    socket.on("updateThinkConfig", (data: { think: boolean; thinlLevel: 0 | 1 | 2 | 3 }) => {
      thinkConfig.think = data.think;
      thinkConfig.thinlLevel = data.thinlLevel;
      console.log("[productionAgent] 更新思考配置:", thinkConfig);
    });

    socket.on("stop", () => {
      abortController?.abort();
      abortController = null;
    });
  });
  nsp.on("disconnect", (socket: Socket) => {
    console.log("[productionAgent] 已断开连接:", socket.id);
  });
};
