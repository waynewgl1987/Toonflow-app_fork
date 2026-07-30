import express from "express";
import u from "@/utils";
import path from "path";
import fs from "fs";
import getPath from "@/utils/getPath";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

function deleteFileFromDisk(filePath: string | null | undefined) {
  if (!filePath) return;
  try {
    const ossDir = getPath("oss");
    const normalizedPath = filePath.replace(/^[/\\]+/, "").split("/").join(path.sep);
    const fullPath = path.join(ossDir, normalizedPath);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  } catch {}
}

/** 删除指定 videoTrackId 对应的所有视频文件和数据库记录 */
async function deleteVideosByTrackId(trackId: number | null | undefined) {
  if (!trackId) return;
  const trackVideos = await u.db("o_video").where("videoTrackId", trackId).select("filePath");
  trackVideos.forEach((v: any) => deleteFileFromDisk(v.filePath));
  await u.db("o_video").where("videoTrackId", trackId).delete();
  await u.db("o_videoTrack").where("id", trackId).delete();
}

export default router.post(
  "/",
  validateFields({
    id: z.number(),
  }),
  async (req, res) => {
    const { id } = req.body;
    const storyboardData = await u.db("o_storyboard").where("id", id).select("id", "track", "trackId", "flowId", "filePath").first();
    if (!storyboardData) return res.status(400).send(error("未找到该分镜"));

    // 1. 删除关联的 imageFlow
    if (storyboardData?.flowId) await u.db("o_imageFlow").where("id", storyboardData?.flowId).delete();

    // 2. 删除分镜图文件
    deleteFileFromDisk(storyboardData.filePath);

    // 3. 删除关联的视频和视频轨
    await deleteVideosByTrackId(storyboardData.trackId as number);

    // 4. 删除分镜记录
    await u.db("o_storyboard").where("id", id).delete();

    // 5. 删除分镜与素材的关联
    await u.db("o_assets2Storyboard").where("storyboardId", id).delete();

    res.status(200).send(success({ message: "分镜删除成功" }));
  },
);
