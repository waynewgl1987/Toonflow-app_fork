// Diagnostic v3: Replace checkPortBusy with a simple timeout 
// to test if Promise.all is the issue
const fs = require('fs');
let code = fs.readFileSync('data/serve/app.js', 'utf8');

// Replace the entire checkPortBusy function with a version that just times out
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

const newFn = `async function checkPortBusy(port, label = "") {
  console.log("[DIAG3] checkPortBusy(" + port + "," + label + ") start");
  return new Promise((resolve3) => {
    const timeout = setTimeout(() => {
      console.log("[DIAG3] checkPortBusy(" + port + "," + label + ") timeout fired");
      resolve3({ port, busy: false });
    }, 3000);
    // Also try the net.Socket approach but with a wrapper
    try {
      const net4 = require("net");
      console.log("[DIAG3] net.Socket type:", typeof net4.Socket);
      const socket = new net4.Socket();
      console.log("[DIAG3] socket created");
      // Force an immediate resolve via net for comparison
      // socket.connect will be tried but we already have the timeout
    } catch(e) {
      console.log("[DIAG3] net error:", e.message);
    }
  });
}`;

code = code.replace(oldFn, newFn);

// Add heartbeat
code = code.replace(
  'var isElectron2 = typeof process.versions?.electron !== "undefined";',
  'var isElectron2 = typeof process.versions?.electron !== "undefined";\nsetInterval(function(){ console.log("[DIAG3-HEARTBEAT] event loop alive"); }, 5000);'
);

fs.writeFileSync('data/serve/app_diag3.js', code);
console.log("[DIAG3] app_diag3.js written");
