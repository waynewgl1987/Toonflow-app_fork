// Diagnostic v8: test writeFileSync vs writeFile, and also test if the fs module works
const fs = require('fs');
let code = fs.readFileSync('data/serve/app_diag6.js', 'utf8');

// Replace writeVersion to use writeFileSync instead
const oldBody = `writeVersion_default = async (version3) => {
      const versionFile = import_path8.default.join(getPath_default(), "version.txt");
      if (!import_fs6.default.existsSync(versionFile)) {
        import_fs6.default.mkdirSync(import_path8.default.dirname(versionFile), { recursive: true });
      }
      await import_fs6.default.promises.writeFile(versionFile, version3 ?? APP_VERSION, "utf8");
    }`;

const newBody = `writeVersion_default = async (version3) => {
      diag6Trace('WRITEVER_START');
      const baseDir = getPath_default();
      diag6Trace('WRITEVER_baseDir=' + baseDir);
      const versionFile = import_path8.default.join(baseDir, "version.txt");
      diag6Trace('WRITEVER_file=' + versionFile);
      
      // Test 1: check if import_fs6 exists
      diag6Trace('import_fs6=' + (typeof import_fs6));
      diag6Trace('import_fs6.default=' + (typeof import_fs6.default));
      diag6Trace('import_fs6.default.promises=' + (typeof import_fs6.default.promises));
      diag6Trace('import_fs6.default.writeFileSync=' + (typeof import_fs6.default.writeFileSync));
      
      // Test 2: Try writeFileSync first
      try {
        import_fs6.default.writeFileSync(versionFile, version3 ?? APP_VERSION, "utf8");
        diag6Trace('WRITEVER_writeFileSync_done');
      } catch(e) {
        diag6Trace('WRITEVER_writeFileSync_error=' + e.message);
      }
      
      // Test 3: Also try promises.writeFile
      diag6Trace('WRITEVER_before_writeFile');
      try {
        await import_fs6.default.promises.writeFile(versionFile, "test", "utf8");
        diag6Trace('WRITEVER_writeFile_done');
      } catch(e) {
        diag6Trace('WRITEVER_writeFile_error=' + e.message);
      }
    }`;

const result = code.replace(oldBody, newBody);
if (result === code) {
  console.log("WARNING: Replacement failed");
  process.exit(1);
}

// Also add writeFileSync test at module level
result.replace(
  'diag6Trace(\'MODULE_LEVEL\');',
  `diag6Trace('MODULE_LEVEL');
// Test module-level fs
var import_fs22 = __toESM(require("fs"));
diag6Trace('module_fs_promises=' + (typeof import_fs22.default.promises));
try {
  import_fs22.default.writeFileSync('data/version.txt', 'module_test', 'utf8');
  diag6Trace('module_writeFileSync_ok');
} catch(e) {
  diag6Trace('module_writeFileSync_err=' + e.message);
}`);

fs.writeFileSync('data/serve/app_diag8.js', result);
console.log("app_diag8.js written");
