// Final diag v11: test .then() INSIDE startServe vs module level
var fs = require('fs');
var code = fs.readFileSync('data/serve/app.js', 'utf8');
var traceFile = 'data/logs/final_trace11.log';
var tp = traceFile.replace(/\\/g,'\\\\');

// Inject trace helper
code = 'var diagTrace=function(m){try{require("fs").appendFileSync("'+tp+'",Date.now()+" "+m+"\\n")}catch(e){}};\n' + code;

// Test 1: Module-level .then() 
code = 'new Promise(function(r){r();}).then(function(){require("fs").appendFileSync("'+tp+'",Date.now()+" MODULE_THEN_OK\\n");});\n' + code;

// Test 2: Inside startServe, add a .then() test BEFORE writeVersion
code = code.split(
  '  phase("端口检查完成");'
).join(
  '  phase("端口检查完成");\n' +
  '  new Promise(function(r){require("fs").appendFileSync("'+tp+'",Date.now()+" INSIDE_THEN_CONSTRUCTOR\\n");r();}).then(function(){require("fs").appendFileSync("'+tp+'",Date.now()+" INSIDE_THEN_CALLBACK\\n");});\n' +
  '  require("fs").appendFileSync("'+tp+'",Date.now()+" INSIDE_AFTER_THEN_SETUP\\n");'
);

// Add module-level Promise test delay 
// Also move startServe call to test if the issue is timing related

fs.writeFileSync('data/serve/app_diag11.js', code);
console.log('app_diag11.js written (' + code.length + ' bytes)');
