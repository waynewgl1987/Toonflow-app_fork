// Final diagnostic v7: replace async writeVersion with sync + explicit Promise
var fs = require('fs');
var code = fs.readFileSync('data/serve/app.js', 'utf8');
var traceFile = 'data/logs/final_trace7.log';

// Inject trace helper
code = 'var diagTrace=function(m){try{require("fs").appendFileSync("'+traceFile.replace(/\\/g,'\\\\')+'",Date.now()+" "+m+"\\n")}catch(e){}};\ndiagTrace("MODULE_START");\n' + code;

// Replace writeVersion_default: keep sync body but add explicit Promise return
code = code.split(
  'writeVersion_default = async (version3) => {'
).join(
  'writeVersion_default = async (version3) => { diagTrace("WRITEVER_ENTER");'
);

code = code.split(
  'import_fs6.default.writeFileSync(versionFile, version3 ?? APP_VERSION, "utf8");'
).join(
  'import_fs6.default.writeFileSync(versionFile, version3 ?? APP_VERSION, "utf8");\n      diagTrace("WRITEVER_WRITE_DONE");\n      return Promise.resolve();'
);

// Trace the caller side
code = code.split(
  'await utils_default.writeVersion();'
).join(
  'diagTrace("BEFORE_AWAIT");\n  await utils_default.writeVersion();\n  diagTrace("AFTER_AWAIT");'
);

fs.writeFileSync('data/serve/app_final7.js', code);
console.log('app_final7.js written (' + code.length + ' bytes)');
