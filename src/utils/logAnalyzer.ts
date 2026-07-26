/**
 * 日志分析器 - 自动分析生成日志，定位问题根因
 */
import fs from "fs";
import path from "path";
import getPath from "@/utils/getPath";

interface LogEntry {
  time: string;
  event: string;
  [key: string]: any;
}

interface AnalysisResult {
  summary: string;
  status: "ok" | "warn" | "error";
  sessionCount: number;
  errors: { time: string; event: string; message: string; suggestion: string }[];
  warnings: { time: string; event: string; message: string }[];
  services: { qwen3: string; comfyui: string };
  timeline: { time: string; step: string; status: string }[];
  suggestions: string[];
}

const SUGGESTIONS: Record<string, string[]> = {
  "未找到供应商配置": ["模型供应商未配置 → 去 设置→模型服务 添加供应商并填写API Key"],
  "供应商配置不存在": ["同上的供应商配置问题"],
  "Loading model": ["Qwen3 模型还在加载中 → 等待 1-2 分钟后再试", "或模型文件损坏 → 重新下载GGUF文件"],
  "EADDRINUSE": ["端口被占用 → 先用 Stop All 停止所有服务再启动"],
  "Failed to fetch": ["后端服务未启动 → 双击 start-toonflow.bat 启动"],
  "timeout": ["服务启动超时 → 手动检查 Qwen3/ComfyUI 是否正常运行"],
  "ECONNREFUSED": ["目标服务未启动 → 确认端口对应服务已运行"],
  "Out of memory": ["显存/内存不足 → 降低模型参数或关闭其他程序"],
  "socket hang up": ["连接中断 → 检查网络或服务是否崩溃"],
  "retry": ["AI 调用重试失败 → 检查模型服务状态"],
  "getaddrinfo": ["DNS 解析失败 → 检查网络连接或 API 地址配置"],
  "Unauthorized": ["API Key 无效 → 检查设置中的 API Key"],
  "401": ["认证失败 → API Key 可能过期或错误"],
  "402": ["账户余额不足 → API 服务需要充值"],
  "429": ["请求太频繁 → 稍等片刻重试"],
  "500": ["服务端错误 → 检查模型服务 Provider 是否正常"],
};

function readLogs(): LogEntry[] {
  const logDir = getPath("logs");
  if (!fs.existsSync(logDir)) return [];
  const files = fs.readdirSync(logDir)
    .filter(f => f.startsWith("generation-") && f.endsWith(".log"))
    .sort()
    .reverse();
  if (files.length === 0) return [];
  const content = fs.readFileSync(path.join(logDir, files[0]), "utf-8");
  return content.trim().split("\n")
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean) as LogEntry[];
}

function extractErrorMsg(entry: LogEntry): string {
  return entry.error || entry.message || entry.reason || "";
}

function matchSuggestion(errorMsg: string): string[] {
  const results: string[] = [];
  for (const [keyword, suggestions] of Object.entries(SUGGESTIONS)) {
    if (errorMsg.includes(keyword)) {
      results.push(...suggestions);
    }
  }
  return results;
}

export function analyze(): AnalysisResult {
  const entries = readLogs();
  if (entries.length === 0) {
    return {
      summary: "暂无日志记录，请先进行一次项目生成",
      status: "warn",
      sessionCount: 0,
      errors: [],
      warnings: [],
      services: { qwen3: "unknown", comfyui: "unknown" },
      timeline: [],
      suggestions: [],
    };
  }

  // 统计 session（按 app_start 分隔）
  const sessionStarts = entries.filter(e => e.event === "app_start");
  const sessionCount = sessionStarts.length;

  // 收集错误
  const errors: AnalysisResult["errors"] = [];
  const warnings: AnalysisResult["warnings"] = [];

  for (const entry of entries) {
    const evt = entry.event || "";
    const errMsg = extractErrorMsg(entry);

    if (evt.includes("error") || evt.includes("fail") || evt.includes("timeout")) {
      const suggestions = matchSuggestion(errMsg);
      errors.push({
        time: entry.time || "?",
        event: evt,
        message: errMsg || entry.stack?.slice(0, 100) || "未知错误",
        suggestion: suggestions.length > 0 ? suggestions.join("；") : "请查看详细日志",
      });
    } else if (evt.includes("warn")) {
      warnings.push({ time: entry.time, event: evt, message: errMsg });
    }
  }

  // 服务状态
  const lastQwen3 = entries.filter(e => e.event === "startup_port_status" && e.service === "Qwen3").pop();
  const lastComfy = entries.filter(e => e.event === "startup_port_status" && e.service === "ComfyUI").pop();
  const services = {
    qwen3: lastQwen3?.status === "in_use" ? "running" : "stopped",
    comfyui: lastComfy?.status === "in_use" ? "running" : "stopped",
  };

  // 时间线摘要
  const keyEvents = ["app_start", "app_listening", "svc_auto_start", "svc_auto_started", "svc_auto_timeout",
    "svc_auto_stop_conflict", "text_invoke_start", "text_invoke_success", "text_invoke_error",
    "image_run_start", "image_run_success", "image_run_error",
    "video_run_start", "video_run_success", "video_run_error",
    "scriptAgent_start", "productionAgent_start", "stream_complete", "stream_error",
    "event_generate_start", "event_generate_launched", "project_create",
    "ai_call_start", "ai_call_success", "ai_call_error"];

  const timeline = entries
    .filter(e => keyEvents.includes(e.event))
    .map(e => ({
      time: e.time || "",
      step: e.event,
      status: e.event.includes("error") || e.event.includes("timeout") ? "error"
        : e.event.includes("success") || e.event.includes("complete") || e.event.includes("listening") ? "ok"
        : "info",
    }));

  // 总体状态判断
  let status: "ok" | "warn" | "error" = "ok";
  const hasError = errors.length > 0;
  const hasTimeout = entries.some(e => e.event === "svc_auto_timeout");

  if (hasError) status = "error";
  else if (hasTimeout) status = "warn";

  // 总结
  const errorCount = errors.length;
  const successCount = entries.filter(e => e.event?.includes("success") || e.event === "stream_complete").length;
  const summaries: string[] = [];
  if (sessionCount > 0) summaries.push(`共 ${sessionCount} 次启动`);
  if (errorCount > 0) summaries.push(`${errorCount} 个错误`);
  if (successCount > 0) summaries.push(`${successCount} 个成功步骤`);
  if (hasTimeout) summaries.push("存在服务启动超时");

  // 建议
  const suggestions: string[] = [];
  for (const err of errors) {
    if (err.suggestion && !suggestions.includes(err.suggestion)) {
      suggestions.push(err.suggestion);
    }
  }
  if (errors.length === 0 && warnings.length === 0) {
    if (services.qwen3 === "stopped") suggestions.push("Qwen3 未启动，文本生成前会自动启动");
    if (services.comfyui === "stopped") suggestions.push("ComfyUI 未启动，图片/视频生成前会自动启动");
  }

  const summary = summaries.length > 0 ? summaries.join("，") : "运行正常";

  // 有错误时自动保存分析报告
  if (errors.length > 0 || warnings.length > 0) {
    try { saveReport(); } catch {}
  }

  return { summary, status, sessionCount, errors, warnings, services, timeline, suggestions };
}

/** 自动保存分析报告到 log 目录（有错误时自动触发） */
export function saveReport(): void {
  try {
    const r = analyze();
    const logDir = getPath("logs");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const reportPath = path.join(logDir, `analysis-${new Date().toISOString().slice(0, 10)}.log`);

    // 如果已有今日报告，合并
    let existing = "";
    if (fs.existsSync(reportPath)) {
      existing = fs.readFileSync(reportPath, "utf-8");
    }

    const report = `[${new Date().toLocaleString()}]
Status: ${r.status}
${r.summary}
Errors: ${r.errors.length} | Sessions: ${r.sessionCount}
Qwen3: ${r.services.qwen3} | ComfyUI: ${r.services.comfyui}
${r.errors.length > 0 ? "\nErrors:\n" + r.errors.map(e => `  [${e.time}] ${e.event}: ${e.message.slice(0, 80)}`).join("\n") : ""}
${r.suggestions.length > 0 ? "\nSuggestions:\n" + r.suggestions.map(s => `  - ${s}`).join("\n") : ""}
---\n`;

    fs.writeFileSync(reportPath, report + existing);
  } catch (e) {
    // 静默失败，不影响主流程
  }
}

// 直接输出分析报告
export function printReport(): string {
  const r = analyze();
  const lines: string[] = [];
  lines.push("=".repeat(50));
  lines.push(`LOG ANALYSIS REPORT`);
  lines.push("=".repeat(50));
  lines.push(`Status: ${r.status}`);
  lines.push(`Summary: ${r.summary}`);
  lines.push(`Sessions: ${r.sessionCount}`);
  lines.push(`Qwen3: ${r.services.qwen3} | ComfyUI: ${r.services.comfyui}`);
  lines.push("");

  if (r.timeline.length > 0) {
    lines.push("--- Timeline ---");
    for (const t of r.timeline) {
      const icon = t.status === "error" ? "✗" : t.status === "ok" ? "✓" : "→";
      lines.push(`  ${icon} ${t.time.slice(11, 22)} ${t.step}`);
    }
    lines.push("");
  }

  if (r.errors.length > 0) {
    lines.push("--- Errors ---");
    for (const e of r.errors) {
      lines.push(`  [${e.time}] ${e.event}: ${e.message.slice(0, 100)}`);
      if (e.suggestion) lines.push(`    Fix: ${e.suggestion}`);
    }
    lines.push("");
  }

  if (r.suggestions.length > 0) {
    lines.push("--- Suggestions ---");
    for (const s of r.suggestions) lines.push(`  - ${s}`);
    lines.push("");
  }

  lines.push("=".repeat(50));
  return lines.join("\n");
}
