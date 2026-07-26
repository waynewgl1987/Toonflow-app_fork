/**
 * 生成进度查询 API
 * 前端轮询此接口获取生成进度百分比
 */
import express from "express";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { getProgressByIds } from "@/utils/generationProgress";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    ids: z.array(z.number()),
  }),
  async (req, res) => {
    const { ids } = req.body;
    const progress = getProgressByIds(ids);
    res.status(200).send(success(progress));
  },
);
