// Diagnostic v6: patch app_diag4.js to add fs.appendFileSync traces
// to bypass stdout buffering
const fs = require('fs');
let code = fs.readFileSync('data/serve/app_diag4.js', 'utf8');

// Replace console.log traces with fs.appendFileSync traces
const traceFile = 'data/logs/diag6_trace.log';

// Add trace helper at module level
code = code.replace(
  'var isElectron2 = typeof process.versions?.electron !== "undefined";',
  `var isElectron2 = typeof process.versions?.electron !== "undefined";
// DIAG6: trace helper
var diag6Trace = function(msg) {
  try { fs.appendFileSync('${traceFile}', Date.now() + ' ' + msg + '\\n'); } catch(e) {}
};
diag6Trace('MODULE_LEVEL');`
);

// Add trace around writeVersion
code = code.replace(
  'await utils_default.writeVersion();',
  `diag6Trace('BEFORE_writeVersion');
  await utils_default.writeVersion();
  diag6Trace('AFTER_writeVersion');`
);

// Add trace around Socket.IO
code = code.replace(
  'const io2 = new Server(server, { cors: { origin: "*" } });',
  `diag6Trace('BEFORE_SocketIO');
  const io2 = new Server(server, { cors: { origin: "*" } });
  diag6Trace('AFTER_SocketIO');`
);

// Add trace around socket_init
code = code.replace(
  'socket_default(io2);',
  `diag6Trace('BEFORE_socket_init');
  socket_default(io2);
  diag6Trace('AFTER_socket_init');`
);

// Add trace around express-ws
code = code.replace(
  '(0, import_express_ws.default)(app);',
  `diag6Trace('BEFORE_expressWs');
  (0, import_express_ws.default)(app);
  diag6Trace('AFTER_expressWs');`
);

// Add trace before server.listen
code = code.replace(
  'const port = randomPort ? 0 : 10588;',
  `diag6Trace('BEFORE_LISTEN');
  const port = randomPort ? 0 : 10588;`
);

code = code.replace(
  'return await new Promise((resolve, reject) => {',
  `diag6Trace('LISTEN_PROMISE');
  return await new Promise((resolve, reject) => {`
);

fs.writeFileSync('data/serve/app_diag6.js', code);
console.log("[DIAG6] app_diag6.js written");
