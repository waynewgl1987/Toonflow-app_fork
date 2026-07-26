// Fix app v2: Replace startServe to avoid async/await entirely
// Use explicit .then() chains and synchronous operations
var fs = require('fs');
var code = fs.readFileSync('data/serve/app.js', 'utf8');

// Replace checkPortBusy with no-op
code = code.replace(
  'async function checkPortBusy(port, label = "") {\n  const net4 = require("net");\n  return new Promise((resolve3) => {\n    const socket = new net4.Socket();\n    const timer = setTimeout(() => {\n      socket.destroy();\n      console.log(`[DEBUG] checkPortBusy(${port}) ${label} - timeout after 5s`);\n      resolve3({ port, busy: false });\n    }, 5e3);\n    socket.on("connect", () => {\n      clearTimeout(timer);\n      socket.destroy();\n      console.log(`[DEBUG] checkPortBusy(${port}) ${label} - connected`);\n      resolve3({ port, busy: true });\n    });\n    socket.on("error", (err) => {\n      clearTimeout(timer);\n      socket.destroy();\n      resolve3({ port, busy: false });\n    });\n    socket.connect(port, "127.0.0.1");\n  });\n}',
  'function checkPortBusy(port, label) {\n  return { port, busy: false };\n}'
);

// Replace the entire startServe function body with a version that doesn't await
// Key insight: keep it synchronous up to server.listen, use .listen callback
code = code.replace(
  'async function startServe(randomPort = false) {',
  'function startServe(randomPort = false) {'
);

// Replace all `await X;` with `X;` (remove await keyword but keep operation)
// But only inside startServe function
var lines = code.split('\n');
var inStartServe = false;
var braceDepth = 0;
for (var i = 0; i < lines.length; i++) {
  var line = lines[i];
  if (line.indexOf('function startServe(') >= 0) {
    inStartServe = true;
    braceDepth = 0;
  }
  if (inStartServe) {
    // Count braces to track when we exit startServe
    for (var c = 0; c < line.length; c++) {
      if (line[c] === '{') braceDepth++;
      if (line[c] === '}') braceDepth--;
    }
    // Replace await keyword at start of line (with optional space)
    line = line.replace(/^( *)await /, '$1');
    lines[i] = line;
    if (braceDepth <= 0 && line.indexOf('function ') < 0) {
      inStartServe = false;
    }
  }
}
code = lines.join('\n');

// Fix: replace `new Promise((resolve, reject) => { server.on("error"...) server.listen(port, async () => {` 
// with direct server.listen call (no promise wrapping since we don't await)
code = code.replace(
  'return await new Promise((resolve, reject) => {\n    server.on("error", (err) => {\n      if (err.code === "EADDRINUSE") {\n        console.error(`[启动失败] 端口 ${port} 已被占用`);\n        logger_default.genLog({ event: "app_listen_error", error: `端口 ${port} 已被占用` });\n        reject(new Error(`端口 ${port} 已被占用`));\n      } else {\n        console.error("[启动失败]", err.message);\n        reject(err);\n      }\n    });\n    server.listen(port, async () => {',
  'server.on("error", (err) => {\n      if (err.code === "EADDRINUSE") {\n        console.error(`[启动失败] 端口 ${port} 已被占用`);\n        logger_default.genLog({ event: "app_listen_error", error: `端口 ${port} 已被占用` });\n      } else {\n        console.error("[启动失败]", err.message);\n      }\n    });\n    server.listen(port, () => {'
);

// Replace the resolve(realPort) with direct console.log
code = code.replace(
  'const totalMs = Date.now() - startupStart;\n      clearInterval(watchdog);\n      console.log(`[服务启动成功]: http://localhost:${realPort} (总耗时 ${totalMs}ms)`);\n      logger_default.genLog({ event: "app_listening", port: realPort, url: `http://localhost:${realPort}`, startupTime: totalMs });\n      resolve(realPort);',
  'const totalMs = Date.now() - startupStart;\n      clearInterval(watchdog);\n      console.log(`[服务启动成功]: http://localhost:${realPort} (总耗时 ${totalMs}ms)`);\n      logger_default.genLog({ event: "app_listening", port: realPort, url: `http://localhost:${realPort}`, startupTime: totalMs });'
);

// Remove the closing }) of the Promise
code = code.replace(
  '    });\n  });\n}',
  '    });\n  });'
);

// The startServe function no longer returns a Promise at the end
// The call site at bottom needs to be updated
code = code.replace(
  'if (!isElectron2) {\n  startServe().catch((err) => {\n    console.error("[启动失败]", err instanceof Error ? err.message : err);\n    process.exit(1);\n  });\n}',
  'if (!isElectron2) {\n  try {\n    startServe();\n  } catch(err) {\n    console.error("[启动失败]", err instanceof Error ? err.message : err);\n    process.exit(1);\n  }\n}'
);

fs.writeFileSync('data/serve/app_fixed2.js', code);
console.log('app_fixed2.js written (' + code.length + ' bytes)');
