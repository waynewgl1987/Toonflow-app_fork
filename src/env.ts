// 判断是否为打包后的 Electron 环境
const isElectron = typeof process.versions?.electron !== "undefined";
let isPackaged = false;
if (isElectron) {
  const { app } = require("electron");
  isPackaged = app.isPackaged;
}

//加载环境变量（打包环境默认使用 prod）
const env = process.env.NODE_ENV;
if (!env) {
  if (isElectron || process.env.PORT || process.env.OSSURL) {
    process.env.NODE_ENV = "prod";
    console.log(`[环境变量] prod (自动检测: ${isElectron ? "Electron" : "PORT/OSSURL 已设置"})`);
  } else {
    process.env.NODE_ENV = "dev";
    console.log(`[环境变量] dev`);
  }
}
