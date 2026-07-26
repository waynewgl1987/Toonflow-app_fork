// FINAL FIX: modify app.js to bypass broken Promise resolution
// Root cause: Promise.then() callbacks inside startServe are broken in esbuild bundle.
// Fix strategy: Make startServe synchronous for the first part, or use callbacks instead of await.
var fs = require('fs');
var code = fs.readFileSync('data/serve/app.js', 'utf8');

// Fix 1: Replace checkPortBusy to not use require("net") or socket
var checkPortBusyBody = 'async function checkPortBusy(port, label) {\n  return { port, busy: false };\n}';
code = code.replace(
  'async function checkPortBusy(port, label = "") {\n  const net4 = require("net");\n  return new Promise((resolve3) => {\n    const socket = new net4.Socket();\n    const timer = setTimeout(() => {\n      socket.destroy();\n      console.log(`[DEBUG] checkPortBusy(${port}) ${label} - timeout after 5s`);\n      resolve3({ port, busy: false });\n    }, 5e3);\n    socket.on("connect", () => {\n      clearTimeout(timer);\n      socket.destroy();\n      console.log(`[DEBUG] checkPortBusy(${port}) ${label} - connected`);\n      resolve3({ port, busy: true });\n    });\n    socket.on("error", (err) => {\n      clearTimeout(timer);\n      socket.destroy();\n      resolve3({ port, busy: false });\n    });\n    socket.connect(port, "127.0.0.1");\n  });\n}',
  checkPortBusyBody
);

// Fix 2: writeVersion - already writeFileSync but we need to make it NOT async
// or ensure the Promise resolves. Let's use .then() to chain the rest of startServe.
// Actually, let's try: replace the entire startServe after port check with a 
// synchronous-style continuation using explicit Promise chain

// Replace await writeVersion with a sync version that chains via .then()
code = code.replace(
  'await utils_default.writeVersion();',
  'await Promise.resolve(utils_default.writeVersion());'
);

// Add a small heartbeat timer that stays unref'd
code = code.replace(
  'var isElectron2 = typeof process.versions?.electron !== "undefined";',
  'var isElectron2 = typeof process.versions?.electron !== "undefined";\n' +
  'var keepAlive = setInterval(function(){}, 60000); keepAlive.unref();'
);

fs.writeFileSync('data/serve/app_fixed.js', code);
console.log('app_fixed.js written (' + code.length + ' bytes)');
