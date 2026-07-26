// Diagnostic: patch app.js to trace checkPortBusy
const fs = require('fs');
const origCode = fs.readFileSync('data/serve/app.js', 'utf8');

// Replace require("net") with traced version
let patched = origCode.replace(
  'const net4 = require("net");',
  'const net4 = require("net"); console.log("[DIAG] require net OK, Socket=" + typeof net4.Socket);'
);

// Add trace around Promise.all
patched = patched.replace(
  'const portResults = await Promise.all([',
  'console.log("[DIAG] Starting port check Promise.all..."); const portResults = await Promise.all(['
);

// Add trace inside the array
patched = patched.replace(
  'checkPortBusy(8188, "ComfyUI"),',
  'checkPortBusy(8188, "ComfyUI").then(function(r){ console.log("[DIAG] 8188 done:",JSON.stringify(r)); return r; }),'
);
patched = patched.replace(
  'checkPortBusy(8787, "Qwen3")',
  'checkPortBusy(8787, "Qwen3").then(function(r){ console.log("[DIAG] 8787 done:",JSON.stringify(r)); return r; })'
);

// Add trace after Promise.all
patched = patched.replace(
  'for (const r of portResults) {',
  'console.log("[DIAG] Promise.all resolved! Results:", JSON.stringify(portResults)); for (const r of portResults) {'
);

// Add a 120s watchdog at module level
patched = patched.replace(
  "var isElectron2 = typeof process.versions?.electron !== \"undefined\";",
  "var isElectron2 = typeof process.versions?.electron !== \"undefined\";\nconsole.log(\"[DIAG] isElectron=\", isElectron2);\nsetInterval(function(){ console.log(\"[DIAG-WATCHDOG] still running at \" + Math.round((Date.now()-globalStartupTime)/1000) + \"s\"); }, 10000);"
);

fs.writeFileSync('data/serve/app_diag.js', patched);
console.log("[DIAG] app_diag.js written successfully");
