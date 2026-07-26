// Final diagnostic v9: find where Promise resolution breaks
var fs = require('fs');
var code = fs.readFileSync('data/serve/app.js', 'utf8');
var traceFile = 'data/logs/final_trace9.log';
var dt = function(m){try{require("fs").appendFileSync(""+traceFile,Date.now()+" "+m+"\n")}catch(e){}};

// Inject trace helper globally
code = 'var dt='+dt.toString().replace(traceFile,'"'+traceFile.replace(/\\/g,'\\\\')+'"')+';\ndt("MODULE_START");\n'+
  // Test Promise at module level
  'new Promise(function(r){dt("MODULE_PROMISE_CONSTRUCTOR");r();}).then(function(){dt("MODULE_PROMISE_THEN");});\n' +
  code;

// Test Promise BEFORE writeVersion call
code = code.split(
  'await utils_default.writeVersion();'
).join(
  'dt("BEFORE_PROMISE_TEST");\n' +
  '  await new Promise(function(r){dt("PROMISE_CONSTRUCTOR");r();});\n' +
  '  dt("AFTER_PROMISE_TEST");\n' +
  '  await utils_default.writeVersion();\n' +
  '  dt("AFTER_WRITEVERSION");'
);

// Also test Promise in writeVersion_default
code = code.split(
  'writeVersion_default = async (version3) => {'
).join(
  'writeVersion_default = async (version3) => { dt("WRITEVER_ENTER");'
);

code = code.split(
  'import_fs6.default.writeFileSync(versionFile, version3 ?? APP_VERSION, "utf8");'
).join(
  'import_fs6.default.writeFileSync(versionFile, version3 ?? APP_VERSION, "utf8");\n' +
  '      dt("WRITEVER_WRITE_DONE");'
);

// Check port check: replace with no-op to eliminate net.Socket side effects
code = code.split(
  "Promise.allSettled([\n    checkPortBusy(8188, \"ComfyUI\").catch(() => ({ port: 8188, busy: false })),\n    checkPortBusy(8787, \"Qwen3\").catch(() => ({ port: 8787, busy: false })),\n  ]).then(results => {\n    for (const r of results) {\n      if (r.status === \"fulfilled\") {\n        genLogger.genLog({ event: \"startup_port_status\", service: r.value.port === 8188 ? \"ComfyUI\" : \"Qwen3\", port: r.value.port, status: r.value.busy ? \"in_use\" : \"free\" });\n      }\n    }\n  }).catch(() => {});"
).join(
  'dt("PORT_CHECK_SKIPPED");'
);

fs.writeFileSync('data/serve/app_final9.js', code);
console.log('app_final9.js written (' + code.length + ' bytes)');
