import express from "express";
import u from "@/utils";
import sharp from "sharp";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assetItemSchema } from "@/agents/productionAgent/tools";
const router = express.Router();
export type AssetData = z.infer<typeof assetItemSchema>;

export default router.post(
  "/",
  validateFields({
    storyboardId: z.number(),
    projectId: z.number(),
    scriptId: z.number(),
    prompt: z.string().optional(),
    referenceAssetIds: z.array(z.number()).optional(),
  }),
  async (req, res) => {
    const { storyboardId, projectId, scriptId, prompt, referenceAssetIds } = req.body;

    // 1. 如果传了 prompt，先更新分镜的提示词
    if (prompt) {
      await u.db("o_storyboard").where({ id: storyboardId }).update({ prompt });
    }

    // 2. 如果传了 referenceAssetIds，更新分镜与素材的关联
    if (referenceAssetIds) {
      // 先删除旧的关联
      await u.db("o_assets2Storyboard").where("storyboardId", storyboardId).delete();
      // 插入新的关联
      if (referenceAssetIds.length > 0) {
        await u.db("o_assets2Storyboard").insert(
          referenceAssetIds.map((assetId: number) => ({
            assetId,
            storyboardId,
          })),
        );
      }
    }

    // 3. 读取当前分镜数据
    const storyboardRow = await u.db("o_storyboard").where("id", storyboardId).first();
    if (!storyboardRow) {
      return res.status(400).send(error("分镜不存在"));
    }
    const currentPrompt = storyboardRow.prompt;
    if (!currentPrompt) {
      return res.status(400).send(error("分镜提示词为空"));
    }

    // 4. 获取关联素材的图片（参考图）
    const assets2SbRows = await u
      .db("o_assets2Storyboard")
      .where("storyboardId", storyboardId)
      .orderBy("rowid")
      .select("assetId");
    const allAssetIds = assets2SbRows.map((r: any) => r.assetId);
    const assetImageMap: Record<number, number> = {};
    if (allAssetIds.length > 0) {
      const assetRows = await u.db("o_assets").whereIn("id", allAssetIds).select("id", "imageId");
      assetRows.forEach((row: any) => { assetImageMap[row.id] = row.imageId; });
    }
    // 按 rowid 顺序收集 imageId
    const orderedImageIds: number[] = [];
    assets2SbRows.forEach((item: any) => {
      const imageId = assetImageMap[item.assetId];
      if (imageId != null) orderedImageIds.push(imageId);
    });

    // 5. 获取项目配置
    const projectSetting = await u.db("o_project").where("id", projectId).select("imageModel", "imageQuality", "artStyle", "videoRatio").first();

    // 6. 标记为生成中
    await u.db("o_storyboard").where("id", storyboardId).update({ state: "生成中" });

    // 7. 立即返回响应，后台异步生成
    res.status(200).send(success({ message: "开始重新生成分镜图", id: storyboardId }));

    // 8. 异步执行生成
    setImmediate(async () => {
      try {
        const referenceList = await getAssetsImageBase64(orderedImageIds);
        const imageCls = await u.Ai.Image(projectSetting?.imageModel as `${string}:${string}`).run(
          {
            prompt: currentPrompt,
            size: projectSetting?.imageQuality as "1K" | "2K" | "4K",
            aspectRatio: projectSetting?.videoRatio as `${number}:${number}`,
            referenceList,
          },
          {
            taskClass: "重新生成分镜图片",
            describe: "分镜图片单张重生成",
            relatedObjects: JSON.stringify({ prompt: currentPrompt }),
            projectId: projectId,
          },
        );
        const savePath = `/${projectId}/assets/${scriptId}/${u.uuid()}.jpg`;
        await imageCls.save(savePath);
        await u.db("o_storyboard").where("id", storyboardId).update({
          filePath: savePath,
          state: "已完成",
        });
      } catch (e) {
        u.db("o_storyboard").where("id", storyboardId).update({
          filePath: "",
          reason: u.error(e).message,
          state: "生成失败",
        });
      }
    });
  },
);

async function getAssetsImageBase64(imageIds: number[]) {
  if (!imageIds.length) return [];
  const imagePaths = await u.db("o_image").whereIn("o_image.id", imageIds).select("o_image.id", "o_image.filePath");
  const id2Path = new Map<number, string>();
  for (const row of imagePaths) id2Path.set(row.id, row.filePath);
  const imageUrls = await Promise.all(
    imageIds.map(async (id) => {
      const filePath = id2Path.get(id);
      if (filePath) {
        try { return await u.oss.getImageBase64(filePath); } catch { return null; }
      }
      return null;
    }),
  );
  return (imageUrls.filter(Boolean) as string[]).map((url) => ({ type: "image" as const, base64: url }));
}
