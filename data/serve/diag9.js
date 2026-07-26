// Diagnostic v9: Test fs.promises vs direct fs.promises, and also test thread pool
const fs = require('fs');
let code = fs.readFileSync('data/serve/app_diag6.js', 'utf8');

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
      const versionFile = import_path8.default.join(baseDir, "version.txt");
      diag6Trace('WRITEVER_file=' + versionFile);
      
      // Use direct require fs.promises.writeFile
      diag6Trace('TEST_direct_require_fs_promises');
      var directFs = require('fs');
      diag6Trace('TEST_direct_fs_type=' + (typeof directFs));
      diag6Trace('TEST_direct_fs_promises_type=' + (typeof directFs.promises));
      
      // Try direct fs.promises.writeFile
      diag6Trace('TEST_before_direct_writeFile');
      try {
        await directFs.promises.writeFile(versionFile, "direct_test", "utf8");
        diag6Trace('TEST_direct_writeFile_done');
      } catch(e) {
        diag6Trace('TEST_direct_writeFile_error=' + e.message);
      }
      
      // Now try import_fs6 writeFile
      diag6Trace('TEST_before_import_fs6_writeFile');
      try {
        await import_fs6.default.promises.writeFile(versionFile, "import_test", "utf8");
        diag6Trace('TEST_import_fs6_writeFile_done');
      } catch(e) {
        diag6Trace('TEST_import_fs6_writeFile_error=' + e.message);
      }
      
      // Fallback: use writeFileSync
      import_fs6.default.writeFileSync(versionFile, version3 ?? APP_VERSION, "utf8");
      diag6Trace('WRITEVER_fallback_done');
      
      // Test: what does process._getActiveHandles() show?
      diag6Trace('ACTIVE_REQUESTS=' + (process._getActiveRequests ? process._getActiveRequests().length : 'na'));
      diag6Trace('ACTIVE_HANDLES=' + (process._getActiveHandles ? process._getActiveHandles().length : 'na'));
    }`;

const result = code.replace(oldBody, newBody);
if (result === code) {
  console.log("FAILED: replacement did not match");
  process.exit(1);
}

fs.writeFileSync('data/serve/app_diag9.js', result);
console.log("app_diag9.js written");
