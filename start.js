/**
 * Toonflow 启动入口 - 加载各个模块并启动服务器
 * 绕过 esbuild 打包存在的 event loop 兼容性问题
 */
process.env.NODE_ENV = process.env.NODE_ENV || "prod";
process.env.PORT = process.env.PORT || "10588";
process.env.OSSURL = process.env.OSSURL || "http://127.0.0.1:" + process.env.PORT + "/";

// 加载核心模块
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const logger = require("morgan");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");

// 加载项目模块（触发 side-effect 初始化）
require("./src/logger.ts");
require("./src/err.ts");
require("./src/env.ts");

const u = require("./src/utils.ts").default;
const buildRoute = require("./src/core.ts").default;
const registerRoutes = require("./src/router.ts").default;
const socketInit = require("./src/socket/index.ts").default;
const servicesRoute = require("./src/routes/services/index.ts").default;
const { isEletron } = require("./src/utils/getPath.ts");
const { ensureThumbnail } = require("./src/utils/image.ts");
const genLogger = require("./src/logger.ts").default;

// 启动服务器
const app = express();
const server = http.createServer(app);

function startServe() {
  const startupStart = Date.now();
  const phase = (name) => console.log(`[启动阶段] ${name} (${Date.now() - startupStart}ms)`);

  const io = new Server(server, { cors: { origin: "*" }, serveClient: false });
  socketInit(io);
  phase("Socket.IO 初始化完成");

  if (process.env.NODE_ENV == "dev") { buildRoute(); }
  phase("路由构建完成");

  // Express 中间件
  app.use(logger("dev"));
  app.use(cors({ origin: "*" }));
  app.use(express.json({ limit: "100mb" }));
  app.use(express.urlencoded({ extended: true, limit: "100mb" }));
  phase("中间件配置完成");

  // 静态资源
  const ossDir = u.getPath("oss");
  if (!fs.existsSync(ossDir)) fs.mkdirSync(ossDir, { recursive: true });
  app.use("/oss", express.static(ossDir, { acceptRanges: false }));

  const skillsDir = u.getPath("skills");
  if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });
  app.use("/skills", express.static(skillsDir, { acceptRanges: false }));

  const assetsDir = u.getPath("assets");
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
  app.use("/assets", express.static(assetsDir, { acceptRanges: false }));
  phase("静态资源配置完成");

  const webDir = u.getPath("web");
  if (fs.existsSync(webDir)) {
    console.log("静态网站目录:", webDir);
    app.use(express.static(webDir, { acceptRanges: false }));
  }

  app.use("/api/services", servicesRoute);
  phase("Service 路由注册完成");

  // JWT（暂时禁用）
  app.use((req, res, next) => { next(); });

  registerRoutes(app);
  phase("API 路由注册完成");

  app.use((_, res) => res.status(404).send({ message: "API 404 Not Found" }));
  app.use((err, _, res, __) => { console.error(err); res.status(err.status || 500).send(err); });

  server.listen(parseInt(process.env.PORT) || 10588, () => {
    console.log(`[启动完成] 服务已启动: http://localhost:${process.env.PORT || 10588}/`);
  });
}

startServe();
