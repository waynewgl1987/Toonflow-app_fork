// Final diagnostic v2: inject trace function at module level
const fs = require('fs');
let code = fs.readFileSync('data/serve/app.js', 'utf8');
const traceFile = 'data/logs/final_trace2.log';

// Inject trace helper at module level (before anything else)
code = 'var diagTrace = function(msg) { try { require("fs").appendFileSync("' + traceFile.replace(/\\/g, '\\\\') + '", Date.now() + " " + msg + "\\n"); } catch(e) {} };\n' + code;

// 1. Add trace before and after writeVersion
code = code.replace(
  'await utils_default.writeVersion();',
  `diagTrace('BEFORE_writeVersion');
  await utils_default.writeVersion();
  diagTrace('AFTER_writeVersion');`
);

// 2. Socket.IO initialization
code = code.replace(
  'const io2 = new Server(server, { cors: { origin: "*" } });',
  `diagTrace('BEFORE_SocketServer');
  const io2 = new Server(server, { cors: { origin: "*" } });
  diagTrace('AFTER_SocketServer');`
);

// 3. Socket init
code = code.replace(
  'socket_default(io2);',
  `diagTrace('BEFORE_socketInit');
  socket_default(io2);
  diagTrace('AFTER_socketInit');`
);

// 4. Express WebSocket
code = code.replace(
  '(0, import_express_ws.default)(app);',
  `diagTrace('BEFORE_expressWs');
  (0, import_express_ws.default)(app);
  diagTrace('AFTER_expressWs');`
);

// 5. Express middleware
code = code.replace(
  'app.use((0, import_morgan.default)("dev"));',
  `diagTrace('BEFORE_morgan');
  app.use((0, import_morgan.default)("dev"));
  diagTrace('AFTER_morgan');`
);

code = code.replace(
  'app.use((0, import_cors.default)({ origin: "*" }));',
  `diagTrace('BEFORE_cors');
  app.use((0, import_cors.default)({ origin: "*" }));
  diagTrace('AFTER_cors');`
);

code = code.replace(
  'app.use(import_express172.default.json({ limit: "100mb" }));',
  `diagTrace('BEFORE_jsonParser');
  app.use(import_express172.default.json({ limit: "100mb" }));
  diagTrace('AFTER_jsonParser');`
);

code = code.replace(
  'app.use(import_express172.default.urlencoded({ extended: true, limit: "100mb" }));',
  `diagTrace('BEFORE_urlencoded');
  app.use(import_express172.default.urlencoded({ extended: true, limit: "100mb" }));
  diagTrace('AFTER_urlencoded');`
);

// 6. OSS setup
code = code.replace(
  'const ossDir = utils_default.getPath("oss");',
  `diagTrace('BEFORE_ossSetup');
  const ossDir = utils_default.getPath("oss");`
);

// 7. Service route
code = code.replace(
  'app.use("/api/services", services_default);',
  `diagTrace('BEFORE_servicesRoute');
  app.use("/api/services", services_default);
  diagTrace('AFTER_servicesRoute');`
);

// 8. JWT middleware (this does first DB query)
code = code.replace(
  'app.use(async (req, res, next) => {',
  `diagTrace('BEFORE_jwtMiddleware');
  app.use(async (req, res, next) => {`
);

// 9. Router import
code = code.replace(
  'const router238 = await Promise.resolve().then(() => (init_router(), router_exports));',
  `diagTrace('BEFORE_routerImport');
  const router238 = await Promise.resolve().then(() => (init_router(), router_exports));
  diagTrace('AFTER_routerImport');`
);

// 10. Server listen
code = code.replace(
  'return await new Promise((resolve, reject) => {',
  `diagTrace('BEFORE_httpListenPromise');
  return await new Promise((resolve, reject) => {`
);

code = code.replace(
  'server.on("error", (err) => {',
  `diagTrace('BEFORE_serverOnError');
  server.on("error", (err) => {`
);

code = code.replace(
  'server.listen(port, async () => {',
  `diagTrace('BEFORE_serverListen');
  server.listen(port, async () => {`
);

code = code.replace(
  'console.log(\`[服务启动成功]: http://localhost:\${realPort} (总耗时 \${totalMs}ms)\`);',
  `diagTrace('SERVER_LISTEN_CALLBACK');
  console.log(\`[服务启动成功]: http://localhost:\${realPort} (总耗时 \${totalMs}ms)\`);`
);

fs.writeFileSync('data/serve/app_final2.js', code);
console.log('app_final2.js written');
