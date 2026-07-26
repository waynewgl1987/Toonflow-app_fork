// Diagnostic v7: Replace writeVersion with a traced version
const fs = require('fs');
let code = fs.readFileSync('data/serve/app_diag6.js', 'utf8');

// Replace the writeVersion function body with a traced version
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
      if (!import_fs6.default.existsSync(versionFile)) {
        diag6Trace('WRITEVER_dir_not_exist');
        import_fs6.default.mkdirSync(import_path8.default.dirname(versionFile), { recursive: true });
        diag6Trace('WRITEVER_dir_created');
      } else {
        diag6Trace('WRITEVER_dir_exists');
      }
      diag6Trace('WRITEVER_before_writeFile');
      try {
        await import_fs6.default.promises.writeFile(versionFile, version3 ?? APP_VERSION, "utf8");
        diag6Trace('WRITEVER_writeFile_done');
      } catch(e) {
        diag6Trace('WRITEVER_writeFile_error=' + e.message);
      }
    }`;

code = code.replace(oldBody, newBody);
if (code === fs.readFileSync('data/serve/app_diag6.js', 'utf8')) {
  console.log("WARNING: Replacement failed - no changes detected");
  process.exit(1);
}

fs.writeFileSync('data/serve/app_diag7.js', code);
console.log("app_diag7.js written successfully");
