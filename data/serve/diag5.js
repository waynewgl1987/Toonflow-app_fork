// Diagnostic v5: Isolate the hang after port check - trace every phase
const fs = require('fs');
let code = fs.readFileSync('data/serve/app.js', 'utf8');

// 1. Bypass port check
code = code.replace(
  'const portResults = await Promise.all([\n    checkPortBusy(8188, "ComfyUI"),\n    checkPortBusy(8787, "Qwen3")\n  ]);',
  `const portResults = [{port:8188,busy:false},{port:8787,busy:false}];
  console.log("[DIAG5] port check bypassed");`
);

// 2. Remove checkPortBusy function
const oldFn = `async function checkPortBusy(port, label = "") {
  const net4 = require("net");
  return new Promise((resolve3) => {
    const socket = new net4.Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      console.log(\`[DEBUG] checkPortBusy(\${port}) \${label} - timeout after 5s\`);
      resolve3({ port, busy: false });
    }, 5e3);
    socket.on("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      console.log(\`[DEBUG] checkPortBusy(\${port}) \${label} - connected\`);
      resolve3({ port, busy: true });
    });
    socket.on("error", (err) => {
      clearTimeout(timer);
      socket.destroy();
      resolve3({ port, busy: false });
    });
    socket.connect(port, "127.0.0.1");
  });
}`;
code = code.replace(oldFn, `async function checkPortBusy(port, label = "") { return {port, busy:false}; }`);

// 3. Add trace before and after every await phase after port check
// Phase: writeVersion
code = code.replace(
  'await utils_default.writeVersion();',
  `console.log("[DIAG5] BEFORE writeVersion");
  await utils_default.writeVersion();
  console.log("[DIAG5] AFTER writeVersion");`
);

// Phase: Socket.IO init
code = code.replace(
  'const io2 = new Server(server, { cors: { origin: "*" } });',
  `console.log("[DIAG5] BEFORE Server(server)");
  const io2 = new Server(server, { cors: { origin: "*" } });
  console.log("[DIAG5] AFTER Server(server)");`
);

// Phase: socket_init
code = code.replace(
  'socket_default(io2);',
  `console.log("[DIAG5] BEFORE socket_init");
  socket_default(io2);
  console.log("[DIAG5] AFTER socket_init");`
);

// Phase: express-ws
code = code.replace(
  '(0, import_express_ws.default)(app);',
  `console.log("[DIAG5] BEFORE expressWs");
  (0, import_express_ws.default)(app);
  console.log("[DIAG5] AFTER expressWs");`
);

// Phase: middleware
code = code.replace(
  'app.use((0, import_morgan.default)("dev"));',
  `console.log("[DIAG5] BEFORE morgan");
  app.use((0, import_morgan.default)("dev"));
  console.log("[DIAG5] AFTER morgan");`
);

// Phase: cors
code = code.replace(
  'app.use((0, import_cors.default)({ origin: "*" }));',
  `console.log("[DIAG5] BEFORE cors");
  app.use((0, import_cors.default)({ origin: "*" }));
  console.log("[DIAG5] AFTER cors");`
);

// Phase: json middleware
code = code.replace(
  'app.use(import_express172.default.json({ limit: "100mb" }));',
  `console.log("[DIAG5] BEFORE json");
  app.use(import_express172.default.json({ limit: "100mb" }));
  console.log("[DIAG5] AFTER json");`
);

// Phase: urlencoded
code = code.replace(
  'app.use(import_express172.default.urlencoded({ extended: true, limit: "100mb" }));',
  `console.log("[DIAG5] BEFORE urlencoded");
  app.use(import_express172.default.urlencoded({ extended: true, limit: "100mb" }));
  console.log("[DIAG5] AFTER urlencoded");`
);

// Force flush stdout after every message
code = code.replace(
  'const phase = (name28) => console.log(\`[启动阶段] \${name28} (\${Date.now() - startupStart}ms)\`);',
  `const phase = (name28) => { console.log(\`[启动阶段] \${name28} (\${Date.now() - startupStart}ms)\`); try { process.stdout.write(''); } catch(e) {} }`
);

// Add a forced flush timer at module level
code = code.replace(
  'var isElectron2 = typeof process.versions?.electron !== "undefined";',
  `console.log("[DIAG5] Module level");
var isElectron2 = typeof process.versions?.electron !== "undefined";
// Force a flush
process.stdout.write("");`

);

fs.writeFileSync('data/serve/app_diag5.js', code);
console.log("[DIAG5] app_diag5.js written");
