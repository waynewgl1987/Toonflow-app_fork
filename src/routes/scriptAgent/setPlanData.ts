import express from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { extractAssetsFromScripts } from "@/routes/script/extractAssets";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    agentType: z.enum(["scriptAgent"]),
    data: z.object({
      storySkeleton: z.string(),
      adaptationStrategy: z.string(),
    }),
  }),
  async (req, res) => {
    const { projectId, agentType, data } = req.body;
    await u
      .db("o_agentWorkData")
      .where({ projectId: projectId, key: agentType })
      .update({
        data: JSON.stringify(data),
      });
    const script = data.script;

    const scriptIds: number[] = [];
    await Promise.all(
      script.map(async (s: any) => {
        const row = await u.db("o_script").where({ projectId, name: s.name }).first();
        if (row) {
          await u.db("o_script").where({ id: row.id }).update({ content: s.content });
          scriptIds.push(row.id);
        } else {
          const [id] = await u.db("o_script").insert({ projectId, name: s.name, content: s.content });
          scriptIds.push(id);
        }
      }),
    );

    res.status(200).send(success());

    // 后台静默提取资产，不阻塞用户
    if (scriptIds.length) {
      extractAssetsFromScripts(scriptIds, projectId).catch((err) => {
        console.error("[setPlanData] 自动提取资产失败:", err);
      });
    }
  },
);
