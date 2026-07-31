import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    ids: z.array(z.number()),
  }),
  async (req, res) => {
    const { ids } = req.body;
    if (!ids || ids.length === 0) {
      return res.status(200).send(success({ message: "没有需要删除的轨道" }));
    }

    // 查询这些轨道关联的视频（用于删除文件）
    const videos = await u.db("o_video").whereIn("videoTrackId", ids).select("filePath");
    // 删除视频文件
    await Promise.all(
      videos.map(async (v: any) => {
        if (v?.filePath) {
          try {
            await u.oss.deleteFile(v.filePath);
          } catch (e: any) {
            console.warn("[batchDeleteTrack] 删除视频文件失败:", v.filePath, e.message);
          }
        }
      }),
    );
    // 删除视频记录
    await u.db("o_video").whereIn("videoTrackId", ids).delete();
    // 删除轨道
    await u.db("o_videoTrack").whereIn("id", ids).delete();
    // 分镜解除轨道关联
    await u.db("o_storyboard").whereIn("trackId", ids).update({ trackId: null });

    res.status(200).send(success({ message: "批量删除成功" }));
  },
);
