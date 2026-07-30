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
    ids: z.array(z.number()),
    projectId: z.number(),
  }),
  async (req, res) => {
    const { ids, projectId } = req.body;
    if (!ids.length) return res.status(400).send(error("请先选择分镜"));
    const storyboardDataList = await u.db("o_storyboard").whereIn("id", ids).where("projectId", projectId).select("id", "track", "trackId", "flowId", "filePath");
    if (!storyboardDataList.length) return res.status(400).send(error("当前选择分镜不存在"));
    const storyBoardIds = storyboardDataList.map((i) => i.id);

    // 1. 删除关联的 imageFlow 记录
    const flowIds = storyboardDataList.map((i) => i.flowId).filter(Boolean);
    if (flowIds.length)
      await u.db("o_imageFlow").whereIn("id", flowIds as number[]).delete();

    // 2. 删除分镜图文件
    storyboardDataList.forEach((s) => deleteFileFromDisk(s.filePath));

    // 3. 删除每个分镜关联的视频和视频轨（即使同一 track 还有其他分镜，也删除该分镜自己的视频）
    for (const sb of storyboardDataList) {
      if (sb.trackId) {
        await deleteVideosByTrackId(sb.trackId as number);
      }
    }

    // 4. 删除分镜记录
    await u.db("o_storyboard").whereIn("id", storyBoardIds).delete();

    // 5. 删除分镜与素材的关联
    await u.db("o_assets2Storyboard").whereIn("storyboardId", storyBoardIds).delete();

    res.status(200).send(success({ message: "分镜批量删除成功" }));
  },
);
