/**
 * Toonflow AI 供应商 - ComfyUI (本地)
 * @version 1.0
 *
 * 沙箱安全：不使用 require/fs/path，仅用 sandbox 注入的 API
 * 工作流以 JSON 模板字符串内嵌，__PROMPT__ 在运行时替换为实际 prompt
 */

// ============================================================
// 类型定义
// ============================================================
type VideoMode = "singleImage" | "startEndRequired" | "endFrameOptional" | "startFrameOptional" | "text";

interface TextModel { name: string; modelName: string; type: "text"; think: boolean }
interface ImageModel { name: string; modelName: string; type: "image"; mode: ("text" | "singleImage" | "multiReference")[] }
interface VideoModel { name: string; modelName: string; type: "video"; mode: VideoMode[]; audio: "optional" | false | true; durationResolutionMap: { duration: number[]; resolution: string[] }[] }
interface TTSModel { name: string; modelName: string; type: "tts"; voices: { title: string; voice: string }[] }

interface VendorConfig {
  id: string; version: string; name: string; author: string;
  description?: string; icon?: string;
  inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string }[];
  inputValues: Record<string, string>;
  models: (TextModel | ImageModel | VideoModel | TTSModel)[];
}

interface ImageConfig { prompt: string; imageBase64?: string[]; referenceList?: { type: string; base64: string }[]; size: "1K" | "2K" | "4K"; aspectRatio: `${number}:${number}` }
interface VideoConfig { duration: number; resolution: string; aspectRatio: "16:9" | "9:16"; prompt: string; imageBase64?: string[]; audio?: boolean; mode: VideoMode[] }
interface TTSConfig { text: string; voice: string; speechRate: number; pitchRate: number; volume: number }
interface PollResult { completed: boolean; data?: string; error?: string }

// ============================================================
// 内嵌工作流（JSON 模板字符串，运行时替换 __PROMPT__）
// ============================================================

const IMAGE_WORKFLOW_JSON = `{"prompt":{"772":{"class_type":"easy int","inputs":{"input_0":1451}},"770":{"class_type":"LoadImage","inputs":{"image":"klein_00001_ (1).png","upload":"image"}},"765":{"class_type":"SaveImage","inputs":{"filename_prefix":"flux2/klein","images":["1123",0]}},"998":{"class_type":"SaveImage","inputs":{"filename_prefix":"flux2/文生图","images":["1110",1]}},"1110":{"class_type":"b666cb78-77e0-4437-b9bd-8ad689bb3546","inputs":{"positive":["550",0],"latent_image":["853",0]}},"550":{"class_type":"CLIPTextEncode","inputs":{"text":"__PROMPT__","clip":["1110",0]}},"853":{"class_type":"EmptyFlux2LatentImage","inputs":{"input_0":864,"input_1":1536,"input_2":1}},"1123":{"class_type":"7888059c-24a7-49c8-801c-e6e818eeb4c6","inputs":{"conditioning":["773",0],"image":["770",0],"generation_width":["772",0]}},"773":{"class_type":"CLIPTextEncode","inputs":{"text":"__PROMPT__","clip":["1123",1]}}}}`;

const VIDEO_WORKFLOW_JSON = `{"prompt":{"831":{"class_type":"deaa09e1-d244-4782-9d94-30460280ce54","inputs":{"image":["838",0],"positive":["832",0]}},"838":{"class_type":"LoadImage","inputs":{"image":"refer.png","upload":"image"}},"832":{"class_type":"CLIPTextEncode","inputs":{"text":"__PROMPT__","clip":["831",0]}},"833":{"class_type":"f0b5842f-ef7e-4deb-866c-6c6535eb8320","inputs":{"image":["838",0],"positive":["834",0]}},"834":{"class_type":"CLIPTextEncode","inputs":{"text":"__PROMPT__","clip":["833",0]}}}}`;

// ============================================================
// 全局声明（从 VM 沙箱注入）
// ============================================================
declare const axios: any;
declare const logger: (msg: string) => void;
declare const urlToBase64: (url: string) => Promise<string>;
declare const pollTask: (fn: () => Promise<PollResult>, interval?: number, timeout?: number) => Promise<PollResult>;

// ============================================================
// 供应商配置
// ============================================================
const vendor: VendorConfig = {
  id: "comfyui",
  version: "1.0",
  author: "Custom",
  name: "ComfyUI (本地)",
  description: `本地 ComfyUI，支持图像和视频生成。

**使用前准备：**
1. 启动 ComfyUI
2. 将工作流中需要用到的参考图片放入 ComfyUI 的 \`input/\` 目录
3. 工作流中 CLIPTextEncode 节点 text 字段包含 \`__PROMPT__\` 占位符

**工作流：**
- 文生图：内建 Flux 工作流
- 文生视频：默认使用 LTX2.3 单图视频工作流

**自定义工作流：**
在下方字段填写 JSON 字符串，或使用 \`file://\` 开头指定文件路径，例如：
\`file://E:/AI/ComfyAI_Video-ShortVideo/工作流/LTX2.3/LTX2.3  单图视频.json\`

**注意：** ComfyUI 不支持文本请求，Agent 配置中文本模型务必指向 openai（Qwen3）。`,
  icon: "",
  inputs: [
    { key: "baseUrl", label: "ComfyUI 地址", type: "url", required: true, placeholder: "http://localhost:8188" },
    { key: "imageWorkflowJson", label: "文生图工作流 JSON（覆盖内建）", type: "text", required: false, placeholder: "留空使用内建工作流" },
    { key: "videoWorkflowJson", label: "文生视频工作流 JSON（覆盖内建）", type: "text", required: false, placeholder: "留空使用内建工作流" },
  ],
  inputValues: {
    baseUrl: "http://localhost:8188",
    imageWorkflowJson: "",
    videoWorkflowJson: "",
  },
  models: [
    {
      name: "ComfyUI 文生图 (本地)",
      modelName: "comfyui-image",
      type: "image",
      mode: ["text", "singleImage"],
    },
    {
      name: "ComfyUI 文生视频 (本地)",
      modelName: "comfyui-video",
      type: "video",
      mode: ["text"],
      audio: "optional",
      durationResolutionMap: [
        { duration: [4, 5, 6, 7, 8, 9, 10], resolution: ["720p", "1080p"] },
      ],
    },
  ],
};

// ============================================================
// 辅助函数
// ============================================================

/** 递归替换对象中所有字符串内的 __PROMPT__ */
function replacePrompt(obj: any, prompt: string): any {
  if (typeof obj === "string") {
    return obj.replace(/__PROMPT__/g, prompt);
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => replacePrompt(item, prompt));
  }
  if (obj && typeof obj === "object") {
    const result: any = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = replacePrompt(v, prompt);
    }
    return result;
  }
  return obj;
}

/** 解析工作流 JSON 并注入 prompt */
function prepareWorkflow(rawJson: string, prompt: string): object {
  const parsed = JSON.parse(rawJson);
  const promptObj = parsed.prompt || parsed; // 兼容 { prompt: {...} } 或直接对象
  return replacePrompt(promptObj, prompt);
}

// 注意：VM2 沙箱无 Buffer/atob/Blob，无法动态上传参考图到 ComfyUI。
// 如需使用参考图，请预先将图片放入 ComfyUI 的 input/ 目录，
// 并在 workflow 的 LoadImage 节点中引用对应文件名。

/** 提交工作流到 ComfyUI 并轮询，返回结果 URL（host 负责转 base64） */
async function submitAndWait(workflow: object, baseUrl: string): Promise<string> {
  logger(`[ComfyUI] 提交生成任务...`);
  const submitRes = await fetch(`${baseUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
  });
  if (!submitRes.ok) {
    const errText = await submitRes.text();
    throw new Error(`ComfyUI 提交失败 (${submitRes.status}): ${errText}`);
  }
  const submitData = await submitRes.json();
  const promptId = submitData.prompt_id;
  logger(`[ComfyUI] 任务 ID: ${promptId}`);

  const pollResult = await pollTask(async () => {
    const histRes = await fetch(`${baseUrl}/history/${promptId}`);
    if (!histRes.ok) return { completed: false };
    const history = await histRes.json();
    const entry = history[promptId];
    if (!entry) return { completed: false };

    if (entry.status?.completed) {
      const outputs = entry.outputs || {};
      for (const nodeId of Object.keys(outputs)) {
        const output = outputs[nodeId];
        const images = output?.images || [];
        if (images.length > 0) {
          const m = images[0];
          const fileUrl = `${baseUrl}/view?filename=${encodeURIComponent(m.filename)}&subfolder=${encodeURIComponent(m.subfolder || "")}&type=${encodeURIComponent(m.type || "output")}`;
          logger(`[ComfyUI] 生成完成: ${m.filename}`);
          return { completed: true, data: fileUrl };
        }
      }
      return { completed: true, error: "输出中没有找到媒体文件" };
    }
    if (entry.status?.status_str === "error") {
      return { completed: true, error: entry.status?.error_message || "ComfyUI 生成失败" };
    }
    return { completed: false };
  }, 2000, 600000);

  if (pollResult.error) throw new Error(`ComfyUI 生成失败: ${pollResult.error}`);
  if (!pollResult.data) throw new Error("ComfyUI 未返回结果");
  return pollResult.data; // 返回 URL，host 的 AiImage/AiVideo 会自动转 base64
}

// ============================================================
// 文本请求（ComfyUI 不支持，抛错）
// ============================================================
const textRequest = (model: TextModel, think: boolean, thinkLevel: 0 | 1 | 2 | 3) => {
  throw new Error("ComfyUI 不支持文本生成，请使用 Qwen3/OpenAI 供应商为 Agent 配置文本模型");
};

// ============================================================
// 图像请求
// ============================================================
const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  const baseUrl = vendor.inputValues.baseUrl;
  const customJson = vendor.inputValues.imageWorkflowJson || "";
  const rawJson = customJson || IMAGE_WORKFLOW_JSON;

  logger(`[ComfyUI Image] 准备文生图工作流`);
  const workflow = prepareWorkflow(rawJson, config.prompt);
  return await submitAndWait(workflow, baseUrl);
};

// ============================================================
// 视频请求
// ============================================================
const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  const baseUrl = vendor.inputValues.baseUrl;
  const customJson = vendor.inputValues.videoWorkflowJson || "";
  const rawJson = customJson || VIDEO_WORKFLOW_JSON;

  // 将 duration/resolution 信息拼入 prompt
  let enhancedPrompt = config.prompt;
  if (config.duration) enhancedPrompt += ` Duration: ${config.duration}s.`;
  if (config.resolution) enhancedPrompt += ` Resolution: ${config.resolution}.`;

  logger(`[ComfyUI Video] 准备文生视频工作流`);
  const workflow = prepareWorkflow(rawJson, enhancedPrompt);
  return await submitAndWait(workflow, baseUrl);
};

// ============================================================
// TTS (暂不支持)
// ============================================================
const ttsRequest = async (config: TTSConfig, model: TTSModel): Promise<string> => {
  throw new Error("ComfyUI TTS 暂未实现");
};

// ============================================================
// 导出
// ============================================================
exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;

export {};
