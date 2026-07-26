// FINAL FIX: Replace startServe with a version that doesn't rely on ES module async
var fs = require('fs');
var code = fs.readFileSync('data/serve/app.js', 'utf8');

// Replace the entire startServe function body with sync-only version
// The key: keep checkPermissions() await, then do ALL remaining work via setImmediate
// that's scheduled from a module-level helper

// Step 1: Replace checkPortBusy to avoid net module issues
code = code.replace(
  'function checkPortBusy(port, label) {\n  return { port, busy: false };\n}',
  'function checkPortBusy(port, label) {\n  return { port, busy: false };\n}'
);

// Step 2: Replace the startServe function 
// From: async function startServe... up to the end
// Keep the first await checkPermissions(), then use setImmediate chain

// The old pattern (approximately):
//   async function startServe(randomPort=false) {
//     ... await checkPermissions();
//     ... (all sync code)
//     ... server.listen(port, callback)
//   }

// New pattern:
//   function startServe(randomPort=false) {
//     return (async () => {
//       await checkPermissions();
//       // Everything else happens in the callback
//       server.listen(port, callback);
//     })();
//   }

// Actually, let me try the SIMPLEST possible thing: 
// Just replace the setTimeout with a direct call
code = code.replace(
  'setTimeout(() => {\n    server.listen(port, () => {',
  'server.listen(port, () => {'
);

// And remove the closing }) and }); for setTimeout
// Old:   }, 0);\n\n  return Promise.resolve(port);
// New:   });\n\n  return new Promise((resolve) => { server.on("listening", resolve); });\n}
code = code.replace(
  '    });\n  }, 0);\n\n  // 返回一个立即 resolve 的 promise\n  return Promise.resolve(port);',
  '    });\n  \n  return new Promise((resolve) => {\n    server.on("listening", resolve);\n  });'
);

// Fix the closing brace of startServe
// The function should still close properly

fs.writeFileSync('data/serve/app_fixed_final.js', code);
console.log('app_fixed_final.js written');
