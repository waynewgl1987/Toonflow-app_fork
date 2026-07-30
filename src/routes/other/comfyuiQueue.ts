import express from "express";
import http from "http";

const router = express.Router();

// 统一响应格式：{ success: true, data: ... } 与 services API 一致
function ok(data: any = null) { return { success: true, data }; }

// 批处理注册: batchKey → { labels: string[], time: number }
const batchRegistry = new Map<string, { labels: string[]; time: number }>();

// POST /api/other/comfyuiQueue/register-batch — 注册一批任务的标签
router.post("/register-batch", (req, res) => {
  const { batchKey, labels } = req.body || {};
  if (batchKey && Array.isArray(labels)) {
    batchRegistry.set(String(batchKey), { labels, time: Date.now() });
    res.send(ok({ ok: true }));
  } else {
    res.send(ok({ ok: false }));
  }
});

function comfyRequest(method: string, path: string, body?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port: 8188, path, method, timeout: 15000,
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

// POST /api/other/comfyuiQueue/register — 注册单个 prompt（由 vendor 调用）
router.post("/register", (req, res) => {
  const { promptId, text } = req.body || {};
  if (promptId && text) {
    // 存入 firstSeen 以显示启动时间
    if (!firstSeen.has(String(promptId))) firstSeen.set(String(promptId), Date.now());
    res.send(ok({ ok: true }));
  } else {
    res.send(ok({ ok: false }));
  }
});

// 存储启动时间（按 prompt_id）
const firstSeen = new Map<string, number>();

// GET /api/other/comfyuiQueue
router.get("/", async (_req, res) => {
  try {
    const q: any = await comfyRequest("GET", "/queue");
    if (q._err) { res.send(ok({ running: [], queued: [], total: 0, _offline: true })); return; }

    const runningArr = q.queue_running ?? q.running ?? [];
    // ComfyUI /queue API: queue_pending 是对象 { prompt_id: {...}, ... }，需转数组
    const pendingRaw = q.queue_pending ?? q.queued ?? q.pending ?? {};
    const pendingArr = Array.isArray(pendingRaw) ? pendingRaw : Object.keys(pendingRaw);

    // 尝试匹配批处理标签（按提交顺序）
    const allItems = [...(Array.isArray(runningArr) ? runningArr : []), ...pendingArr];
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

    const queued = pendingArr.map((item: any, i: number) => {
      const idx = running.length + i;
      // item 可能是 ["prompt_id", ...] 或 prompt_id 字符串（从对象键转换而来）
      const promptId = typeof item === "string" ? item : (Array.isArray(item) ? String(item[0] ?? "") : "");
      return { id: idx, promptId, prompt: batchLabels[idx] || `排队 #${i + 1}`, type: "queued" };
    });

    // 清理过期
    const cutoff = Date.now() - 7200000;
    for (const [k, v] of batchRegistry) { if (v.time < cutoff) batchRegistry.delete(k); }
    for (const [k, v] of firstSeen) { if (v < cutoff) firstSeen.delete(k); }

    res.send(ok({ running, queued, total: running.length + queued.length }));
  } catch (e: any) {
    res.send(ok({ running: [], queued: [], total: 0, _offline: true }));
  }
});

// DELETE /api/other/comfyuiQueue
router.delete("/", async (_req, res) => {
  try { await comfyRequest("POST", "/queue", { clear: true }); res.send(ok({ cleared: true })); }
  catch (e: any) { res.send(ok({ ok: false })); }
});

// POST /api/other/comfyuiQueue/interrupt
router.post("/interrupt", async (_req, res) => {
  try { await comfyRequest("POST", "/interrupt"); res.send(ok({ interrupted: true })); }
  catch (e: any) { res.send(ok({ ok: false })); }
});

// POST /api/other/comfyuiQueue/delete — 批量删除指定 promptId 的队列任务
router.post("/delete", async (req, res) => {
  try {
    const { promptIds } = req.body || {};
    if (!Array.isArray(promptIds) || promptIds.length === 0) {
      return res.send(ok({ ok: false, message: "未指定要删除的任务" }));
    }
    // ComfyUI 支持一次传入多个 promptId: { "delete": ["id1","id2",...] }
    await comfyRequest("POST", "/queue", { delete: promptIds.map(String) });
    // 清除本地缓存
    for (const pid of promptIds) {
      if (pid) firstSeen.delete(String(pid));
    }
    res.send(ok({ ok: true, deleted: promptIds.length }));
  } catch (e: any) {
    res.send(ok({ ok: false, message: e.message }));
  }
});

export default router;
