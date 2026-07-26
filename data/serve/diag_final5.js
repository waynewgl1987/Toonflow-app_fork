// Final diagnostic v5: Test .then() vs await for writeVersion
const fs = require('fs');
let code = fs.readFileSync('data/serve/app.js', 'utf8');
const traceFile = 'data/logs/final_trace5.log';

// Inject trace helper
code = 'var diagTrace = function(msg) { try { require("fs").appendFileSync("' + traceFile.replace(/\\/g, '\\\\') + '", Date.now() + " " + msg + "\\n"); } catch(e) {} };\ndiagTrace("MODULE_START");\n';

// Replace the blocking await with .then() pattern
code = code.replace(
  'await utils_default.writeVersion();',
  `utils_default.writeVersion().then(function() {
  diagTrace("AFTER_writeVersion_THEN");
}).catch(function(e) {
  diagTrace("writeVersion_ERROR=" + e.message);
});
diagTrace("writeVersion_FIRED");`
);

// Trace inside writeVersion_default
code = code.replace(
  'import_fs6.default.writeFileSync(versionFile, version3 ?? APP_VERSION, "utf8");',
  `import_fs6.default.writeFileSync(versionFile, version3 ?? APP_VERSION, "utf8");
      diagTrace("WRITEVER_DONE");`
);

fs.writeFileSync('data/serve/app_final5.js', code);
console.log('app_final5.js written');
