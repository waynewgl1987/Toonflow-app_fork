import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import logger from "@/logger";
const router = express.Router();

const TRANSLATE_SYSTEM_PROMPT = `你是一个专业的提示词翻译助手。

任务：将用户提供的提示词翻译为指定语言（中文或英文），保持原意、语气和结构完全一致。

要求：
1. 只翻译文本内容，不要添加、删除或改写任何信息
2. 保持原有段落结构、标点和编号
3. 专业术语按目标语言的习惯翻译（如 AI 绘图/视频生成领域术语）
4. 输出时不要任何解释、前缀、引号包裹或 Markdown 代码块标记，直接输出翻译结果
5. 如果提示词已经是目标语言，原样返回即可`;

export default router.post(
  "/",
  validateFields({
    text: z.string(),
    targetLang: z.enum(["zh", "en"]),
  }),
  async (req, res) => {
    const { text, targetLang } = req.body;
    if (!text?.trim()) {
      return res.status(200).send(success(""));
    }
    logger.genLog({ event: "translate_prompt_start", targetLang, len: text.length });

    const langLabel = targetLang === "zh" ? "中文" : "英文";
    try {
      const { text: translated } = await u.Ai.Text("universalAi").invoke({
        system: TRANSLATE_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `请将以下提示词翻译成${langLabel}：\n\n${text}`,
          },
        ],
      });
      logger.genLog({ event: "translate_prompt_done", targetLang, outLen: translated?.length });
      res.status(200).send(success(translated ?? ""));
    } catch (e) {
      logger.genLog({ event: "translate_prompt_error", targetLang, error: u.error(e).message });
      res.status(400).send(error(u.error(e).message || "翻译失败"));
    }
  },
);
