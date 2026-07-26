// Diagnostic v2: replace checkPortBusy with tracers to isolate the hang
const fs = require('fs');
let code = fs.readFileSync('data/serve/app.js', 'utf8');

// Show where the hang is: replace Promise.all with trace-wrapped version
// Add detailed diagnostics inside checkPortBusy
code = code.replace(
  'const net4 = require("net");',
  `const net4 = require("net");
  console.log("[DIAG2] checkPortBusy("+port+","+label+") called at " + Date.now());
  // Create a second timer that's independent
  if (typeof global.DIAG2_COUNTER === 'undefined') global.DIAG2_COUNTER = {};
  const key = 'p'+port;
  const safetyTimer = setTimeout(function(){
    console.log("[DIAG2-SAFETY] "+key+" safety timeout at " + Date.now());
    reject('safety timeout');
  }, 8000);
  safetyTimer.unref();
`
);

// Add trace for connect/error/timeout
code = code.replace(
  'socket.on("connect", () => {',
  'socket.on("connect", () => { console.log("[DIAG2] "+key+" connect event");'
);
code = code.replace(
  'socket.on("error", (err) => {',
  'socket.on("error", (err) => { console.log("[DIAG2] "+key+" error event:", err.code);'
);
code = code.replace(
  'const timer = setTimeout(() => {',
  'const timer = setTimeout(() => { console.log("[DIAG2] "+key+" timeout event");'
);

// Replace Promise.all with two sequential calls to better trace
code = code.replace(
  'const portResults = await Promise.all([\n    checkPortBusy(8188, "ComfyUI"),\n    checkPortBusy(8787, "Qwen3")\n  ]);',
  `console.log("[DIAG2] Starting sequential port checks...");
  const r1 = await checkPortBusy(8188, "ComfyUI");
  console.log("[DIAG2] 8188 result:", JSON.stringify(r1));
  const r2 = await checkPortBusy(8787, "Qwen3");
  console.log("[DIAG2] 8787 result:", JSON.stringify(r2));
  const portResults = [r1, r2];`
);

// Also add a timer to the module level that fires every 5s
code = code.replace(
  'var isElectron2 = typeof process.versions?.electron !== "undefined";',
  'var isElectron2 = typeof process.versions?.electron !== "undefined";\nsetInterval(function(){ console.log("[DIAG2-HEARTBEAT] event loop alive at " + Date.now()); }, 5000);'
);

fs.writeFileSync('data/serve/app_diag2.js', code);
console.log("[DIAG2] app_diag2.js written");
