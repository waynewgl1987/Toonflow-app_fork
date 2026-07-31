import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import logger from "@/logger";
const router = express.Router();

const MERGE_SYSTEM_PROMPT = `你是一个专业的视频提示词整合助手，用于"首尾帧视频生成"场景。

背景：用户选择了 2 个分镜图（首帧图 + 尾帧图），两个分镜各有自己独立的视频提示词。现在需要生成一段"首尾帧视频"的合并提示词，让 AI 视频模型从首帧画面过渡到尾帧画面。

要求：
1. 仔细阅读两个分镜的提示词，理解各自描述的画面内容、场景、人物、动作、光线、镜头等信息
2. 合并为一段完整、连贯、流畅的视频提示词，描述"从第 1 个分镜的画面开始，逐渐过渡到第 2 个分镜的画面"的完整过程
3. 合并时保留两个分镜共有的元素（场景、人物等），对有变化的部分（动作、镜头、光线）做自然过渡描述
4. 语言风格与输入提示词一致（输入是中文则输出中文，输入是英文则输出英文）
5. 直接输出合并后的提示词正文，不要任何解释、前缀、Markdown 代码块标记或多余格式
6. 合并后的提示词应比单个分镜提示词更完整，覆盖整个首尾帧过渡过程

示例格式（中文）：
首帧画面是...，随后镜头...，人物...，最后过渡到尾帧画面...，整体保持...氛围。`;

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    trackAId: z.number(),
    trackBId: z.number(),
    promptA: z.string(),
    promptB: z.string(),
  }),
  async (req, res) => {
    const { projectId, trackAId, trackBId, promptA, promptB } = req.body;
    logger.genLog({ event: "merge_frame_prompt_start", projectId, trackAId, trackBId, lenA: promptA?.length, lenB: promptB?.length });

    if (!promptA?.trim() || !promptB?.trim()) {
      return res.status(400).send(error("两个分镜都需要先有视频提示词才能合并"));
    }

    // 读取项目的视觉手册（画风），增强生成质量
    let projectData: any = null;
    try {
      projectData = await u.db("o_project").where("id", projectId).select("artStyle").first();
    } catch {}

    const artStyle = projectData?.artStyle || "";
    const visualManual = artStyle ? u.getArtPrompt(artStyle, "art_skills", "art_storyboard_video") : "";

    const content = `
**第 1 个分镜（首帧）提示词**：
${promptA}

**第 2 个分镜（尾帧）提示词**：
${promptB}

请将以上两个分镜的提示词整合为一段首尾帧视频合并提示词。
`;

    try {
      const { text } = await u.Ai.Text("universalAi").invoke({
        system: MERGE_SYSTEM_PROMPT,
        messages: [
          ...(visualManual
            ? [
                {
                  role: "assistant" as const,
                  content: visualManual,
                },
              ]
            : []),
          {
            role: "user",
            content,
          },
        ],
      });

      // 保存合并提示词到第一个轨道（trackA），用户可在该轨道查看/二次编辑
      await u.db("o_videoTrack").where("id", trackAId).update({ prompt: text });

      logger.genLog({ event: "merge_frame_prompt_done", projectId, trackAId, trackBId, outLen: text?.length });
      res.status(200).send(success(text));
    } catch (e) {
      logger.genLog({ event: "merge_frame_prompt_error", projectId, trackAId, trackBId, error: u.error(e).message });
      res.status(400).send(error(u.error(e).message || "合并提示词生成失败"));
    }
  },
);
