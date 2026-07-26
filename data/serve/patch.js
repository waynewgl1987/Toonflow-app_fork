const fs = require('fs');
const code = fs.readFileSync('data/serve/app.js', 'utf8');

let patched = code;

// Add trace at start of startServe
patched = patched.replace(
  'async function startServe(randomPort = false) {',
  'async function startServe(randomPort = false) { console.log("[TRACE] startServe begin");'
);

patched = patched.replace(
  'await checkPermissions();',
  'console.log("[TRACE] before checkPerms"); await checkPermissions(); console.log("[TRACE] after checkPerms");'
);

patched = patched.replace(
  'await utils_default.writeVersion();',
  'console.log("[TRACE] before writeVer"); await utils_default.writeVersion(); console.log("[TRACE] after writeVer");'
);

patched = patched.replace(
  'const router172 = await Promise.resolve().then(() => (init_router(), router_exports));',
  'console.log("[TRACE] before init_router"); const router172 = await Promise.resolve().then(() => (init_router(), router_exports)); console.log("[TRACE] after init_router");'
);

patched = patched.replace(
  'app.use("/api/services", services_default);',
  'console.log("[TRACE] before services"); app.use("/api/services", services_default); console.log("[TRACE] after services");'
);

patched = patched.replace(
  'const io2 = new Server(server, { cors: { origin: "*" } });',
  'console.log("[TRACE] before socketio"); const io2 = new Server(server, { cors: { origin: "*" } }); console.log("[TRACE] after socketio");'
);

patched = patched.replace(
  'socket_default(io2);',
  'console.log("[TRACE] before socketInit"); socket_default(io2); console.log("[TRACE] after socketInit");'
);

fs.writeFileSync('data/serve/app_patched.js', patched);
console.log('Patched file written successfully');
