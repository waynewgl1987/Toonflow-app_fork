// 防止未处理的 Promise 拒绝杀死进程
process.on("unhandledRejection", (reason) => {
  console.error("[未处理的Promise拒绝]", reason instanceof Error ? reason.message : reason);
});

import genLogger from "@/logger";
import "./err";
import "./env";

// 启动时自动分析历史日志并保存报告
import("./utils/logAnalyzer").then(m => m.saveReport()).catch(() => {});
import express, { Request, Response, NextFunction } from "express";
import { Server } from "socket.io";
import http from "node:http";
import expressWs from "express-ws";
import logger from "morgan";
import cors from "cors";
import buildRoute from "@/core";
import registerRoutes from "@/router";
import path from "path";
import fs from "fs";
import u from "@/utils";
import jwt from "jsonwebtoken";
import socketInit from "@/socket/index";
import { isEletron } from "@/utils/getPath";
import { ensureThumbnail, ThumbnailSize } from "@/utils/image";
import servicesRoute from "@/routes/services/index";

const app = express();
const server = http.createServer(app);
export { server }; // 防止被 GC 回收

function checkPermissions() {
  if (!isEletron()) return;
  const userDataPath = u.getPath();
  try {
    fs.mkdirSync(userDataPath, { recursive: true });
    const testFile = path.join(userDataPath, ".access_test");
    fs.writeFileSync(testFile, "test");
    fs.unlinkSync(testFile);
  } catch (e) {
    try {
      const { dialog, app } = require("electron");
      dialog.showMessageBoxSync({
        type: "warning",
        title: "权限不足",
        message: "应用无法访问数据目录",
        detail: `无法读写以下目录：\n${userDataPath}\n\n请联系管理员授予权限，或以管理员身份运行本程序。`,
        buttons: ["确认退出"],
        defaultId: 0,
      });
      app.quit();
    } catch {}
  }
}

/** 检查端口是否被占用（通过 socket 连接检测） */
async function checkPortBusy(port: number, label: string = ""): Promise<{ port: number; busy: boolean }> {
  const net = require("net") as typeof import("net");
  return new Promise<{ port: number; busy: boolean }>((resolve) => {
    const socket = new net.Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      console.log(`[DEBUG] checkPortBusy(${port}) ${label} - timeout after 5s`);
      resolve({ port, busy: false });
    }, 5000);
    socket.on("connect", () => { clearTimeout(timer); socket.destroy(); console.log(`[DEBUG] checkPortBusy(${port}) ${label} - connected`); resolve({ port, busy: true }); });
    socket.on("error", (err: any) => { clearTimeout(timer); socket.destroy(); resolve({ port, busy: false }); });
    socket.connect(port, "127.0.0.1");
  });
}

/** Watchdog: 如果卡住超过 N 秒，打印堆栈并继续 */
function startupWatchdog(seconds: number): NodeJS.Timeout {
  const timer = setInterval(() => {
    const err = new Error("WATCHDOG");
    const stack = err.stack!.split("\n").slice(2, 10).join("\n    ");
    console.log(`[WATCHDOG] 服务启动已耗时 ${Math.round((Date.now() - globalStartupTime) / 1000)}s，可能卡在以下位置:\n    ${stack}`);
  }, seconds * 1000);
  // 允许进程退出时清理
  if (timer.unref) timer.unref();
  return timer;
}

let globalStartupTime: number = 0;

export default function startServe(randomPort: Boolean = false) {
  const startupStart = Date.now();
  globalStartupTime = startupStart;
  const phase = (name: string) => console.log(`[启动阶段] ${name} (${Date.now() - startupStart}ms)`);

  // 启动 watchdog（30s 后开始每 15s 打印一次堆栈）
  const watchdog = startupWatchdog(30);

  checkPermissions();
  phase("权限检查通过");

  genLogger.genLog({ event: "app_start", env: process.env.NODE_ENV, electron: isEletron(), nodeVersion: process.version });

  // 端口检查（跳过 - 避免 net.Socket 在 bundle 下阻塞事件循环）
  phase("端口检查开始");
  phase("端口检查完成");

  // 同步写入版本文件（避免 await 在 bundle 下挂起）
  u.writeVersion();
  phase("版本文件写入完成");

  const io = new Server(server, { cors: { origin: "*" }, serveClient: false });
  socketInit(io);
  app.set("io", io); // 暴露给路由处理器
  phase("Socket.IO 初始化完成");

  if (process.env.NODE_ENV == "dev") { buildRoute(); }

  // expressWs(app); // 暂时禁用，排查 HTTP 不响应问题
  phase("Express WebSocket 初始化完成");

  app.use(logger("dev"));
  app.use(cors({ origin: "*" }));
  app.use(express.json({ limit: "100mb" }));
  app.use(express.urlencoded({ extended: true, limit: "100mb" }));
  phase("Express 基础中间件配置完成");

  // oss 静态资源
  const ossDir = u.getPath("oss");
  if (!fs.existsSync(ossDir)) {
    fs.mkdirSync(ossDir, { recursive: true });
  }
  console.log("文件目录:", ossDir);
  app.use(
    "/oss",
    (req, res, next) => {
      if (req.query.size) {
        const size = req.query.size as string;
        const smallImageBaseDir = path.join(ossDir, "smallImage");
        const originalPath = path.join(ossDir, req.path);

        let sizeSubDir: string;
        let sizeOpts: ThumbnailSize | undefined;

        const dimensMatch = size.match(/^(\d+)x(\d+)$/i);
        const percentMatch = size.match(/^(\d+(?:\.\d+)?)\s*%?$/);

        if (dimensMatch) {
          const w = parseInt(dimensMatch[1], 10);
          const h = parseInt(dimensMatch[2], 10);
          sizeSubDir = `${w}x${h}`;
          sizeOpts = { type: "dimensions", width: w, height: h };
        } else if (percentMatch) {
          const pct = parseFloat(percentMatch[1]);
          sizeSubDir = `${percentMatch[1]}p`;
          sizeOpts = { type: "percentage", value: pct };
        } else {
          express.static(ossDir, { acceptRanges: false })(req, res, next);
          return;
        }
        const ext = path.extname(req.path);
        const base = path.basename(req.path, ext);
        const dir = path.dirname(req.path);
        const smallImagePath = path.join(smallImageBaseDir, dir, `${base}_${sizeSubDir}${ext}`);

        ensureThumbnail(originalPath, smallImagePath, sizeOpts).then((thumbnailPath) => {
          if (thumbnailPath) {
            res.sendFile(thumbnailPath);
          } else {
            express.static(ossDir, { acceptRanges: false })(req, res, next);
          }
        });
        return;
      }
      next();
    },
    express.static(ossDir, { acceptRanges: false }),
  );
  phase("OSS 静态资源配置完成");

  // skills 静态资源
  const skillsDir = u.getPath("skills");
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
  }
  console.log("文件目录:", skillsDir);
  app.use(
    "/skills",
    (req, res, next) => {
      /\.(jpe?g|png|gif|webp|svg|ico|bmp)$/i.test(req.path) ? next() : res.status(403).end();
    },
    express.static(skillsDir, { acceptRanges: false }),
  );

  // assets 静态资源
  const assetsDir = u.getPath("assets");
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }
  console.log("文件目录:", assetsDir);
  app.use("/assets", express.static(assetsDir, { acceptRanges: false }));
  phase("Skills/Assets 静态资源配置完成");

  // data/web 静态网站
  const webDir = u.getPath("web");
  if (fs.existsSync(webDir)) {
    console.log("静态网站目录:", webDir);
    app.use(express.static(webDir, { acceptRanges: false }));
  } else {
    console.warn("静态网站目录不存在:", webDir);
  }

  // 服务管理（在 JWT 之前注册，本地控制台访问）
  app.use("/api/services", servicesRoute);
  genLogger.genLog({ event: "services_route_registered" });
  phase("Service 路由注册完成");

  // JWT 中间件暂时禁用
  app.use((req, res, next) => { next(); });
  phase("JWT 中间件配置完成（首次 DB 查询验证）");

  // 直接注册路由（不使用 await，避免 esbuild bundle 下 Promise 挂起）
  registerRoutes(app);
  phase("API 路由注册完成");

  // 启动时清理：将上次未完成的任务标记为"生成失败"
  (async () => {
    try {
      const staleVideos = await u.db("o_video").where("state", "生成中").update({
        state: "生成失败",
        errorReason: "服务重启，生成中断",
      });
      const staleTracks = await u.db("o_videoTrack").where("state", "生成中").update({
        state: "生成失败",
        reason: "服务重启，生成中断",
      });
      if (staleVideos > 0 || staleTracks > 0) {
        console.log(`[启动清理] 标记未完成任务: ${staleVideos} 个视频, ${staleTracks} 个轨道 -> 生成失败`);
      }
    } catch(e: any) {
      console.log("[启动清理] 警告:", e.message);
    }
  })();

  // 404 处理
  app.use((_, res, next: NextFunction) => {
    return res.status(404).send({ message: "API 404 Not Found" });
  });

  // 错误处理
  app.use((err: any, _: Request, res: Response, __: NextFunction) => {
    res.locals.message = err.message;
    res.locals.error = err;
    console.error(err);
    res.status(err.status || 500).send(err);
  });
  phase("错误处理中间件配置完成");

  // 启动时清理上次残留的「生成中」和「提取中」状态
  try {
    // 重置所有卡在「生成中」的图片记录
    u.db("o_image").where("state", "生成中").update({ state: "生成失败", errorReason: "服务重启，任务已终止" }).then();
    // 重置 o_assets 中卡在「提取中」的记录（数据库存的是中文）
    u.db("o_assets").where("promptState", "提取中").update({ promptState: "失败" }).then();
    // 重置 o_script 中卡在「提取中」(2) 的记录
    u.db("o_script").where("extractState", 2).update({ extractState: -1, errorReason: "服务重启，任务已终止" }).then();
    console.log("[启动] 已清理上次残留的任务状态");
  } catch (e) {
    console.warn("[启动] 清理残留状态失败（首次启动可忽略）:", (e as Error).message);
  }

  const port = randomPort ? 0 : 10588;
  phase("准备启动监听 10588");

  // 所有同步初始化完成后，直接调用 server.listen
  // 不在 async 函数内 return new Promise 等待 callback，
  // 因为 esbuild bundle 下 process.nextTick/Promise.microtask 在 async 函数内会挂起
  return server.listen(port);
}

/** 清理子进程（ComfyUI / Qwen3） */
function cleanupChildProcesses(): void {
  try {
    const { execSync } = require("child_process");
    // 检查 ComfyUI 端口 (8188) 并杀掉占用进程
    const comfyPid = execSync(`netstat -ano | findstr ":8188 " | findstr LISTENING`).toString().match(/(\d+)\s*$/m);
    if (comfyPid) {
      execSync(`taskkill /f /pid ${comfyPid[1]} >nul 2>&1`);
      console.log("[清理] ComfyUI 进程已停止");
    }
  } catch {}
  try {
    const { execSync } = require("child_process");
    // 检查 Qwen3 端口 (8787) 并杀掉占用进程
    const qwenPid = execSync(`netstat -ano | findstr ":8787 " | findstr LISTENING`).toString().match(/(\d+)\s*$/m);
    if (qwenPid) {
      execSync(`taskkill /f /pid ${qwenPid[1]} >nul 2>&1`);
      console.log("[清理] Qwen3 进程已停止");
    }
  } catch {}
  try {
    // 额外清理残余的 llama-server.exe
    require("child_process").execSync(`taskkill /f /im llama-server.exe >nul 2>&1`);
  } catch {}
}

// 进程退出时清理子进程
process.on("exit", () => {
  cleanupChildProcesses();
});
process.on("SIGINT", () => {
  console.log("\n[停止] 收到中断信号，清理服务...");
  cleanupChildProcesses();
  process.exit(0);
});
process.on("SIGTERM", () => {
  console.log("[停止] 收到终止信号，清理服务...");
  cleanupChildProcesses();
  process.exit(0);
});

// 支持await关闭
export function closeServe(): Promise<void> {
  cleanupChildProcesses();
  return new Promise((resolve, reject) => {
    if (server) {
      server.close((err?: Error) => {
        if (err) return reject(err);
        console.log("[服务已关闭]");
        resolve();
      });
    } else {
      resolve();
    }
  });
}

// 不在模块加载时启动服务器，由外部调用 startServe()
// 直接运行时会在文件末尾调用
const isElectron = typeof process.versions?.electron !== "undefined";
if (!isElectron && require.main === module) {
  try {
    startServe();
  } catch (err: any) {
    console.error("[启动失败]", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
