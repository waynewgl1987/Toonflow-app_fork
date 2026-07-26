import { serializeError } from "serialize-error";

// 防止未捕获的 Promise 拒绝杀死进程
process.on("unhandledRejection", (reason, promise) => {
  console.error("[未处理的 Promise 拒绝]");
  if (reason instanceof Error) {
    console.error("错误名称:", reason.name);
    console.error("错误消息:", reason.message);
    console.error("堆栈信息:", reason.stack);
    console.error("序列化详情:", JSON.stringify(serializeError(reason), null, 2));
  } else {
    console.error("原因:", reason);
    console.error("类型:", typeof reason);
    try {
      console.error("JSON:", JSON.stringify(reason, null, 2));
    } catch {
      console.error("(无法序列化)");
    }
  }
  console.error("Promise:", promise);
  // Node.js v15+ 默认会退出进程，但我们已经记录了错误，不主动退出
});

// 处理未捕获的异常（注册监听器后 Node.js 不会自动退出）
process.on("uncaughtException", (error, origin) => {
  console.error("[未捕获的异常]");
  console.error("origin:", origin);
  console.error("错误名称:", error.name);
  console.error("错误消息:", error.message);
  console.error("堆栈信息:", error.stack);
  console.error("序列化详情:", JSON.stringify(serializeError(error), null, 2));
});
