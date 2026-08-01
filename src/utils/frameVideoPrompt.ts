import u from "@/utils";
import logger from "@/logger";

/**
 * 首尾帧视频提示词 —— 合并/优化共享工具
 *
 * 使用场景：用户选择 2 个分镜图（首帧图 + 尾帧图）生成首尾帧视频时，
 * 将两个分镜各自独立的提示词优化合并为一段"从首帧连贯过渡到尾帧"的提示词。
 *
 * 模型选择（智能）：调用 u.Ai.resolveFallbackTextModel 自动选择——
 *  - 本地 Qwen3 正在运行 → 使用 Qwen3（openai 供应商）
 *  - Qwen3 未运行（如 ComfyUI 占用显存时）→ 使用云端 DeepSeek 等文本模型，不启动 Qwen3
 */

const MERGE_SYSTEM_PROMPT = `你是一个专业的视频提示词整合助手，用于"首尾帧视频生成"场景。

背景：用户选择了 2 个分镜图（首帧图 + 尾帧图），两个分镜各有自己独立的视频提示词。视频模型以首帧图为第 1 帧、以尾帧图为最后一帧，两者之间的所有帧由模型自动生成。你的任务：生成一段合并提示词，让模型从首帧画面**连贯、有逻辑地过渡**到尾帧画面，避免出现跳变、断裂、人物突变。

核心要求：
1. 仔细阅读两个分镜的提示词，理解各自描述的画面内容、场景、人物、动作、光线、镜头等信息
2. 合并为一段"从首帧到尾帧的完整过渡过程"描述，必须包含**连续的动作链**（先…再…然后…最后…），不能只并列两个静止画面
3. 保留两个分镜共有的元素（场景、人物等），对有变化的部分（动作、姿态、位置、镜头）写**自然的渐进过渡**
4. 人物外观、服装、发型、性别特征、场景、光影在首尾两帧之间必须保持**完全一致**，只允许动作/表情/位置/镜头变化；若两个提示词对同一人物外观描述不一致，以首帧为准并统一到尾帧
5. 明确写出三段结构：首帧画面状态 → 中间动作过程 → 尾帧画面状态
6. 语言风格与输入提示词一致（输入是中文则输出中文，输入是英文则输出英文）
7. 直接输出合并后的提示词正文，不要任何解释、前缀、Markdown 代码块标记或多余格式
8. 合并后的提示词应比单个分镜提示词更完整，覆盖整个首尾帧过渡过程

示例格式（中文）：
首帧画面是...，随后镜头...，人物...，最后过渡到尾帧画面...，整体保持...氛围。`;

export interface FrameMergeParams {
  projectId: number;
  /** 首帧分镜的图片提示词（必填） */
  promptA: string;
  /** 尾帧分镜的图片提示词（必填） */
  promptB: string;
  /** 首帧分镜的 videoDesc（可选，辅助理解） */
  videoDescA?: string;
  /** 尾帧分镜的 videoDesc（可选，辅助理解） */
  videoDescB?: string;
  /** 视频推荐时长（秒，可选） */
  duration?: number;
  /** 合并结果保存到哪个轨道（可选，保存后用户可在该轨道查看/二次编辑） */
  trackId?: number;
}

/**
 * 合并/优化首尾帧两个分镜的提示词
 * @returns 合并后的提示词正文
 */
export async function mergeFrameVideoPrompts(input: FrameMergeParams): Promise<string> {
  const { projectId, promptA, promptB, videoDescA, videoDescB, duration, trackId } = input;

  if (!promptA?.trim() || !promptB?.trim()) {
    throw new Error("两个分镜都需要先有提示词才能合并优化");
  }

  // 读取项目的视觉手册（画风），增强生成质量
  let projectData: any = null;
  try {
    projectData = await u.db("o_project").where("id", projectId).select("artStyle").first();
  } catch {}
  const artStyle = projectData?.artStyle || "";
  const visualManual = artStyle ? u.getArtPrompt(artStyle, "art_skills", "art_storyboard_video") : "";

  const content = `
**视频推荐时长**：${duration ?? "未知"}秒

**第 1 个分镜（首帧）提示词**：
${promptA}
${videoDescA ? `\n**第 1 个分镜（首帧）视频描述**：\n${videoDescA}` : ""}

**第 2 个分镜（尾帧）提示词**：
${promptB}
${videoDescB ? `\n**第 2 个分镜（尾帧）视频描述**：\n${videoDescB}` : ""}

请将以上两个分镜的提示词整合为一段首尾帧视频合并提示词。
`;

  // 智能模型选择：Qwen3 运行中 → Qwen3；否则 → 云端 DeepSeek（不启动 Qwen3）
  let modelKey: `${string}:${string}`;
  try {
    modelKey = await u.Ai.resolveFallbackTextModel("universalAi");
  } catch (e) {
    // resolveFallbackTextModel 无可用服务时会抛错，此时回退到默认 universalAi 配置
    logger.genLog({ event: "merge_frame_prompt_fallback", projectId, error: u.error(e).message });
    modelKey = "universalAi" as `${string}:${string}`;
  }
  logger.genLog({ event: "merge_frame_prompt_model", projectId, modelKey });

  try {
    const { text } = await u.Ai.Text(modelKey).invoke({
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

    // 保存合并提示词到轨道（trackA），用户可在该轨道查看/二次编辑
    if (trackId) {
      await u.db("o_videoTrack").where("id", trackId).update({ prompt: text });
    }

    logger.genLog({ event: "merge_frame_prompt_done", projectId, trackId, outLen: text?.length });
    return text;
  } catch (e) {
    logger.genLog({ event: "merge_frame_prompt_error", projectId, trackId, error: u.error(e).message });
    throw new Error(u.error(e).message || "合并提示词生成失败");
  }
}

/** 判断 mode 是否为首尾帧相关模式 */
export function isFrameVideoMode(mode: any): boolean {
  const modeStr = Array.isArray(mode) ? mode.join(",") : String(mode || "");
  return modeStr.includes("startEndRequired") || modeStr.includes("endFrameOptional") || modeStr.includes("startFrameOptional");
}

export default { mergeFrameVideoPrompts, isFrameVideoMode };
