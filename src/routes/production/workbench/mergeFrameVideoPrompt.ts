import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import logger from "@/logger";
import { mergeFrameVideoPrompts } from "@/utils/frameVideoPrompt";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    trackAId: z.number(),
    trackBId: z.number(),
    promptA: z.string(),
    promptB: z.string(),
  }),
  async (req, res) => {
    const { projectId, trackAId, trackBId, promptA, promptB } = req.body;
    logger.genLog({ event: "merge_frame_prompt_start", projectId, trackAId, trackBId, lenA: promptA?.length, lenB: promptB?.length });

    if (!promptA?.trim() || !promptB?.trim()) {
      return res.status(400).send(error("两个分镜都需要先有视频提示词才能合并"));
    }

    try {
      // 共享工具：合并并保存到 trackA（智能选择 Qwen3 / 云端 DeepSeek）
      const text = await mergeFrameVideoPrompts({
        projectId,
        promptA,
        promptB,
        trackId: trackAId,
      });

      res.status(200).send(success(text));
    } catch (e) {
      res.status(400).send(error(u.error(e).message || "合并提示词生成失败"));
    }
  },
);
