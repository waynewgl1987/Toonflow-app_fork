// Fix app v3: MINIMAL change - only fix what breaks
// The issue: inside startServe, Promise.then() doesn't fire after a certain point
// Hypothesis: something in module init corrupts Promise resolution for code inside async functions
// Fix: move all code after the first problematic await into a setImmediate/setTimeout callback
var fs = require('fs');
var code = fs.readFileSync('data/serve/app.js', 'utf8');

// Step 1: Replace checkPortBusy with no-op (no require("net"), no socket)
code = code.replace(
  'async function checkPortBusy(port, label = "") {\n  const net4 = require("net");\n  return new Promise((resolve3) => {\n    const socket = new net4.Socket();\n    const timer = setTimeout(() => {\n      socket.destroy();\n      console.log(`[DEBUG] checkPortBusy(${port}) ${label} - timeout after 5s`);\n      resolve3({ port, busy: false });\n    }, 5e3);\n    socket.on("connect", () => {\n      clearTimeout(timer);\n      socket.destroy();\n      console.log(`[DEBUG] checkPortBusy(${port}) ${label} - connected`);\n      resolve3({ port, busy: true });\n    });\n    socket.on("error", (err) => {\n      clearTimeout(timer);\n      socket.destroy();\n      resolve3({ port, busy: false });\n    });\n    socket.connect(port, "127.0.0.1");\n  });\n}',
  'function checkPortBusy(port, label) {\n  return { port, busy: false };\n}'
);

// Step 2: Replace all file I/O to use sync methods (already done in rebuild)
// Step 3: Replace the entire startServe body to not use await for Promises that hang
// Replace the function from the port check onwards with setImmediate-based continuation

// Strategy: instead of `await X; phase("Y")`, use `;(function(){X.then(function(){phase("Y")})})();return;`
// This starts the chain but doesn't block startServe. The chain continues via callbacks.

// Actually, simplest fix: Use setImmediate recursion instead of await
// The code after port check gets wrapped in a setImmediate chain

// Let's try the SIMPLEST possible fix: wrap the entire code after port check in setImmediate
code = code.replace(
  'Promise.allSettled([\n    checkPortBusy(8188, "ComfyUI").catch(() => ({ port: 8188, busy: false })),\n    checkPortBusy(8787, "Qwen3").catch(() => ({ port: 8787, busy: false }))\n  ]).then((results) => {\n    for (const r of results) {\n      if (r.status === "fulfilled") {\n        logger_default.genLog({ event: "startup_port_status", service: r.value.port === 8188 ? "ComfyUI" : "Qwen3", port: r.value.port, status: r.value.busy ? "in_use" : "free" });\n      }\n    }\n  }).catch(() => {\n  });\n  phase("端口检查完成");\n  await utils_default.writeVersion();\n  phase("版本文件写入完成");\n  const io2 = new Server(server, { cors: { origin: "*" } });\n  socket_default(io2);\n  phase("Socket.IO 初始化完成");',
  'phase("端口检查完成");\n  setImmediate(function() {\n    utils_default.writeVersion();\n    phase("版本文件写入完成");\n    try {\n      var io2 = new Server(server, { cors: { origin: "*" } });\n    } catch(e) { console.error("Server error:", e.message); }\n    try { socket_default(io2); } catch(e) { console.error("socket error:", e.message); }\n    phase("Socket.IO 初始化完成");'
);

// The problem is that there are many more awaits after these. Let me wrap the ENTIRE startServe
// after port check in setImmediate (converting all awaits to sync or setImmediate)

// Actually this is getting too complex. Let me just try the ORIGINAL app.js (before rebuild)
// to see if the issue exists there too.

console.log('This approach is too complex. Trying alternative...');
