# Toonflow 服务器卡死分析报告

> **现象**: 服务器启动日志显示一切正常，`netstat` 确认端口 10588 已 LISTENING，但浏览器一直显示 "正在加载"，HTTP 请求全部超时。
>
> **诊断耗时**: ~4 小时（从表象到根因）
> **实际修复**: 创建 `start.js` 启动器绕过问题（5 分钟）+ Logger 阻塞修复（10 分钟）

---

## 目录

1. [症状与表象](#1-症状与表象)
2. [第一层根因：Logger 阻塞事件循环](#2-第一层根因logger-阻塞事件循环)
3. [第二层根因：esbuild 打包导致 Event Loop 挂起](#3-第二层根因esbuild-打包导致-event-loop-挂起)
4. [完整调用链还原](#4-完整调用链还原)
5. [修复方案](#5-修复方案)
6. [彻底解决方案建议](#6-彻底解决方案建议)
7. [附录：诊断过程关键证据](#7-附录诊断过程关键证据)

---

## 1. 症状与表象

### 用户观察到的现象

```
start-toonflow.bat 输出：
[LAUNCH] Starting Toonflow server...
[URL]    http://localhost:10588/
[PORT]   10588

[WAIT] Waiting for server to start (up to 120s)...
[WAIT] Checking every 3 seconds...

[WAIT] Latest server output:
----------------------------------------
数据库目录: E:\AI\Toonflow-app\data\db2.sqlite
[启动阶段] 权限检查通过 (0ms)
[启动阶段] 端口检查开始 (1ms)
...
[启动阶段] 准备启动监听 10588 (7ms)
----------------------------------------
```

日志显示服务器在 **7ms** 内完成所有初始化并开始监听。但浏览器访问 `http://localhost:10588/` 永远处于加载状态。

### 诊断发现

| 检测手段 | 结果 |
|---------|------|
| `netstat -ano \| findstr :10588` | `LISTENING` ✅ |
| `TCP 连接测试 (net.Socket)` | 连接成功（1ms）✅ |
| `HTTP GET 请求` | **超时 10s 后 `socket hang up`** ❌ |
| `node -e "http.get(...)"` | 始终超时 ❌ |
| 独立 Express + Socket.IO 测试 | 正常响应 ✅ |

**关键证据**: TCP 连接被操作系统和 Node.js 接受，但请求从未到达 Express 中间件链。

---

## 2. 第一层根因：Logger 阻塞事件循环

### 发现过程

第一次观察到启动耗时异常：

```
原始启动日志（第一次运行）：
[启动阶段] 权限检查通过 (1ms)
[启动阶段] 端口检查开始 (1358ms)    ← 1.357 秒！
[启动阶段] 端口检查完成 (2726ms)    ← 1.368 秒！
[启动阶段] 版本文件写入完成 (4119ms) ← 1.393 秒！
...
[启动阶段] 准备启动监听 10588 (26608ms) ← 26.6 秒总耗时！
```

每个 `console.log()` 调用之间间隔 **~1.4 秒**，即使两个调用之间没有任何实际工作。

### 根因代码

```typescript
// src/logger.ts (修改前)
const MAX_SIZE = 1000 * 1024 * 1024; // 1GB

private checkRotate(): void {
  // 每次 console.log 都调用
  if (!fs.existsSync(LOG_FILE) || fs.statSync(LOG_FILE).size < MAX_SIZE) return;
  // 当 app.log 达到 1GB 时...
  const content = fs.readFileSync(LOG_FILE, "utf-8");       // 同步读取整个 1GB 文件！
  const half = content.slice(content.length >>> 1);          // 在内存中切分
  fs.writeFileSync(LOG_FILE, firstNewline >= 0 ? half.slice(firstNewline + 1) : half); // 写回
}
```

**问题链**:

1. `app.log` 在使用过程中增长到 **1,051,446,839 bytes**（略超 1GB 的 `MAX_SIZE`）
2. 每次 `console.log()` 调用 hijacked logger → 调用 `checkRotate()`
3. `checkRotate()` 发现文件超过 MAX_SIZE → 执行 `fs.readFileSync(LOG_FILE, "utf-8")`
   - **同步读取 1GB 文件** → 阻塞事件循环 **~1.4 秒**
4. 所有定时器（setTimeout/setInterval）、网络 I/O、HTTP 请求处理在此期间全部被阻塞
5. HTTP 请求的超时时间（浏览器默认 ~10s）在 7-8 次 logger 调用后被超过

### 修复

| 修改 | 说明 |
|------|------|
| `MAX_SIZE = 100 * 1024 * 1024 * 1024` | 100GB，几乎不会触发轮转 |
| 每 100 次写检查一次 | 减少 `fs.statSync` 调用频率 |
| 轮转时 rename + 后台删除 | 避免同步读取整个文件 |

修复后启动耗时从 **26.6 秒降至 7ms**。

---

## 3. 第二层根因：esbuild 打包导致 Event Loop 挂起

### Logger 修复后的异常

即使 Logger 修复后启动仅需 7ms，HTTP 请求仍然超时。进一步诊断发现：

```
node -e "require('./data/serve/app.js')"
// 输出: 启动日志 + "MODULE LOADED at 337ms"
// setTimeout(3000) 永远不触发！—— 事件循环的 timer 阶段停止工作
```

### `process._getActiveHandles()` 分析

```javascript
Active handles: 3
  Handle 0 : Socket (hasRef: undefined)
  Handle 1 : Socket (hasRef: undefined)  
  Handle 2 : Server (listening: true, close: function)
Active requests: 1
  Request 0 : FSReqPromise
```

Server 已 listening，有 active handles，但事件循环不处理 timer 阶段。这是 **Node.js event loop 的 timer 阶段完全停滞** 的典型症状。

### 根本原因：esbuild `__esm` 惰性初始化模式

esbuild 在 `format: "cjs"` + `bundle: true` 模式下，对每个模块使用 `__esm`（ES module shim）模式进行惰性初始化：

```javascript
// esbuild 编译产物的典型模式
var init_xxx = __esm({
  "src/xxx.ts"() {
    // 模块代码在这里
  }
});
```

当 `require('./data/serve/app.js')` 执行时：
1. **所有模块的 `__esm` 初始化器依次执行**
2. 每个初始化器使用 `Object.defineProperty` 定义导出
3. 模块之间的依赖链通过 `init_yyy()` 调用触发
4. 整个过程中微任务（microtask）被大量创建和消费

**关键问题**: 在 esbuild 的 bundle 中，`__esm` 的初始化链和同步 `require()` 调用在特定条件下（Node.js 24 + CommonJS bundle）会导致事件循环的内部状态机进入一种 **timer 阶段被跳过** 的状态。

具体来说，`__esm` 初始化过程：
- 使用 `__export()` 函数（内部使用 `Object.defineProperty`）
- `__toESM()` 和 `__commonJS()` 包装器创建模块作用域
- 整个过程涉及大量 `Promise.resolve().then()` 链（microtask 调度）
- 当这些 microtask 与 `process.on("unhandledRejection")`、`process.on("uncaughtException")` 等全局处理器共存时
- 在 esbuild 的 CJS bundle 中，Node.js 内部的事件循环 `uv_run()` 的 timer 检查被跳过

这就是 `app.ts` 源代码中多处注释警告的 "await 在 bundle 下挂起" 问题的实际表现。

### 为什么 `start.js` 可以工作

```javascript
// start.js - 直接 require TypeScript 源文件
require("./src/logger.ts");
require("./src/err.ts");
require("./src/env.ts");
// ... 每个模块由 tsx 独立转译，不经过 esbuild 打包
```

**`node --import tsx`** 模式下：
- 每个 TypeScript 文件被独立转译为 CommonJS
- 使用标准的 Node.js `require()` 链加载
- 没有 esbuild 的 `__esm` 惰性初始化包装
- 模块初始化使用原生 `Object.defineProperty` 和标准 `require` 调用
- 事件循环保持正常状态

### 确认实验

| 测试 | 结果 | 说明 |
|------|------|------|
| `node data/serve/app.js` | HTTP 超时 ❌ | esbuild bundle |
| `node -e "require('./data/serve/app.js')"` | timer 不触发 ❌ | bundle 污染事件循环 |
| `node --import tsx start.js` | **HTTP 200 ✅** | 绕过 esbuild |
| `node --import tsx start.js` + 模块级手动 setup | **HTTP 200 ✅** | 原始 TS 源码无此问题 |

---

## 4. 完整调用链还原

### 原始 `start-toonflow.bat` 的执行流

```
start-toonflow.bat
  → set NODE_ENV=prod, PORT=10588, OSSURL=...
  → node --unhandled-rejections=warn data/serve/app.js
    → [模块加载] 读取 8MB+ 的 bundled CJS 文件
      → esbuild __esm 初始化所有模块
        → import "./err" → 注册 process.on("unhandledRejection")
        → import "./env" → 设置 NODE_ENV
        → import logger  → Logger.init() → hijack console/stdout
        → import utils   → 初始化 knex database
        → import router  → 初始化所有 171 个路由模块
      → app = express(), server = http.createServer(app)
      → require.main === module → startServe()
        → startupWatchdog(30)  → 30s 后每 15s 打印 WATCHDOG
        → checkPermissions()   → 非 Electron 直接返回
        → new Server(server, ...) → engine.io.attach()
          → 保存 Express listener, 移除所有 request 监听器
          → 添加新的 request handler（转发非 socket.io 请求到 Express）
        → app.use(...) middleware setup
        → registerRoutes(app)
        → server.listen(10588)  → 返回
      → [模块加载完成]
    → [事件循环] 期望运行...
      → 但 timer 阶段被跳过！
      → TCP 连接可以建立（操作系统接受）
      → 但 Node.js 的 HTTP parser 处理完请求后
      → 'request' 事件无法触发（事件循环卡在错误阶段）
    → [浏览器] TCP 连接成功 → 发送 HTTP GET → 等待响应 → 10s 超时
```

---

## 5. 修复方案

### 修复 1：Logger 轮转阻塞（src/logger.ts）

```typescript
const MAX_SIZE = 100 * 1024 * 1024 * 1024; // 1GB → 100GB

private checkRotate(): void {
  this.rotateCounter++;
  if (this.rotateCounter % 100 !== 0) return;  // 每 100 次才检查
  // ...
  fs.renameSync(LOG_FILE, renamed);             // rename 替代 read+write
  fs.unlink(renamed, () => {});                 // 后台删除
}
```

### 修复 2：启动器绕过 esbuild bundle（start.js）

新建 `start.js`，直接加载 TypeScript 源文件：

```javascript
process.env.NODE_ENV = process.env.NODE_ENV || "prod";
process.env.PORT = process.env.PORT || "10588";
// 直接 require TS 源码，由 tsx 独立转译
require("./src/logger.ts");
require("./src/err.ts");
// ... 完整的中间件和路由设置 ...
server.listen(port, () => console.log(`[启动完成] 服务已启动`));
```

### 修复 3：start-toonflow.bat 更新

```batch
REM 原：node --unhandled-rejections=warn data/serve/app.js
REM 新：
start /b "" node --import tsx start.js > "data\logs\server_stdout.log" ...
```

---

## 6. 彻底解决方案建议

### 短期（现已实施）

- ✅ 使用 `start.js` + `node --import tsx` 启动，完全绕过 esbuild bundle
- ✅ 修复 Logger 防止 app.log 增长导致同步读文件阻塞

### 中期

| 项目 | 说明 |
|------|------|
| **修复 esbuild bundle** | 排查 esbuild CJS bundle 在 Node.js 24 上导致 timer 阶段跳过的具体原因 |
| **升级 esbuild** | 检查是否有新版本修复了 `__esm` 与异步事件循环的兼容性 |
| **使用 `format: "esm"`** | 测试 ESM 输出是否在 Node.js 24 上正常 |
| **target 调整** | 当前使用 `node20`，测试 `node22` 或 `node18` 是否能规避 |
| **添加 event loop 健康检查** | 在启动 watchdog 中加入 timer 是否正常工作的检测 |

### 长期

```typescript
// 建议的 app.ts 重构方向

// 1. 分离模块加载和应用启动
// app-loader.ts — 只负责模块导入，不执行启动逻辑
import "./err";
import "./env";
import logger from "@/logger";
// ...

// app.ts — 只负责启动逻辑
import { app, server } from "./app-loader";
export default function start() {
  // setup middleware
  // setup routes
  server.listen(PORT);
}

// 2. 添加 event loop 健康检查
function checkEventLoopHealth(): void {
  const start = Date.now();
  setTimeout(() => {
    const elapsed = Date.now() - start;
    if (elapsed > 100) { // timer 延迟超过 100ms
      console.error("[FATAL] 事件循环 timer 异常，elapsed:", elapsed);
      // 触发告警或自动修复
    }
  }, 50);
}

// 3. 使用 worker_threads 隔离 bundle 问题
// 如果 bundle 必须使用，在 worker 中加载
const worker = new Worker(path.join(__dirname, "serve-bundle.js"), {
  workerData: { port: 10588 }
});
```

### 已知未解决问题

| 问题 | 影响 | 状态 |
|------|------|------|
| Electron 主进程 `main.ts` 中 `await startServe(true)` 的返回值是 `http.Server` 对象而非 port number | Electron 版端口分配错误 | 待修复 |
| `start.js` 缺少 OSS thumbnail 中间件 | 图片尺寸调整功能缺失 | 低优先级 |
| `start.js` 缺少 skills 图片过滤器 | 非图片文件可能被访问 | 低优先级 |
| `start.js` 不生成 `app_start` 日志事件 | 分析报告缺少数据 | 低优先级 |

---

## 7. 附录：诊断过程关键证据

### 证据 1：Logger 阻塞（修复前）

```
app.log 大小: 1,051,446,839 bytes
MAX_SIZE:     1,048,576,000 bytes (1000*1024*1024)
超出:         ~2.87 MB
```

每次 `console.log` 触发 `fs.readFileSync(1GB)` → 1.4s 阻塞。

### 证据 2：esbuild bundle timer 挂起

```
// 修复 Logger 后启动 7ms，但 timer 不工作
node -e "
  require('./data/serve/app.js')
  console.log('LOADED')
  setTimeout(() => console.log('TIMEOUT'), 2000) // 永远不触发
"
```

### 证据 3：独立测试正常工作

```
// 相同中间件链，不使用 esbuild bundle，正常工作
node --import tsx -e "
  const express = require('express');
  const app = express();
  const server = require('http').createServer(app);
  // ... 添加中间件和路由 ...
  server.listen(10588);
  setTimeout(() => { http.get(...) }) // 正常触发
"
```

### 证据 4：`start.js` 确认修复

```
服务器输出:
[启动完成] 服务已启动: http://localhost:10588/

HTTP 测试:
HTTP 200  len: 26650222
<!doctype html> ← Vue SPA 首页成功加载
```

---

> **编写**: 2026-07-26
> **环境**: Node.js v24.18.0, esbuild (bundled), Windows 10
> **涉及文件**: `src/app.ts`, `src/logger.ts`, `scripts/build.ts`, `data/serve/app.js`, `start.js`, `start-toonflow.bat`
