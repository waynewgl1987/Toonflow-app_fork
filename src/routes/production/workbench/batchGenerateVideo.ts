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

        // 获取分镜数据库 ID
        const storyboardId = uploadData.find((item: any) => item.sources === "storyboard")?.id || trackId;
        return { videoId, videoPath, prompt, duration, images, trackId, storyboardId };
      }),
    );

    res.status(200).send(success(tasks.map((t) => ({ videoId: t.videoId, trackId: t.trackId }))));
    // 批量提交：全部快速发给 ComfyUI 排队
    const io: any = req.app.get("io");
    const nsp = io ? io.of("/api/socket/productionAgent") : null;
    const total = tasks.length;

    // 收集所有标签（按提交顺序）
    const labels = tasks.map((t: any) => {
      const sbId = t.storyboardId ? t.storyboardId : t.trackId;
      return `【分镜${sbId}】${(t.prompt || "").slice(0, 60)}`;
    });
    // 注册批处理标签到队列缓存
    const batchKey = `batch_${projectId}_${Date.now()}`;
    try {
      await fetch(`http://127.0.0.1:${process.env.PORT || 10588}/api/other/comfyuiQueue/register-batch`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchKey, labels }),
      });
    } catch {}

    if (nsp) nsp.emit("batch_queue_start", { projectId, total, trackIds: tasks.map((t: any) => t.trackId) });
    for (let idx = 0; idx < tasks.length; idx++) {
      const { videoId, videoPath, prompt, duration, images, trackId, storyboardId } = tasks[idx];
      const current = idx + 1;
      const sbId = (typeof storyboardId === 'number') ? storyboardId : trackId;
      const labelPrompt = `【分镜${sbId}】${prompt}`;
      // 间隔提交：第一个立刻发，后续每个间隔 500ms
      if (idx > 0) await new Promise(r => setTimeout(r, 500));
      if (nsp) nsp.emit("batch_queue_progress", { projectId, trackId, videoId, current, total, status: "submitted" });
      logger.genLog({ event: "batch_video_submit", projectId, trackId, videoId, current, total });
      // 全部并发提交到 ComfyUI，不等待完成
      const validImages = images.filter(Boolean);
      Promise.resolve().then(async () => {
        try {
          const base64 = await Promise.all(
            validImages.map(async (item: any) => {
              const b64 = await u.oss.getImageBase64(item.path);
              return { base64: b64, type: item.sources == "audio" ? "audio" : "image" };
            }),
          );
          const finalRefs = base64.filter(Boolean) as ReferenceList[];
          const relatedObjects = { projectId, videoId, scriptId, type: "视频" };
          const aiVideo = u.Ai.Video(model);
          await aiVideo.run(
            { prompt: labelPrompt, referenceList: finalRefs, mode: modeData.length > 0 ? modeData : mode, duration, aspectRatio: (ratio?.videoRatio as "16:9" | "9:16") || "16:9", resolution, audio },
            { projectId, taskClass: "视频生成", describe: "根据提示词生成视频", relatedObjects: JSON.stringify(relatedObjects) },
          );
          await aiVideo.save(videoPath);
          await u.db("o_video").where("id", videoId).update({ state: "生成成功" });
          if (nsp) nsp.emit("batch_queue_progress", { projectId, trackId, videoId, current, total, status: "success" });
          logger.genLog({ event: "batch_video_done", projectId, trackId, videoId });
        } catch (error: any) {
          if (nsp) nsp.emit("batch_queue_progress", { projectId, trackId, videoId, current, total, status: "failed", error: u.error(error).message });
          logger.genLog({ event: "batch_video_error", projectId, trackId, videoId, error: u.error(error).message });
          await u.db("o_video").where("id", videoId).update({ state: "生成失败", errorReason: u.error(error).message });
        }
      });
    }
    if (nsp) nsp.emit("batch_queue_complete", { projectId, total });
  },
);
