// Final diagnostic v8: test if Promise resolution works at all in this context
var fs = require('fs');
var code = fs.readFileSync('data/serve/app.js', 'utf8');
var traceFile = 'data/logs/final_trace8.log';

// Inject trace helper
code = 'var diagTrace=function(m){try{require("fs").appendFileSync("'+traceFile.replace(/\\/g,'\\\\')+'",Date.now()+" "+m+"\\n")}catch(e){}};\ndiagTrace("MODULE_START");\n' + code;

// Replace the writeVersion call with a test of Promise resolution
code = code.split(
  'await utils_default.writeVersion();'
).join(
  'diagTrace("BEFORE_TEST_PROMISE");\n' +
  '  await new Promise(function(r) { diagTrace("PROMISE_CONSTRUCTOR"); r(); diagTrace("PROMISE_RESOLVED_SYNC"); }).then(function() { diagTrace("PROMISE_THEN_CALLED"); });\n' +
  '  diagTrace("AFTER_TEST_PROMISE");'
);

fs.writeFileSync('data/serve/app_final8.js', code);
console.log('app_final8.js written (' + code.length + ' bytes)');
