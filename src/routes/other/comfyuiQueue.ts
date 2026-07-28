import express from "express";
import http from "http";
import { success, error } from "@/lib/responseFormat";

const router = express.Router();

// 全局缓存: prompt_id → { text, time }
const promptCache = new Map<string, { text: string; time: number }>();
// 首次出现时间（不会随刷新重置）
const firstSeen = new Map<string, number>();

// 暴露注册接口：被其他模块调用
export function registerPrompt(promptId: string, text: string) {
  promptCache.set(promptId, { text: text.slice(0, 80), time: Date.now() });
}

function comfyRequest(method: string, path: string, body?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port: 8188, path, method, timeout: 5000,
        headers: { "Content-Type": "application/json" } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            if (res.statusCode && res.statusCode >= 400) resolve({ _err: `HTTP ${res.statusCode}` });
            else resolve(data ? JSON.parse(data) : {});
          } catch { resolve({ _err: "parse_error" }); }
        });
      }
    );
    req.on("error", (e) => reject(e));
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// POST /api/other/comfyuiQueue/register — 注册 prompt 文本
router.post("/register", async (req, res) => {
  const { promptId, text } = req.body || {};
  if (promptId && text) {
    promptCache.set(String(promptId), { text: String(text).slice(0, 80), time: Date.now() });
    res.send(success({ ok: true }));
  } else {
    res.send(error("缺少 promptId 或 text"));
  }
});

// GET /api/other/comfyuiQueue
router.get("/", async (_req, res) => {
  try {
    const q: any = await comfyRequest("GET", "/queue");
    if (q._err) { res.send(success({ running: [], queued: [], total: 0, _offline: true })); return; }

    const runningArr = q.queue_running ?? q.running ?? [];
    const pendingArr = q.queue_pending ?? q.queued ?? q.pending ?? [];

    const running = (Array.isArray(runningArr) ? runningArr : []).map((item: any, i: number) => {
      const promptId = Array.isArray(item) ? String(item[0] ?? "") : "";
      const cached = promptId ? promptCache.get(promptId) : undefined;
      // 记录首次出现时间（保持一致，不随刷新重置）
      const now = Date.now();
      if (promptId && !firstSeen.has(promptId)) firstSeen.set(promptId, now);
      const started = firstSeen.get(promptId) || now;
      return {
        id: i, promptId,
        prompt: cached?.text || `运行中 #${i + 1}`,
        type: "running",
        startedAt: started,
      };
    });

    const queued = (Array.isArray(pendingArr) ? pendingArr : []).map((item: any, i: number) => {
      const promptId = Array.isArray(item) ? String(item[0] ?? "") : "";
      const cached = promptId ? promptCache.get(promptId) : undefined;
      return {
        id: running.length + i, promptId,
        prompt: cached?.text || `排队 #${i + 1}`,
        type: "queued",
      };
    });

    // 清理 2 小时前的缓存
    const cutoff = Date.now() - 7200000;
    for (const [k, v] of promptCache) { if (v.time < cutoff) { promptCache.delete(k); firstSeen.delete(k); } }

    res.send(success({ running, queued, total: running.length + queued.length }));
  } catch (e: any) {
    res.send(success({ running: [], queued: [], total: 0, _offline: true }));
  }
});

// DELETE /api/other/comfyuiQueue
router.delete("/", async (_req, res) => {
  try { await comfyRequest("POST", "/queue", { clear: true }); res.send(success({ cleared: true })); }
  catch (e: any) { res.send(error(e.message)); }
});

// POST /api/other/comfyuiQueue/interrupt
router.post("/interrupt", async (_req, res) => {
  try { await comfyRequest("POST", "/interrupt"); res.send(success({ interrupted: true })); }
  catch (e: any) { res.send(error(e.message)); }
});

export default router;
