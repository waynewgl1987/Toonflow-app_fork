import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
    trackIds: z.array(z.number()),
  }),
  async (req, res) => {
    const { projectId, scriptId, trackIds } = req.body;
    const query = u
      .db("o_videoTrack")
      .where("projectId", projectId)
      .where("scriptId", scriptId);
    if (trackIds && trackIds.length > 0) {
      query.whereIn("id", trackIds);
    }
    const promptList = await query
      .select("id", "state", "reason", "prompt")
      .orderBy("id", "asc");
    res.status(200).send(success(promptList));
  },
);
