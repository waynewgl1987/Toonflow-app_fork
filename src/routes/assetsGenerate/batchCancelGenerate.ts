/**
 * 批量取消生成 - 将多个图片生成任务状态标记为失败
 */
import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { removeGeneration } from "@/utils/generationProgress";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    ids: z.array(z.number()),
  }),
  async (req, res) => {
    const { ids } = req.body;

    if (ids.length === 0) {
      return res.status(200).send(success({ message: "没有需要取消的任务", count: 0 }));
    }

    await u
      .db("o_image")
      .whereIn("id", ids)
      .andWhere("state", "生成中")
      .update({
        state: "生成失败",
        errorReason: "用户手动中止",
      });

    // 同时将关联的 o_tasks 中也标记为失败
    // 查找关联 o_assets 中的 assetsId 对应的任务
    const images = await u
      .db("o_image")
      .whereIn("id", ids)
      .select("assetsId")
      .where("state", "生成失败");

    if (images.length > 0) {
      await u
        .db("o_assets")
        .whereIn(
          "id",
          images.map((i: any) => i.assetsId).filter(Boolean),
        )
        .update({ promptState: "生成失败" });
    }

    // 清理内存中的进度记录
    for (const id of ids) {
      removeGeneration(id);
    }

    // 尝试中断 ComfyUI 的当前任务
    try {
      const http = require("http");
      const req2 = http.request("http://127.0.0.1:8188/interrupt", { method: "POST", timeout: 2000 });
      req2.end();
    } catch {}

    res.status(200).send(success({ message: `已中止 ${ids.length} 个任务`, count: ids.length }));
  },
);
