// Test: does setImmediate work inside startServe?
var fs = require('fs');
var code = fs.readFileSync('data/serve/app.js', 'utf8');
var traceFile = 'data/logs/diag_si.log';
var tp = traceFile.replace(/\\/g,'\\\\');

// Inject trace helper
code = 'var diagTrace=function(m){try{require("fs").appendFileSync("'+tp+'",Date.now()+" "+m+"\\n")}catch(e){}};\n' + code;

// Test setImmediate inside startServe after port check
// Find: phase("端口检查完成") which is '\u7AEF\u53E3\u68C0\u67E5\u5B8C\u6210'
// But we can find the ASCII part: phase("
var marker = 'phase("';
var encoded = '\\u7AEF\\u53E3\\u68C0\\u67E5\\u5B8C\\u6210';
var portCheckDone = 'phase("' + encoded + '");';

// Replace this line with a version that tests setImmediate
code = code.replace(
  portCheckDone,
  portCheckDone + '\n  setImmediate(function() { require("fs").appendFileSync("' + tp + '",Date.now()+" SETIMMEDIATE_FIRED\\n"); });\n  require("fs").appendFileSync("' + tp + '",Date.now()+" BEFORE_SETIMMEDIATE\\n");'
);

// Also test setTimeout
code = code.replace(
  '  await utils_default.writeVersion();',
  '  setTimeout(function() { require("fs").appendFileSync("' + tp + '",Date.now()+" TIMEOUT_FIRED\\n"); }, 100);\n  require("fs").appendFileSync("' + tp + '",Date.now()+" BEFORE_TIMEOUT\\n");\n  await utils_default.writeVersion();'
);

fs.writeFileSync('data/serve/app_diag_si.js', code);
console.log('app_diag_si.js written');
