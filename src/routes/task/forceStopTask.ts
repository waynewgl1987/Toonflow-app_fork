/**
 * 强制停止任务 - 将任务状态标记为失败
 */
import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    taskId: z.number(),
    projectId: z.number().optional(),
  }),
  async (req, res) => {
    const { taskId } = req.body;
    await u
      .db("o_tasks")
      .where("id", taskId)
      .update({
        state: "生成失败",
        reason: "用户手动强制停止",
      });
    // 同时尝试中断 ComfyUI 的当前任务
    try {
      const http = require("http");
      const req2 = http.request("http://127.0.0.1:8188/interrupt", { method: "POST", timeout: 2000 });
      req2.end();
    } catch {}
    res.status(200).send(success({ message: "任务已停止" }));
  },
);
