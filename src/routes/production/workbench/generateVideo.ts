import express from "express";
import u from "@/utils";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { ReferenceList } from "@/utils/ai";
import logger from "@/logger";
import { isFrameVideoMode, mergeFrameVideoPrompts } from "@/utils/frameVideoPrompt";
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
    uploadData: z.array(
      z.object({
        id: z.number(),
        sources: z.string(),
      }),
    ),
    prompt: z.string(),
    model: z.string(),
    mode: z.string(),
    resolution: z.string(),
    duration: z.number(),
    audio: z.boolean().optional(),
    trackId: z.number(),
  }),
  async (req, res) => {
    const { scriptId, projectId, prompt, uploadData, model, duration, resolution, audio, mode, trackId } = req.body;
    let modeData = [];
    if (Array.isArray(mode)) {
    } else if (typeof mode === "string" && mode.startsWith('["') && mode.endsWith('"]')) {
      try {
        modeData = JSON.parse(mode);
      } catch (e) {}
    }
    //获取生成视频比例
    const ratio = await u.db("o_project").select("videoRatio").where("id", projectId).first();
    const videoPath = `/${projectId}/video/${uuidv4()}.mp4`; //视频保存路径

    // ── 如果前端没传 uploadData，自动从数据库补图 ──
    let resolvedUploadData = uploadData;
    if (!resolvedUploadData || resolvedUploadData.length === 0) {
      const fallbackStoryboards = await u
        .db("o_storyboard")
        .where("trackId", trackId)
        .where("projectId", projectId)
        .where("shouldGenerateImage", 1)
        .select("id");
      if (fallbackStoryboards.length > 0) {
        resolvedUploadData = fallbackStoryboards.map((s: any) => ({ id: s.id, sources: "storyboard" }));
        logger.genLog({ event: "video_uploaddata_fallback", projectId, trackId, reason: "前端未传uploadData", found: fallbackStoryboards.length, ids: fallbackStoryboards.map((s: any) => s.id) });
      } else {
        logger.genLog({ event: "video_uploaddata_fallback", projectId, trackId, reason: "前端未传uploadData，且未找到track关联分镜", found: 0 });
      }
    }

    //查询出图片数据
    const images = await Promise.all(
      resolvedUploadData.map(async (item: UploadItem) => {
        if (item.sources === "storyboard") {
          const sb = await u.db("o_storyboard").where("id", item.id).select("filePath", "prompt", "videoDesc").first();
          logger.genLog({ event: "video_image_query", projectId, detail: `storyboard id=${item.id} filePath=${sb?.filePath || "NULL"} hasPrompt=${!!sb?.prompt} hasVideoDesc=${!!sb?.videoDesc}` });
          return { path: sb?.filePath, sources: "storyBoard", prompt: sb?.prompt, videoDesc: sb?.videoDesc };
        }
        if (item.sources === "assets") {
          const filePath = await u
            .db("o_assets")
            .where("o_assets.id", item.id)
            .leftJoin("o_image", "o_assets.imageId", "o_image.id")
            .select("o_image.filePath", "o_image.type")
            .first();
          logger.genLog({ event: "video_image_query", projectId, detail: `assets id=${item.id} sources=${item.sources} filePath=${filePath?.filePath || "NULL"} type=${filePath?.type || "NULL"}` });
          return { path: filePath?.filePath, sources: filePath.type };
        }
      }),
    );
    //把images里面的图片转成base64格式
    const validImages = images.filter(Boolean);
    logger.genLog({ event: "video_image_loaded", projectId, total: images.length, valid: validImages.length, details: validImages.map((i: any) => `path=${i.path} size=0`).join(" | ") });
    const base64 = await Promise.all(
      validImages.map(async (item: any) => {
        const b64 = await u.oss.getImageBase64(item.path);
        logger.genLog({ event: "video_image_base64", projectId, path: item.path, length: b64?.length || 0, type: item.sources == "audio" ? "audio" : "image" });
        return { base64: b64, type: item.sources == "audio" ? "audio" : "image" };
      }),
    );
    //新增
    const [videoId] = await u.db("o_video").insert({
      filePath: videoPath,
      time: Date.now(),
      state: "生成中",
      scriptId,
      projectId,
      videoTrackId: trackId,
    });
    res.status(200).send(success(videoId));
    const relatedObjects = {
      projectId,
      videoId,
      scriptId,
      type: "视频",
    };
    const finalRefs = base64.filter(Boolean) as ReferenceList[];
    logger.genLog({ event: "video_ref_list", projectId, trackId, refCount: finalRefs.length, promptLen: prompt?.length || 0, promptStart: (prompt || "").slice(0, 80) });

    // ── 首尾帧模式：自动优化合并两个分镜的提示词，保证首尾过渡连贯 ──
    let finalPrompt = prompt;
    const effectiveMode = modeData.length > 0 ? modeData : mode;
    if (isFrameVideoMode(effectiveMode)) {
      const storyboardItems = (validImages as any[]).filter(
        (i): i is { path: string; sources: string; prompt: string; videoDesc?: string } =>
          !!i && i.sources === "storyBoard" && !!i.prompt,
      );
      if (storyboardItems.length >= 2) {
        try {
          finalPrompt = await mergeFrameVideoPrompts({
            projectId,
            promptA: storyboardItems[0].prompt,
            promptB: storyboardItems[1].prompt,
            videoDescA: storyboardItems[0].videoDesc,
            videoDescB: storyboardItems[1].videoDesc,
            duration,
            trackId,
          });
          logger.genLog({ event: "video_frame_prompt_auto_merged", projectId, trackId, outLen: finalPrompt?.length || 0 });
        } catch (e) {
          logger.genLog({ event: "video_frame_prompt_auto_merge_failed", projectId, trackId, error: u.error(e).message });
          finalPrompt = prompt; // 合并失败时回退到原提示词
        }
      } else {
        logger.genLog({ event: "video_frame_prompt_skip", projectId, trackId, reason: `storyboard提示词不足2条: ${storyboardItems.length}` });
      }
    }

    const aiVideo = u.Ai.Video(model);
    aiVideo
      .run(
        {
          prompt: finalPrompt,
          referenceList: finalRefs,
          mode: effectiveMode,
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
  },
);
