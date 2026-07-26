const fs = require('fs');
const code = fs.readFileSync('data/serve/app_patched.js', 'utf8');

let patched = code;

// Add very fine-grained tracing
patched = patched.replace(
  'logger_default.genLog({ event: "app_start"',
  'console.log("[TRACE] before genLog app_start"); logger_default.genLog({ event: "app_start"'
);

patched = patched.replace(
  'const comfyPortBusy = await checkPortBusy(8188);',
  'console.log("[TRACE] before checkPort 8188"); const comfyPortBusy = await checkPortBusy(8188); console.log("[TRACE] after checkPort 8188");'
);

patched = patched.replace(
  'const qwenPortBusy = await checkPortBusy(8787);',
  'console.log("[TRACE] before checkPort 8787"); const qwenPortBusy = await checkPortBusy(8787); console.log("[TRACE] after checkPort 8787");'
);

fs.writeFileSync('data/serve/app_patched2.js', patched);
console.log('Patched2 written');
