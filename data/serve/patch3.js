const fs = require('fs');
const code = fs.readFileSync('data/serve/app.js', 'utf8');

// Replace checkPortBusy with a version that logs
const oldFn = `async function checkPortBusy(port) {
  const net4 = await import("node:net");
  return new Promise((resolve3) => {
    const socket = new net4.Socket();
    socket.setTimeout(2e3);
    socket.on("connect", () => {
      socket.destroy();
      resolve3(true);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve3(false);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve3(false);
    });
    socket.connect(port, "127.0.0.1");
  });
}`;

const newFn = `async function checkPortBusy(port) {
  console.log("[TRACE] checkPortBusy begin port=" + port);
  const net4 = await import("node:net");
  console.log("[TRACE] checkPortBusy net imported");
  return new Promise((resolve3) => {
    const socket = new net4.Socket();
    socket.setTimeout(2e3);
    let resolved = false;
    socket.on("connect", () => {
      if (resolved) return; resolved = true;
      console.log("[TRACE] checkPortBusy connected port=" + port);
      socket.destroy();
      resolve3(true);
    });
    socket.on("error", (e) => {
      if (resolved) return; resolved = true;
      console.log("[TRACE] checkPortBusy error port=" + port + " msg=" + (e && e.message || "unknown"));
      socket.destroy();
      resolve3(false);
    });
    socket.on("timeout", () => {
      if (resolved) return; resolved = true;
      console.log("[TRACE] checkPortBusy timeout port=" + port);
      socket.destroy();
      resolve3(false);
    });
    socket.connect(port, "127.0.0.1");
    console.log("[TRACE] checkPortBusy connect called port=" + port);
  });
}`;

const patched = code.replace(oldFn, newFn);
fs.writeFileSync('data/serve/app_patched3.js', patched);
console.log('Done. Replaced: ' + (code !== patched));
