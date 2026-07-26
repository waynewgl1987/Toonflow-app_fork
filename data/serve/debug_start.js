// Debug wrapper: prints stack trace every 10s to find what's blocking
const fs = require("fs");

// Override console.log to also flush
const origLog = console.log;
console.log = (...args) => {
  origLog(...args);
  try { fs.appendFileSync("data\\logs\\debug_trace.log", `[${Date.now()}] ${args.join(" ")}\n`); } catch(e) {}
};

// Print stack trace every 10 seconds to find blocking code
const timer = setInterval(() => {
  const err = new Error("STUCK_CHECK");
  const stack = err.stack.split("\n").slice(2, 15).join("\n");
  const msg = `=== STUCK @ ${Date.now()}ms ===\n${stack}\n`;
  console.log(msg);
  try { fs.appendFileSync("data\\logs\\debug_trace.log", msg); } catch(e) {}
}, 10000);

// Start the actual app
require("./app.js");

// Clear timer after startup (won't be reached if app.js doesn't return)
origLog("app.js require completed");
