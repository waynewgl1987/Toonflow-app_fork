import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import logger from "@/logger";

const router = express.Router();

// 清洗小说原文，生成事件列表
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    novelIds: z.array(z.number()),
    concurrentCount: z.number().min(1).optional(),
  }),
  async (req, res) => {
    const { projectId, novelIds, concurrentCount = 5 } = req.body;
    logger.genLog({ event: "event_generate_start", projectId, novelIds, concurrentCount });

    const [allChapters, novel] = await Promise.all([
      u.db("o_novel").where("projectId", projectId).whereIn("id", novelIds),
      Promise.resolve(new u.cleanNovel(concurrentCount)),
    ]);
    if (allChapters.length === 0) {
      logger.genLog({ event: "event_generate_no_chapters", projectId });
      return res.status(400).send(success("没有对应章节"));
    }
    await u.db("o_novel").where("projectId", projectId).whereIn("id", novelIds).update({ eventState: 0, event: null });
    novel.emitter.on("item", async (item) => {
      logger.genLog({ event: "event_generate_item", projectId, novelId: item.id, hasEvent: !!item.event, error: item?.errorReason });
      await u
        .db("o_novel")
        .where("id", item.id)
        .update({ event: item.event, eventState: item.event ? 1 : -1, errorReason: item?.errorReason ?? null });
    });
    novel.start(allChapters, projectId);
    logger.genLog({ event: "event_generate_launched", projectId, totalChapters: allChapters.length });

    return res.status(200).send(success("生成事件成功"));
  },
);
