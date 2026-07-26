// Final diagnostic v3: trace INSIDE writeVersion_default to confirm execution
const fs = require('fs');
let code = fs.readFileSync('data/serve/app.js', 'utf8');
const traceFile = 'data/logs/final_trace3.log';

// Inject trace helper at module level
code = 'var diagTrace = function(msg) { try { require("fs").appendFileSync("' + traceFile.replace(/\\/g, '\\\\') + '", Date.now() + " " + msg + "\\n"); } catch(e) {} };\n' + code;

// Trace inside writeVersion_default function body
code = code.replace(
  'writeVersion_default = async (version3) => {',
  `writeVersion_default = async (version3) => {
      diagTrace('WRITEVER_ENTER');`
);

code = code.replace(
  'import_fs6.default.writeFileSync(versionFile, version3 ?? APP_VERSION, "utf8");',
  `diagTrace('WRITEVER_BEFORE_WRITE');
      import_fs6.default.writeFileSync(versionFile, version3 ?? APP_VERSION, "utf8");
      diagTrace('WRITEVER_AFTER_WRITE');`
);

// Also trace the closing of the function
code = code.replace(
  'writeVersion_default = async (version3) => {\n      diagTrace(\'WRITEVER_ENTER\');\n      const versionFile = import_path8.default.join(getPath_default(), "version.txt");\n      if (!import_fs6.default.existsSync(versionFile)) {\n        import_fs6.default.mkdirSync(import_path8.default.dirname(versionFile), { recursive: true });\n      }\n      diagTrace(\'WRITEVER_BEFORE_WRITE\');\n      import_fs6.default.writeFileSync(versionFile, version3 ?? APP_VERSION, "utf8");\n      diagTrace(\'WRITEVER_AFTER_WRITE\');',
  `writeVersion_default = async (version3) => {
      diagTrace('WRITEVER_ENTER');
      const versionFile = import_path8.default.join(getPath_default(), "version.txt");
      if (!import_fs6.default.existsSync(versionFile)) {
        import_fs6.default.mkdirSync(import_path8.default.dirname(versionFile), { recursive: true });
      }
      diagTrace('WRITEVER_BEFORE_WRITE');
      import_fs6.default.writeFileSync(versionFile, version3 ?? APP_VERSION, "utf8");
      diagTrace('WRITEVER_AFTER_WRITE');
      diagTrace('WRITEVER_RETURN');`
);

// Trace the await in startServe
code = code.replace(
  'await utils_default.writeVersion();',
  `diagTrace('BEFORE_await_writeVersion');
  await utils_default.writeVersion();
  diagTrace('AFTER_await_writeVersion');`
);

fs.writeFileSync('data/serve/app_final3.js', code);
console.log('app_final3.js written');
