import express from "express";
import u from "@/utils";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { ReferenceList } from "@/utils/ai";
import logger from "@/logger";
const router = express.Router();

type Type = "imageReference" | "startImage" | "endImage" | "videoReference" | "audioReference";
interface UploadItem {
  fileType: "image" | "video" | "audio";
  type: Type;
  sources?: "assets" | "storyboard";
  id?: number;
  src?: string;
  label?: string;
  prompt?: string;
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
    trackData: z.array(
      z.object({
        uploadData: z.array(
          z.object({
            id: z.number(),
            sources: z.string(),
          }),
        ),
        trackId: z.number(),
        prompt: z.string(),
        duration: z.number(),
      }),
    ),
    model: z.string(),
    mode: z.string(),
    resolution: z.string(),
    audio: z.boolean().optional(),
  }),
  async (req, res) => {
    const { scriptId, projectId, trackData, model, resolution, audio, mode } = req.body;

    let modeData = [];
    if (Array.isArray(mode)) {
    } else if (typeof mode === "string" && mode.startsWith('["') && mode.endsWith('"]')) {
      try {
        modeData = JSON.parse(mode);
      } catch (e) {}
    }

    // 获取生成视频比例
    const ratio = await u.db("o_project").select("videoRatio").where("id", projectId).first();

    // 为每个 track 预处理数据并插入数据库，返回任务列表
    const tasks = await Promise.all(
      (trackData as { uploadData: { id: number; sources: string }[]; trackId: number; prompt: string; duration: number }[]).map(async (track) => {
        let { uploadData, trackId, prompt, duration } = track;

        // ── 如果前端没传 uploadData，自动从数据库补图 ──
        if (!uploadData || uploadData.length === 0) {
          const fallbackStoryboards = await u
            .db("o_storyboard")
            .where("trackId", trackId)
            .where("projectId", projectId)
            .where("shouldGenerateImage", 1)
            .select("id");
          if (fallbackStoryboards.length > 0) {
            uploadData = fallbackStoryboards.map((s: any) => ({ id: s.id, sources: "storyboard" }));
            logger.genLog({ event: "batch_video_uploaddata_fallback", projectId, trackId, found: fallbackStoryboards.length, ids: fallbackStoryboards.map((s: any) => s.id) });
          } else {
            logger.genLog({ event: "batch_video_uploaddata_fallback", projectId, trackId, found: 0 });
          }
        }

        // 查询出图片数据
        const images = await Promise.all(
          uploadData.map(async (item) => {
            if (item.sources === "storyboard") {
              const filePath = await u.db("o_storyboard").where("id", item.id).select("filePath").first();
              logger.genLog({ event: "batch_video_img_query", projectId, trackId, detail: `storyboard id=${item.id} filePath=${filePath?.filePath || "NULL"}` });
              return { path: filePath?.filePath, sources: "storyBoard" };
            }
            if (item.sources === "assets") {
              const filePath = await u
                .db("o_assets")
                .where("o_assets.id", item.id)
                .leftJoin("o_image", "o_assets.imageId", "o_image.id")
                .select("o_image.filePath", "o_image.type")
                .first();
              logger.genLog({ event: "batch_video_img_query", projectId, trackId, detail: `assets id=${item.id} filePath=${filePath?.filePath || "NULL"}` });
              return { path: filePath?.filePath, sources: filePath.type };
            }
          }),
        );
        const validImgCount = images.filter(Boolean).length;
        logger.genLog({ event: "batch_video_img_loaded", projectId, trackId, total: images.length, valid: validImgCount });

        const videoPath = `/${projectId}/video/${uuidv4()}.mp4`;
        const [videoId] = await u.db("o_video").insert({
          filePath: videoPath,
          time: Date.now(),
          state: "生成中",
          scriptId,
          projectId,
          videoTrackId: trackId,
        });

        return { videoId, videoPath, prompt, duration, images, trackId };
      }),
    );

    res.status(200).send(success(tasks.map((t) => ({ videoId: t.videoId, trackId: t.trackId }))));
    for (const { videoId, videoPath, prompt, duration, images, trackId } of tasks) {
      // 所有任务全部并发后台执行，完全不阻塞任何进程
      const validImages = images.filter(Boolean);
      logger.genLog({ event: "batch_video_b64_start", projectId, trackId, videoId, validCount: validImages.length });
      const base64 = await Promise.all(
        validImages.map(async (item: any) => {
          const b64 = await u.oss.getImageBase64(item.path);
          logger.genLog({ event: "batch_video_b64_item", projectId, trackId, path: item.path, b64Len: b64?.length || 0 });
          return { base64: b64, type: item.sources == "audio" ? "audio" : "image" };
        }),
      );
      const finalRefs = base64.filter(Boolean) as ReferenceList[];
      logger.genLog({ event: "batch_video_ref_list", projectId, trackId, videoId, refCount: finalRefs.length });
      const relatedObjects = { projectId, videoId, scriptId, type: "视频" };
      const aiVideo = u.Ai.Video(model);
      aiVideo
        .run(
          {
            prompt,
            referenceList: finalRefs,
            mode: modeData.length > 0 ? modeData : mode,
            duration,
            aspectRatio: (ratio?.videoRatio as "16:9" | "9:16") || "16:9",
            resolution,
            audio,
          },
          {
            projectId,
            taskClass: "视频生成",
            describe: "根据提示词生成视频",
            relatedObjects: JSON.stringify(relatedObjects),
          },
        )
        .then(async () => await aiVideo.save(videoPath))
        .then(async () => await u.db("o_video").where("id", videoId).update({ state: "生成成功" }))
        .catch(async (error: any) => {
          await u
            .db("o_video")
            .where("id", videoId)
            .update({
              state: "生成失败",
              errorReason: u.error(error).message,
            });
        });
    }
  },
);
