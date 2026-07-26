// Minimal test: just require app.js and track when startServe actually runs
const start = Date.now();
function log(m) { console.log(`[${Date.now()-start}ms] ${m}`); }

process.env.NODE_ENV = "prod";
process.env.PORT = 10588;
process.env.OSSURL = "http://127.0.0.1:10588/";

// Set up a polling timer to detect event loop progress
const pollInterval = setInterval(() => {
  // This timer should fire every 100ms if event loop is free
}, 100);

let pollCount = 0;
const origSetInterval = global.setInterval;
global.setInterval = function(fn, ms, ...args) {
  return origSetInterval(function(...args2) {
    pollCount++;
    try { fn.apply(this, args2); } catch(e) {}
  }, ms, ...args);
};

log("Starting require...");
const t1 = Date.now();
require("./app.js");
log(`require returned after ${Date.now()-t1}ms`);

// Check after 5s if timer is still running
setTimeout(() => {
  log(`5s elapsed, pollCount=${pollCount}`);
  clearInterval(pollInterval);
  
  // Check port
  const net = require("net");
  const s = new net.Socket();
  s.on("error", () => { log("Port 10588: not listening at 5s"); s.destroy(); });
  s.on("connect", () => { log("Port 10588: LISTENING at 5s!"); s.destroy(); });
  s.connect(10588, "127.0.0.1");
}, 5000);
