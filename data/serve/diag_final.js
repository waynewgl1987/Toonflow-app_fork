// Final diagnostic: trace all startup phases after writeVersion using file sync writes
const fs = require('fs');
let code = fs.readFileSync('data/serve/app.js', 'utf8');
const traceFile = 'data/logs/final_trace.log';

function trace(msg) {
  try { require('fs').appendFileSync(traceFile, Date.now() + ' ' + msg + '\n'); } catch(e) {}
}

// 1. Add trace before and after writeVersion
code = code.replace(
  'await utils_default.writeVersion();',
  `trace('BEFORE_writeVersion');
  await utils_default.writeVersion();
  trace('AFTER_writeVersion');`
);

// 2. Socket.IO initialization
code = code.replace(
  'const io2 = new Server(server, { cors: { origin: "*" } });',
  `trace('BEFORE_SocketServer');
  const io2 = new Server(server, { cors: { origin: "*" } });
  trace('AFTER_SocketServer');`
);

// 3. Socket init
code = code.replace(
  'socket_default(io2);',
  `trace('BEFORE_socketInit');
  socket_default(io2);
  trace('AFTER_socketInit');`
);

// 4. Express WebSocket
code = code.replace(
  '(0, import_express_ws.default)(app);',
  `trace('BEFORE_expressWs');
  (0, import_express_ws.default)(app);
  trace('AFTER_expressWs');`
);

// 5. Express middleware
code = code.replace(
  'app.use((0, import_morgan.default)("dev"));',
  `trace('BEFORE_morgan');
  app.use((0, import_morgan.default)("dev"));
  trace('AFTER_morgan');`
);

code = code.replace(
  'app.use((0, import_cors.default)({ origin: "*" }));',
  `trace('BEFORE_cors');
  app.use((0, import_cors.default)({ origin: "*" }));
  trace('AFTER_cors');`
);

code = code.replace(
  'app.use(import_express172.default.json({ limit: "100mb" }));',
  `trace('BEFORE_jsonParser');
  app.use(import_express172.default.json({ limit: "100mb" }));
  trace('AFTER_jsonParser');`
);

code = code.replace(
  'app.use(import_express172.default.urlencoded({ extended: true, limit: "100mb" }));',
  `trace('BEFORE_urlencoded');
  app.use(import_express172.default.urlencoded({ extended: true, limit: "100mb" }));
  trace('AFTER_urlencoded');`
);

// 6. OSS setup
code = code.replace(
  'const ossDir = utils_default.getPath("oss");',
  `trace('BEFORE_ossSetup');
  const ossDir = utils_default.getPath("oss");`
);

// 7. Service route
code = code.replace(
  'app.use("/api/services", services_default);',
  `trace('BEFORE_servicesRoute');
  app.use("/api/services", services_default);
  trace('AFTER_servicesRoute');`
);

// 8. JWT middleware (this does first DB query)
code = code.replace(
  'app.use(async (req, res, next) => {',
  `trace('BEFORE_jwtMiddleware');
  app.use(async (req, res, next) => {`
);

// 9. Router
code = code.replace(
  'const router238 = await Promise.resolve().then(() => (init_router(), router_exports));',
  `trace('BEFORE_routerImport');
  const router238 = await Promise.resolve().then(() => (init_router(), router_exports));
  trace('AFTER_routerImport');`
);

// 10. Server listen
code = code.replace(
  'return await new Promise((resolve, reject) => {',
  `trace('BEFORE_httpListen');
  return await new Promise((resolve, reject) => {`
);

code = code.replace(
  'server.on("error", (err) => {',
  `trace('BEFORE_serverOnError');
  server.on("error", (err) => {`
);

code = code.replace(
  'server.listen(port, async () => {',
  `trace('BEFORE_serverListen');
  server.listen(port, async () => {`
);

code = code.replace(
  'console.log(\`[服务启动成功]: http://localhost:\${realPort} (总耗时 \${totalMs}ms)\`);',
  `trace('SERVER_LISTEN_CALLBACK');
  console.log(\`[服务启动成功]: http://localhost:\${realPort} (总耗时 \${totalMs}ms)\`);`
);

fs.writeFileSync('data/serve/app_final.js', code);
trace('PATCH_FILE_WRITTEN');
console.log('app_final.js written');
