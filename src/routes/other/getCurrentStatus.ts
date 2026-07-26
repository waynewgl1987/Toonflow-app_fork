import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import net from "net";

const router = express.Router();

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1500);
    socket.on("connect", () => { socket.destroy(); resolve(true); });
    socket.on("error", () => { socket.destroy(); resolve(false); });
    socket.on("timeout", () => { socket.destroy(); resolve(false); });
    socket.connect(port, "127.0.0.1");
  });
}

export default router.get("/", async (req, res) => {
  const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;

  // 1. 服务状态
  const llamaRunning = await checkPort(8787);
  const comfyRunning = await checkPort(8188);

  // 2. 剧本提取状态
  let scriptStats = { total: 0, pending: 0, extracting: 0, success: 0, failed: 0, scripts: [] as any[] };
  if (projectId) {
    const scripts = await u.db("o_script").where("projectId", projectId).select("id", "name", "extractState", "errorReason");
    scriptStats.total = scripts.length;
    scripts.forEach((s: any) => {
      const state = s.extractState;
      if (state == null || state === 2) scriptStats.pending++;
      else if (state === 0) scriptStats.extracting++;
      else if (state === 1) scriptStats.success++;
      else if (state === -1) scriptStats.failed++;
    });
    scriptStats.scripts = scripts.map((s: any) => ({
      id: s.id,
      name: s.name,
      extractState: s.extractState,
      errorReason: s.errorReason,
    }));
  }

  // 3. 资产统计
  let assetCount = 0;
  if (projectId) {
    const result = await u.db("o_assets").where("projectId", projectId).count("* as count").first();
    assetCount = (result as any)?.count ?? 0;
  }

  res.send(success({
    services: {
      llama: llamaRunning,
      comfy: comfyRunning,
    },
    scripts: scriptStats,
    assets: { total: assetCount },
  }));
});
