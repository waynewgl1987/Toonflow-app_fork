// Diagnostic v10b: Fix the fs reference - use require('fs') directly
const fs = require('fs');
let code = fs.readFileSync('data/serve/app.js', 'utf8');

const traceFile = 'data/logs/diag10b_trace.log';

// Add diag10 helper at module level 
code = code.replace(
  'var utils_default;',
  `var utils_default;

// DIAG10B: test fs.promises early
var diag10bTrace = function(msg) {
  try { require('fs').appendFileSync('${traceFile}', Date.now() + ' ' + msg + '\\n'); } catch(e) {}
};

// Test writeFile at module level before any init
async function diag10bTestWrite() {
  try {
    diag10bTrace('BEFORE_early_writeFile');
    var testFs = require('fs');
    diag10bTrace('fs_promises_type=' + (typeof testFs.promises));
    await testFs.promises.writeFile('data/diag10b_test.txt', 'early_test', 'utf8');
    diag10bTrace('AFTER_early_writeFile');
  } catch(e) {
    diag10bTrace('early_writeFile_error=' + e.message);
  }
}
diag10bTestWrite();

// Test setTimeout at module level
setTimeout(function() {
  diag10bTrace('MODULE_TIMEOUT_FIRED');
}, 100);
`
);

// Add diag10b trace inside writeVersion
code = code.replace(
  'await import_fs6.default.promises.writeFile(versionFile, version3 ?? APP_VERSION, "utf8");',
  `diag10bTrace('BEFORE_late_writeFile');
  try {
    await import_fs6.default.promises.writeFile(versionFile, version3 ?? APP_VERSION, "utf8");
    diag10bTrace('AFTER_late_writeFile');
  } catch(e) {
    diag10bTrace('late_writeFile_error=' + e.message);
  }
  diag10bTrace('writeFile_completed');`
);

fs.writeFileSync('data/serve/app_diag10b.js', code);
console.log("app_diag10b.js written");

// Verify
var verify = fs.readFileSync('data/serve/app_diag10b.js', 'utf8');
if (verify.indexOf('diag10bTrace') > 0) {
  console.log("Verified: diag10bTrace found in output");
} else {
  console.log("ERROR: diag10bTrace NOT found in output");
}
