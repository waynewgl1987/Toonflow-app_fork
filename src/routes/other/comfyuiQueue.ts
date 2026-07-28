import express from "express";
import http from "http";
import { success } from "@/lib/responseFormat";

const router = express.Router();

// 批处理注册: batchKey → { labels: string[], time: number }
const batchRegistry = new Map<string, { labels: string[]; time: number }>();

// POST /api/other/comfyuiQueue/register-batch — 注册一批任务的标签
router.post("/register-batch", (req, res) => {
  const { batchKey, labels } = req.body || {};
  if (batchKey && Array.isArray(labels)) {
    batchRegistry.set(String(batchKey), { labels, time: Date.now() });
    res.send(success({ ok: true }));
  } else {
    res.send(success({ ok: false }));
  }
});

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

// 存储启动时间（按 prompt_id）
const firstSeen = new Map<string, number>();

// GET /api/other/comfyuiQueue
router.get("/", async (_req, res) => {
  try {
    const q: any = await comfyRequest("GET", "/queue");
    if (q._err) { res.send(success({ running: [], queued: [], total: 0, _offline: true })); return; }

    const runningArr = q.queue_running ?? q.running ?? [];
    const pendingArr = q.queue_pending ?? q.queued ?? q.pending ?? [];

    // 尝试匹配批处理标签（按提交顺序）
    const allItems = [...(Array.isArray(runningArr) ? runningArr : []), ...(Array.isArray(pendingArr) ? pendingArr : [])];
    let batchLabels: string[] = [];
    if (allItems.length > 0) {
      // 找最近注册的 batch
      let latest: { labels: string[]; time: number } | undefined;
      for (const v of batchRegistry.values()) {
        if (!latest || v.time > latest.time) latest = v;
      }
      if (latest) batchLabels = latest.labels;
    }

    const running = (Array.isArray(runningArr) ? runningArr : []).map((item: any, i: number) => {
      const promptId = Array.isArray(item) ? String(item[0] ?? "") : "";
      const now = Date.now();
      if (promptId && !firstSeen.has(promptId)) firstSeen.set(promptId, now);
      const label = batchLabels[i] || `运行中 #${i + 1}`;
      return {
        id: i, promptId, prompt: label, type: "running",
        startedAt: firstSeen.get(promptId) || now,
      };
    });

    const queued = (Array.isArray(pendingArr) ? pendingArr : []).map((item: any, i: number) => {
      const idx = running.length + i;
      return { id: idx, prompt: batchLabels[idx] || `排队 #${i + 1}`, type: "queued" };
    });

    // 清理过期
    const cutoff = Date.now() - 7200000;
    for (const [k, v] of batchRegistry) { if (v.time < cutoff) batchRegistry.delete(k); }
    for (const [k, v] of firstSeen) { if (v < cutoff) firstSeen.delete(k); }

    res.send(success({ running, queued, total: running.length + queued.length }));
  } catch (e: any) {
    res.send(success({ running: [], queued: [], total: 0, _offline: true }));
  }
});

// DELETE /api/other/comfyuiQueue
router.delete("/", async (_req, res) => {
  try { await comfyRequest("POST", "/queue", { clear: true }); res.send(success({ cleared: true })); }
  catch (e: any) { res.send(success({ ok: false })); }
});

// POST /api/other/comfyuiQueue/interrupt
router.post("/interrupt", async (_req, res) => {
  try { await comfyRequest("POST", "/interrupt"); res.send(success({ interrupted: true })); }
  catch (e: any) { res.send(success({ ok: false })); }
});

export default router;
