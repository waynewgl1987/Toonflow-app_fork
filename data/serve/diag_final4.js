// Final diagnostic v4: SIMPLE - trace inside and outside writeVersion
const fs = require('fs');
let code = fs.readFileSync('data/serve/app.js', 'utf8');
const traceFile = 'data/logs/final_trace4.log';

// Inject trace helper at module level (BEFORE everything)
code = 'var diagTrace = function(msg) { try { require("fs").appendFileSync("' + traceFile.replace(/\\/g, '\\\\') + '", Date.now() + " " + msg + "\\n"); } catch(e) {} };\ndiagTrace("MODULE_START");\n' + code;

// Trace the writeVersion call in startServe
code = code.replace(
  'await utils_default.writeVersion();',
  'await utils_default.writeVersion();\ndiagTrace("AFTER_await_writeVersion");'
);

// Add trace inside writeVersion_default (at the closing brace)
// Find: writeFileSync + next line is closing }
code = code.replace(
  'import_fs6.default.writeFileSync(versionFile, version3 ?? APP_VERSION, "utf8");\n    };',
  'import_fs6.default.writeFileSync(versionFile, version3 ?? APP_VERSION, "utf8");\n      diagTrace("WRITEVER_DONE");\n    };'
);

fs.writeFileSync('data/serve/app_final4.js', code);
console.log('app_final4.js written');
