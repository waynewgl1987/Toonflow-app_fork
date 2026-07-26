/**
 * 生成进度追踪器
 * 跟踪每个图片/视频生成的实时进度，供前端轮询显示进度条
 */
import WebSocket from "ws";

// 进度存储
interface ProgressEntry {
  imageId: number;
  startTime: number;
  status: "queued" | "running" | "downloading" | "saving" | "done" | "error";
  /** ComfyUI 执行进度（如果通过 WebSocket 获取到） */
  comfyProgress?: { value: number; max: number };
  /** 上一次轮询时的 elapsed，用于前端计算百分比 */
  lastElapsed: number;
  /** 关联的 ComfyUI prompt_id */
  promptId?: string;
  error?: string;
}

const progressMap = new Map<number, ProgressEntry>();

// ComfyUI WebSocket 连接管理
let wsConnection: WebSocket | null = null;
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;

function connectComfyWs() {
  if (wsConnection?.readyState === WebSocket.OPEN) return;
  try {
    wsConnection = new WebSocket("ws://127.0.0.1:8188/ws");
    wsConnection.onopen = () => {
      console.log("[生成进度] ComfyUI WebSocket 已连接");
    };
    wsConnection.onmessage = (event) => {
      try {
        // ComfyUI WebSocket 可能发送二进制或文本消息
        let data: any;
        if (typeof event.data === "string") {
          data = JSON.parse(event.data);
        } else if (event.data instanceof Buffer || event.data instanceof ArrayBuffer) {
          // 二进制消息（如图像预览），忽略
          return;
        } else {
          // Blob 或其它，尝试解析
          return;
        }

        // 处理进度消息
        if (data.type === "progress") {
          const { value, max } = data.data || {};
          if (typeof value === "number" && typeof max === "number") {
            // 找到对应的进度条目（通过 prompt_id）
            for (const entry of progressMap.values()) {
              if (entry.status === "running" || entry.status === "queued") {
                entry.comfyProgress = { value, max };
                break;
              }
            }
          }
        } else if (data.type === "execution_start") {
          // 执行开始 - 更新状态
          for (const entry of progressMap.values()) {
            if (entry.status === "queued") {
              entry.status = "running";
              break;
            }
          }
        } else if (data.type === "execution_cached") {
          // 节点被缓存（快速完成）
        } else if (data.type === "execution_error") {
          // 执行错误
        }
      } catch (e) {
        // JSON 解析失败，忽略
      }
    };
    wsConnection.onclose = () => {
      console.log("[生成进度] ComfyUI WebSocket 断开，5秒后重连");
      wsConnection = null;
      wsReconnectTimer = setTimeout(connectComfyWs, 5000);
    };
    wsConnection.onerror = () => {
      // 连接错误，onclose 会触发重连
    };
  } catch (e) {
    // WebSocket 连接失败，稍后重试
    wsReconnectTimer = setTimeout(connectComfyWs, 10000);
  }
}

/** 注册一个生成任务开始 */
export function registerGeneration(imageId: number): void {
  if (!progressMap.has(imageId)) {
    progressMap.set(imageId, {
      imageId,
      startTime: Date.now(),
      status: "queued",
      lastElapsed: 0,
    });
    // 尝试连接 WebSocket（如果没连上）
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
      connectComfyWs();
    }
  }
}

/** 更新生成状态 */
export function updateGeneration(imageId: number, updates: Partial<ProgressEntry>): void {
  const entry = progressMap.get(imageId);
  if (entry) {
    Object.assign(entry, updates);
    entry.lastElapsed = Date.now() - entry.startTime;
  }
}

/** 移除生成记录 */
export function removeGeneration(imageId: number): void {
  progressMap.delete(imageId);
}

/** 获取单个生成进度 */
export function getGenerationProgress(imageId: number): ProgressEntry | undefined {
  const entry = progressMap.get(imageId);
  if (entry) {
    entry.lastElapsed = Date.now() - entry.startTime;
  }
  return entry;
}

/** 获取所有生成进度 */
export function getAllProgress(): Map<number, ProgressEntry> {
  // 清理超过 10 分钟的旧记录
  const now = Date.now();
  for (const [id, entry] of progressMap.entries()) {
    if (now - entry.startTime > 600000) {
      progressMap.delete(id);
    } else {
      entry.lastElapsed = now - entry.startTime;
    }
  }
  return progressMap;
}

/** 根据 imageId 列表获取进度 */
export function getProgressByIds(ids: number[]): Record<number, { elapsed: number; status: string; percent: number }> {
  const result: Record<number, { elapsed: number; status: string; percent: number }> = {};
  for (const id of ids) {
    const entry = progressMap.get(id);
    if (entry) {
      const elapsed = (Date.now() - entry.startTime) / 1000;
      let percent = 0;
      // 如果有 ComfyUI 进度，用它计算百分比
      if (entry.comfyProgress && entry.comfyProgress.max > 0) {
        percent = Math.round((entry.comfyProgress.value / entry.comfyProgress.max) * 100);
      } else if (entry.status === "downloading") {
        percent = 90;
      } else if (entry.status === "saving") {
        percent = 95;
      } else if (entry.status === "done") {
        percent = 100;
      } else if (entry.status === "error") {
        percent = -1;
      } else {
        // 无精确进度时，用 elapsed 估算（最多 85%）
        percent = Math.min(85, Math.round(elapsed / 3));
      }
      result[id] = { elapsed: Math.round(elapsed), status: entry.status, percent };
    }
  }
  return result;
}
