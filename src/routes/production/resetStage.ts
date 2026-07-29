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
  "assets",       // 角色/场景/道具资产（塑角造景）
  "storyboardTable", // 分镜表
  "storyboard",   // 分镜面板（含分镜图）
  "videoTrack",   // 视频轨（含生成的视频）
] as const;

type Stage = (typeof stages)[number];

const stageTableMap: Record<Stage, string[]> = {
  assets: ["o_assets", "o_image"],
  storyboardTable: ["o_agentWorkData"],
  storyboard: ["o_storyboard", "o_image"],
  videoTrack: ["o_videoTrack", "o_video"],
};

const stageLabel: Record<Stage, string> = {
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
            const deleted = await u
              .db("o_image")
              .whereIn("assetsId", assetIds)
              .del();
            results[table] = deleted;
          }
          continue;
        }
        if (scriptId && table !== "o_assets" && table !== "o_agentWorkData") {
          query = query.where("scriptId", scriptId);
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

      // 清理 o_assets 时也清理关联的 o_assets2Storyboard
      if (stage === "assets") {
        const assetIds = await u
          .db("o_assets")
          .where("projectId", projectId)
          .select("id")
          .pluck("id");
        if (assetIds.length > 0) {
          await u
            .db("o_assets2Storyboard")
            .whereIn("assetId", assetIds)
            .del();
        }
      }

      // 清理 o_storyboard 时也清理关联表
      if (stage === "storyboard") {
        const storyIds = await u
          .db("o_storyboard")
          .where("projectId", projectId)
          .select("id")
          .pluck("id");
        if (storyIds.length > 0) {
          await u
            .db("o_assets2Storyboard")
            .whereIn("storyboardId", storyIds)
            .del();
        }
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
