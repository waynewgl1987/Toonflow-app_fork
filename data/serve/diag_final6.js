// Final diagnostic v6: simple approach - use string concat, no template literals
var fs = require('fs');
var code = fs.readFileSync('data/serve/app.js', 'utf8');
var traceFile = 'data/logs/final_trace6.log';

// Inject trace helper at module start
code = 'var diagTrace=function(m){try{require("fs").appendFileSync("' + traceFile.replace(/\\/g, '\\\\') + '",Date.now()+" "+m+"\\n")}catch(e){}};\ndiagTrace("MODULE_START");\n' + code;

// Add trace after writeVersion call using simple text replace
code = code.split('await utils_default.writeVersion();').join(
  'await utils_default.writeVersion();\ndiagTrace("AFTER_AWAIT");'
);

// Add trace inside writeVersion_default
code = code.split(
  'import_fs6.default.writeFileSync(versionFile, version3 ?? APP_VERSION, "utf8");'
).join(
  'import_fs6.default.writeFileSync(versionFile, version3 ?? APP_VERSION, "utf8");\n      diagTrace("WRITEVER_DONE");'
);

fs.writeFileSync('data/serve/app_final6.js', code);
console.log('app_final6.js written (' + code.length + ' bytes)');
