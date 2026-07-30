import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

/**
 * 重置视频生产页面指定阶段的数据
 * 删除该阶段所有数据后，可重新生成
 */
const stages = [
  "script",       // 剧本
  "assets",       // 角色/场景/道具资产（塑角造景）
  "storyboardTable", // 分镜表
  "storyboard",   // 分镜面板（含分镜图）
  "videoTrack",   // 视频轨（含生成的视频）
] as const;

type Stage = (typeof stages)[number];

const stageTableMap: Record<Stage, string[]> = {
  script: ["o_script"],
  assets: ["o_assets", "o_image"],
  storyboardTable: ["o_agentWorkData"],
  storyboard: ["o_storyboard", "o_image"],
  videoTrack: ["o_videoTrack", "o_video"],
};

const stageLabel: Record<Stage, string> = {
  script: "剧本",
  assets: "角色/场景/道具资产",
  storyboardTable: "分镜表",
  storyboard: "分镜面板及图片",
  videoTrack: "视频轨及视频",
};

export default router.post(
  "/reset-stage",
  validateFields({
    stage: z.enum(stages),
    projectId: z.coerce.number(),
    scriptId: z.coerce.number().optional(),
  }),
  async (req, res) => {
    const { stage, projectId, scriptId } = req.body as {
      stage: Stage;
      projectId: number;
      scriptId?: number;
    };

    // 检查项目是否存在
    const project = await u.db("o_project").where("id", projectId).first();
    if (!project) {
      return res.status(400).send(error(`项目不存在 (id=${projectId})`));
    }

    const tables = stageTableMap[stage];

    try {
      const results: Record<string, number> = {};

      // === 前置清理：先删关联表，再删主表 ===

      // script 阶段：级联清理所有关联数据（参照 delScript.ts 模式）
      if (stage === "script") {
        const scriptIds = await u
          .db("o_script")
          .where("projectId", projectId)
          .select("id")
          .pluck("id");
        if (scriptIds.length > 0) {
          // 1. 清理 agentWorkData 中的关联数据
          const agentDel = await u
            .db("o_agentWorkData")
            .where("projectId", projectId)
            .whereIn("episodesId", scriptIds)
            .del();
          results["o_agentWorkData"] = (results["o_agentWorkData"] || 0) + (agentDel || 0);

          // 2. 清理 storyboard 关联 (o_assets2Storyboard)
          const storyIds = await u
            .db("o_storyboard")
            .whereIn("scriptId", scriptIds)
            .select("id")
            .pluck("id");
          if (storyIds.length > 0) {
            const sbLinkDel = await u
              .db("o_assets2Storyboard")
              .whereIn("storyboardId", storyIds)
              .del();
            results["o_assets2Storyboard"] = sbLinkDel || 0;
          }

          // 3. 清理 o_scriptAssets
          const saDel = await u
            .db("o_scriptAssets")
            .whereIn("scriptId", scriptIds)
            .del();
          results["o_scriptAssets"] = saDel || 0;

          // 4. 清理 o_storyboard
          const sbDel = await u
            .db("o_storyboard")
            .whereIn("scriptId", scriptIds)
            .del();
          results["o_storyboard"] = sbDel || 0;

          // 5. 清理 o_videoTrack (先于 o_video)
          const trackIds = await u
            .db("o_videoTrack")
            .whereIn("scriptId", scriptIds)
            .select("id")
            .pluck("id");
          if (trackIds.length > 0) {
            const vtDel = await u
              .db("o_video")
              .whereIn("videoTrackId", trackIds)
              .del();
            results["o_video_via_track"] = vtDel || 0;
            const vtrackDel = await u
              .db("o_videoTrack")
              .whereIn("id", trackIds)
              .del();
            results["o_videoTrack"] = vtrackDel || 0;
          }

          // 6. 清理 o_video (通过 scriptId)
          const vDel = await u
            .db("o_video")
            .whereIn("scriptId", scriptIds)
            .del();
          results["o_video"] = vDel || 0;
        }
      }

      // assets 阶段：先通过 assetId 清理 o_assets2Storyboard
      if (stage === "assets") {
        const assetIds = await u
          .db("o_assets")
          .where("projectId", projectId)
          .select("id")
          .pluck("id");
        if (assetIds.length > 0) {
          const deleted = await u
            .db("o_assets2Storyboard")
            .whereIn("assetId", assetIds)
            .del();
          results["o_assets2Storyboard"] = deleted || 0;
        }
      }

      // storyboard 阶段：先通过 storyboardId 清理 o_assets2Storyboard
      if (stage === "storyboard") {
        const storyIds = await u
          .db("o_storyboard")
          .where("projectId", projectId)
          .select("id")
          .pluck("id");
        if (storyIds.length > 0) {
          const deleted = await u
            .db("o_assets2Storyboard")
            .whereIn("storyboardId", storyIds)
            .del();
          results["o_assets2Storyboard"] = deleted || 0;
        }
      }

      // === 再删主表 ===
      for (const table of tables) {
        let query = u.db(table).where("projectId", projectId);
        // o_image 通过 assets 关联到 project
        if (table === "o_image") {
          const assetIds = await u
            .db("o_assets")
            .where("projectId", projectId)
            .select("id")
            .pluck("id");
          if (assetIds.length > 0) {
            // 必须先清空 o_assets.imageId 外键引用，再删除 o_image
            await u
              .db("o_assets")
              .whereIn("id", assetIds)
              .update({ imageId: null });
            const deleted = await u
              .db("o_image")
              .whereIn("assetsId", assetIds)
              .del();
            results[table] = deleted;
          }
          continue;
        }
        if (scriptId && table !== "o_assets" && table !== "o_agentWorkData" && table !== "o_script") {
          query = query.where("scriptId", scriptId);
        }
        // o_script 的主键是 id，用 scriptId 参数过滤
        if (scriptId && table === "o_script") {
          query = query.where("id", scriptId);
        }
        // o_agentWorkData 用 projectId 就能区分
        const deleted = await query.del();
        results[table] = deleted || 0;
      }

      // 额外清理：重置 o_agentWorkData 中的 storyboardTable 数据
      if (stage === "storyboardTable") {
        await u
          .db("o_agentWorkData")
          .where("projectId", projectId)
          .where("key", "storyboardTable")
          .del();
      }

      // 清理 videoTrack 时连带清理 o_video
      if (stage === "videoTrack") {
        const trackIds = await u
          .db("o_videoTrack")
          .where("projectId", projectId)
          .select("id")
          .pluck("id");
        if (trackIds.length > 0) {
          await u.db("o_video").whereIn("videoTrackId", trackIds).del();
        }
      }

      res.send(
        success({
          stage,
          label: stageLabel[stage],
          deleted: results,
          message: `${stageLabel[stage]} 数据已重置，可以重新生成`,
        })
      );
    } catch (e: any) {
      res.status(500).send(error(`重置 ${stageLabel[stage]} 失败: ${e.message}`));
    }
  }
);
