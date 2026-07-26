// Final diag v10: proper injection, test where Promise resolution breaks
var fs = require('fs');
var code = fs.readFileSync('data/serve/app.js', 'utf8');
var traceFile = 'data/logs/final_trace10.log';

// Inject trace helper with correct path
code = 'var diagTrace=function(m){try{require("fs").appendFileSync("' + traceFile.replace(/\\/g,'\\\\') + '",Date.now()+" "+m+"\\n")}catch(e){}};\n' +
  'diagTrace("MODULE_START");\n' +
  'new Promise(function(r){r();}).then(function(){diagTrace("MODULE_PROMISE_THEN");});\n' +
  code;

// Remove port check entirely (no net.Socket)
code = code.split(
  "Promise.allSettled([\n    checkPortBusy(8188, \"ComfyUI\").catch(() => ({ port: 8188, busy: false })),\n    checkPortBusy(8787, \"Qwen3\").catch(() => ({ port: 8787, busy: false })),\n  ]).then(results => {\n    for (const r of results) {\n      if (r.status === \"fulfilled\") {\n        genLogger.genLog({ event: \"startup_port_status\", service: r.value.port === 8188 ? \"ComfyUI\" : \"Qwen3\", port: r.value.port, status: r.value.busy ? \"in_use\" : \"free\" });\n      }\n    }\n  }).catch(() => {});"
).join(
  'diagTrace("PORT_CHECK_SKIPPED");'
);

// Test Promise before writeVersion call
code = code.split(
  'await utils_default.writeVersion();'
).join(
  'diagTrace("BEFORE_PROMISE_TEST");\n' +
  '  await new Promise(function(r){diagTrace("PROMISE_RESOLVING");r();diagTrace("PROMISE_RESOLVED");});\n' +
  '  diagTrace("AFTER_PROMISE_TEST");\n' +
  '  await utils_default.writeVersion();\n' +
  '  diagTrace("AFTER_WRITEVERSION");'
);

fs.writeFileSync('data/serve/app_final10.js', code);
console.log('app_final10.js written (' + code.length + ' bytes)');
