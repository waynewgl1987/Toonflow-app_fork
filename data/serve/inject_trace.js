// Inject synchronous timing markers into app.js to find where event loop blocks
const fs = require("fs");

let code = fs.readFileSync("data/serve/app.js", "utf8");
let modified = code;

// Add trace before every await/async call that could block
// Find the startServe function and add timing
const markers = [
  // Before require("net") - could this be blocking?
  { from: 'require("net")', to: 'console.log("[TRACE_SYNC] require net at",Date.now()),require("net")' },
  // Before checkPermissions call
  { from: "checkPermissions(){", to: "checkPermissions(){console.log('[TRACE] checkPermissions at',Date.now())" },
  // Before knex initialization  
  { from: 'client:"better-sqlite3"', to: 'console.log("[TRACE_SYNC] before knex at",Date.now()),client:"better-sqlite3"' },
  // Before the initDB call in the async IIFE
  { from: "async function initDB", to: "console.log('[TRACE] initDB function defined at',Date.now());async function initDB" },
  // Mark the start of the big module evaluation  
  { from: 'require("@huggingface/transformers")', to: 'console.log("[TRACE_SYNC] loading transformers at",Date.now()),require("@huggingface/transformers")' },
];

for (const { from, to } of markers) {
  if (modified.includes(from)) {
    modified = modified.replace(from, to);
    console.log("  Patched:", from.substring(0, 60));
  } else {
    console.log("  NOT FOUND:", from.substring(0, 60));
  }
}

fs.writeFileSync("data/serve/app_injected.js", modified);
console.log("Written to app_injected.js");
