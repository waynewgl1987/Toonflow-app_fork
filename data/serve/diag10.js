// Diagnostic v10: Test if knex/db init causes fs.promises.writeFile to hang
// by testing writeFile BEFORE and AFTER the db module init
const fs = require('fs');
let code = fs.readFileSync('data/serve/app.js', 'utf8');

const traceFile = 'data/logs/diag10_trace.log';

// Add diag10 helper at module level (BEFORE any module init)
// Find the module-level code where we can inject
code = code.replace(
  'var utils_default;',
  `var utils_default;

// DIAG10: test fs.promises early
var diag10Trace = function(msg) {
  try { fs.appendFileSync('${traceFile}', Date.now() + ' ' + msg + '\\n'); } catch(e) {}
};

// Test writeFile at module level before any init
async function diag10TestWrite() {
  try {
    diag10Trace('BEFORE_early_writeFile');
    var testFs = require('fs');
    diag10Trace('fs_promises_type=' + (typeof testFs.promises));
    await testFs.promises.writeFile('data/diag10_test.txt', 'early_test', 'utf8');
    diag10Trace('AFTER_early_writeFile');
  } catch(e) {
    diag10Trace('early_writeFile_error=' + e.message);
  }
}
diag10TestWrite();

// Test setTimeout at module level
setTimeout(function() {
  diag10Trace('MODULE_TIMEOUT_FIRED');
}, 100);
`
);

// Add diag10 trace inside writeVersion
code = code.replace(
  'await import_fs6.default.promises.writeFile(versionFile, version3 ?? APP_VERSION, "utf8");',
  `diag10Trace('BEFORE_late_writeFile');
  try {
    await import_fs6.default.promises.writeFile(versionFile, version3 ?? APP_VERSION, "utf8");
    diag10Trace('AFTER_late_writeFile');
  } catch(e) {
    diag10Trace('late_writeFile_error=' + e.message);
  }
  diag10Trace('writeFile_completed');`
);

fs.writeFileSync('data/serve/app_diag10.js', code);
console.log("app_diag10.js written");
