// Diagnostic v4: Remove ALL socket/port check code, just test if event loop runs
const fs = require('fs');
let code = fs.readFileSync('data/serve/app.js', 'utf8');

// Step 1: Add a module-level timer BEFORE startServe is called
code = code.replace(
  'var isElectron2 = typeof process.versions?.electron !== "undefined";',
  `console.log("[DIAG4] Module level - about to call startServe");
var isElectron2 = typeof process.versions?.electron !== "undefined";

// Test if event loop works at module level
var moduleTimer = setTimeout(function() {
  console.log("[DIAG4] MODULE TIMER FIRED - event loop works!");
}, 100);
moduleTimer.unref();`
);

// Step 2: Completely bypass the port check - replace checkPortBusy with immediate resolve
code = code.replace(
  'const portResults = await Promise.all([\n    checkPortBusy(8188, "ComfyUI"),\n    checkPortBusy(8787, "Qwen3")\n  ]);',
  `console.log("[DIAG4] BEFORE port check");
  const portResults = [{port:8188,busy:false},{port:8787,busy:false}];
  console.log("[DIAG4] AFTER port check (bypassed)");`
);

// Step 3: Remove the entire checkPortBusy function to avoid any side effects
// Replace the function with a no-op
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

fs.writeFileSync('data/serve/app_diag4.js', code);
console.log("[DIAG4] app_diag4.js written");
