/**
 * 重置阶段数据工具
 * 在重新执行某个阶段前，清理该阶段的所有关联数据（包括数据库和 Agent 记忆）
 * 可被 HTTP 路由和 Agent 工具共用
 */
import u from "@/utils";

// 生产 Agent 的六个阶段与 resetStage 中定义的阶段映射关系
// 每个阶段执行前需要清理哪些表
const PRODUCTION_STAGE_MAP: Record<string, { tables: string[]; label: string }> = {
  "director-plan": {
    label: "导演规划",
    tables: ["o_agentWorkData"],
  },
  "derive-assets": {
    label: "衍生资产分析",
    tables: ["o_assets", "o_scriptAssets", "o_image"],
  },
  "generate-assets": {
    label: "衍生资产生成",
    tables: ["o_image"],
  },
  "storyboard-table": {
    label: "构建分镜表",
    tables: ["o_agentWorkData"],
  },
  "storyboard-panel": {
    label: "分镜面板写入",
    tables: ["o_storyboard", "o_assets2Storyboard", "o_image"],
  },
  "storyboard-gen": {
    label: "分镜图生成",
    tables: ["o_image"],
  },
};

export type ProductionStage = keyof typeof PRODUCTION_STAGE_MAP;
export const PRODUCTION_STAGES = Object.keys(PRODUCTION_STAGE_MAP) as ProductionStage[];

/**
 * 重置生产 Agent 指定阶段的数据
 * @param stage 阶段名称（kebab-case）
 * @param projectId 项目ID
 * @param scriptId 剧本ID（可选）
 * @returns 删除记录数统计
 */
export async function resetProductionStage(
  stage: ProductionStage,
  projectId: number,
  scriptId?: number,
): Promise<Record<string, number>> {
  const stageConfig = PRODUCTION_STAGE_MAP[stage];
  const results: Record<string, number> = {};

  if (!stageConfig) {
    throw new Error(`未知的生产阶段: ${stage}. 可选: ${PRODUCTION_STAGES.join(", ")}`);
  }

  // 检查项目是否存在
  const project = await u.db("o_project").where("id", projectId).first();
  if (!project) {
    throw new Error(`项目不存在 (id=${projectId})`);
  }

  try {
    // ========== 各阶段专用级联清理 ==========

    // 导演规划 / 构建分镜表：清理 o_agentWorkData
    if (stage === "director-plan") {
      // 清理导演拍摄计划
      const delPlan = await u.db("o_agentWorkData").where("projectId", projectId).where("key", "scriptPlan").del();
      results["o_agentWorkData(scriptPlan)"] = delPlan || 0;
    }

    if (stage === "storyboard-table") {
      // 清理分镜表
      const delTable = await u.db("o_agentWorkData").where("projectId", projectId).where("key", "storyboardTable").del();
      results["o_agentWorkData(storyboardTable)"] = delTable || 0;
    }

    // 衍生资产分析：清理 o_assets + o_scriptAssets + 关联图片
    if (stage === "derive-assets") {
      // 1. 获取当前项目的所有资产ID
      const assetIds = (await u.db("o_assets").where("projectId", projectId).select("id").pluck("id")) as number[];

      if (assetIds.length > 0) {
        // 2. 清理 o_assets2Storyboard 关联
        const linkDel = await u.db("o_assets2Storyboard").whereIn("assetId", assetIds).del();
        results["o_assets2Storyboard"] = linkDel || 0;

        // 3. 清理 o_image（必须先解除外键引用）
        await u.db("o_assets").whereIn("id", assetIds).update({ imageId: null });
        const imgDel = await u.db("o_image").whereIn("assetsId", assetIds).del();
        results["o_image"] = imgDel || 0;

        // 4. 清理 o_scriptAssets
        const saDel = scriptId
          ? await u.db("o_scriptAssets").where({ scriptId }).whereIn("assetId", assetIds).del()
          : await u.db("o_scriptAssets").whereIn("assetId", assetIds).del();
        results["o_scriptAssets"] = saDel || 0;

        // 5. 清理 o_assets
        const assetDel = await u.db("o_assets").whereIn("id", assetIds).del();
        results["o_assets"] = assetDel || 0;
      }
    }

    // 衍生资产生成：清理 o_image（只清理由 o_assets 关联的图片）
    if (stage === "generate-assets") {
      const assetIds = await u.db("o_assets").where("projectId", projectId).select("id").pluck("id");
      if (assetIds.length > 0) {
        await u.db("o_assets").whereIn("id", assetIds).update({ imageId: null });
        const imgDel = await u.db("o_image").whereIn("assetsId", assetIds).del();
        results["o_image"] = imgDel || 0;
      }
    }

    // 分镜面板写入：清理 o_storyboard + o_assets2Storyboard + 关联图片
    if (stage === "storyboard-panel") {
      // 1. 清理 storyboard 关联
      const storyIds = (await u.db("o_storyboard").where("projectId", projectId).select("id").pluck("id")) as number[];
      if (storyIds.length > 0) {
        const linkDel = await u.db("o_assets2Storyboard").whereIn("storyboardId", storyIds).del();
        results["o_assets2Storyboard"] = linkDel || 0;

        // 2. 清理 o_image（分镜图）
        const imgDel2 = await u.db("o_image").whereIn("storyboardId", storyIds).del();
        results["o_image"] = imgDel2 || 0;

        // 3. 清理 o_videoTrack + o_video（分镜关联的视频轨）
        const trackIds = (await u.db("o_videoTrack").whereIn("storyboardId", storyIds).select("id").pluck("id")) as number[];
        if (trackIds.length > 0) {
          const vDel = await u.db("o_video").whereIn("videoTrackId", trackIds).del();
          results["o_video"] = vDel || 0;
          const vtDel = await u.db("o_videoTrack").whereIn("id", trackIds).del();
          results["o_videoTrack"] = vtDel || 0;
        }

        // 4. 清理 o_storyboard
        const sbDel = await u.db("o_storyboard").whereIn("id", storyIds).del();
        results["o_storyboard"] = sbDel || 0;
      }
    }

    // 分镜图生成：清理 o_image（只清理分镜关联的图片）
    if (stage === "storyboard-gen") {
      const storyIds = (await u.db("o_storyboard").where("projectId", projectId).select("id").pluck("id")) as number[];
      if (storyIds.length > 0) {
        const imgDel = await u.db("o_image").whereIn("storyboardId", storyIds).del();
        results["o_image"] = imgDel || 0;
      }
    }

    // ── 额外清理：Agent 记忆 ──
    // 清除该项目的 productionAgent 记忆，避免 AI 在重新执行时看到旧数据
    const memoryKey = `${projectId}:productionAgent${scriptId ? `:${scriptId}` : ""}`;
    const memDel = await u.db("memories").where("isolationKey", memoryKey).del();
    if (memDel > 0) {
      results["memories(productionAgent)"] = memDel;
    }

    return results;
  } catch (e: any) {
    throw new Error(`重置 ${stageConfig.label} 失败: ${e.message}`);
  }
}

/**
 * 重置完整项目数据（从头开始）
 * 按依赖顺序清理所有阶段
 */
export async function resetFullProject(projectId: number, scriptId?: number): Promise<Record<string, number>> {
  const allResults: Record<string, number> = {};
  // 按反向顺序清理（先清理依赖最深的）
  const stages: ProductionStage[] = [
    "storyboard-gen",
    "storyboard-panel",
    "storyboard-table",
    "generate-assets",
    "derive-assets",
    "director-plan",
  ];
  for (const stage of stages) {
    try {
      const results = await resetProductionStage(stage, projectId, scriptId);
      Object.assign(allResults, results);
    } catch (e) {
      console.warn(`[resetStage] 清理阶段 ${stage} 失败:`, e);
    }
  }
  return allResults;
}
