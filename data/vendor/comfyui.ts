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
// 优先使用供应商设置中的自定义工作流配置
// ============================================================

// 文生图工作流：默认空（用户必须配置）
// 使用方式：
//   1. ComfyUI 菜单 → Save (API Format) 导出 JSON
//   2. 将 CLIPTextEncode 节点的 text 字段改为 "__PROMPT__"
//   3. 粘贴到设置中心 "文生图工作流 JSON" 字段
// 或使用 file:// 路径：
//   file://E:/AI/ComfyAI_Video-ShortVideo/工作流/文生图_API.json
const IMAGE_WORKFLOW_JSON = "";

// 文生视频工作流：使用 LTX2.3 单图视频工作流
// 用户可在设置中通过 videoWorkflowJson 覆盖
const VIDEO_WORKFLOW_JSON = "";

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
1. 确保 ComfyUI 已启动并可访问
2. 工作流 JSON 必须使用 ComfyUI "Save (API Format)" 导出
3. 导出的 JSON 中 CLIPTextEncode 节点的 text 字段必须改为 \`__PROMPT__\`

**已配置的工作流文件（均含 \`__PROMPT__\` 占位符）：**

文生图: \`file://E:/AI/Toonflow-app/ComfyUI/workflows/LTX2.3_Image.json\`
文生视频: \`file://E:/AI/Toonflow-app/ComfyUI/workflows/LTX2.3_frameVideo.json\`

**注意：** ComfyUI 不支持文本请求，Agent 配置中文本模型务必指向 openai（Qwen3）`,
  icon: "",
  inputs: [
    { key: "baseUrl", label: "ComfyUI 地址", type: "url", required: true, placeholder: "http://localhost:8188" },
    { key: "imageWorkflowJson", label: "文生图工作流 JSON", type: "text", required: false, placeholder: "必填：粘贴 Save (API Format) 的 JSON 或 file:// 路径" },
    { key: "videoWorkflowJson", label: "文生视频工作流 JSON", type: "text", required: false, placeholder: "必填：粘贴 Save (API Format) 的 JSON 或 file:// 路径" },
  ],
  inputValues: {
    baseUrl: "http://localhost:8188",
    imageWorkflowJson: "file://E:/AI/Toonflow-app/ComfyUI/workflows/image_z_image_turbo.json",
    videoWorkflowJson: "file://E:/AI/Toonflow-app/ComfyUI/workflows/LTX2.3_frameVideo.json",
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

/** 移除工作流中已知有 bug 的节点并修复引用 */
function sanitizeWorkflow(workflow: Record<string, any>): Record<string, any> {
  // 已知有问题的节点类型
  const BUGGY_NODES = new Set(["LTX2SamplingPreviewOverride", "LTX2SamplingPreviewOverrrideKJ", "PreviewOverrideKJ"]);
  
  // 找出所有有问题的节点 ID
  const badIds = new Set<string>();
  for (const [id, node] of Object.entries(workflow)) {
    if (BUGGY_NODES.has((node as any).class_type || "")) {
      badIds.add(id);
    }
  }
  if (badIds.size === 0) return workflow;
  
  logger(`[ComfyUI] 发现 ${badIds.size} 个有 bug 的预览节点: [${Array.from(badIds).join(", ")}]，正在移除...`);
  
  // 收集：每个输入源 → 需要修复的引用
  // bad 节点的 inputs.model 格式为 ["sourceId", outputIndex]
  // 需要找到所有引用 badId 的节点，将它们指向 bad 节点的输入源
  const rewrites: Map<string, { fromId: string; toRef: [string, number] }[]> = new Map();
  
  for (const badId of badIds) {
    const badNode = workflow[badId];
    if (!badNode) continue;
    // bad 节点的 model 输入: ["sourceId", outputIndex]
    const modelInput = badNode.inputs?.model;
    if (!Array.isArray(modelInput) || modelInput.length < 2) continue;
    const [sourceId, outputIdx] = modelInput as [string, number];
    
    // 找到所有引用 badId 的节点
    for (const [id, node] of Object.entries(workflow)) {
      if (badIds.has(id)) continue;
      const n = node as any;
      if (!n.inputs) continue;
      for (const [key, val] of Object.entries(n.inputs)) {
        if (Array.isArray(val) && val.length >= 2 && val[0] === badId) {
          // 这个节点的 key 输入引用了 badId
          if (!rewrites.has(id)) rewrites.set(id, []);
          rewrites.get(id)!.push({ fromId: badId, toRef: [sourceId, outputIdx] });
        }
      }
    }
  }
  
  // 执行重写
  for (const [nodeId, refs] of rewrites) {
    const node = workflow[nodeId];
    if (!node) continue;
    for (const ref of refs) {
      for (const [key, val] of Object.entries(node.inputs)) {
        if (Array.isArray(val) && val.length >= 2 && val[0] === ref.fromId) {
          node.inputs[key] = ref.toRef;
          logger(`[ComfyUI] 重写节点 ${nodeId}.${key}: [${ref.fromId}, ${val[1]}] → [${ref.toRef[0]}, ${ref.toRef[1]}]`);
        }
      }
    }
  }
  
  // 删除有 bug 的节点
  for (const badId of badIds) {
    delete workflow[badId];
    logger(`[ComfyUI] 已移除问题节点: ${badId}`);
  }
  
  return workflow;
}

/** 解析工作流 JSON 并注入 prompt，同时替换 LoadImage 节点为上传的文件名 */
function prepareWorkflow(rawJson: string, prompt: string, uploadedFiles?: string[]): object {
  const parsed = JSON.parse(rawJson);
  const promptObj = parsed.prompt || parsed; // 兼容 { prompt: {...} } 或直接对象
  let workflow = sanitizeWorkflow(promptObj);
  workflow = replacePrompt(workflow, prompt);
  
  // 如果有上传的图片文件，替换所有 LoadImage 节点的 image 字段
  if (uploadedFiles && uploadedFiles.length > 0) {
    let fileIdx = 0;
    for (const [nodeId, node] of Object.entries(workflow)) {
      const n = node as any;
      if (n.class_type === "LoadImage" && n.inputs?.image) {
        // 替换为上传的文件名
        const newFile = uploadedFiles[fileIdx % uploadedFiles.length];
        logger(`[ComfyUI] 替换 LoadImage 节点 ${nodeId}: ${n.inputs.image} → ${newFile}`);
        n.inputs.image = newFile;
        fileIdx++;
      }
    }
  }
  
  return workflow;
}

// 注意：VM2 沙箱无 Buffer/atob/Blob，无法动态上传参考图到 ComfyUI。
// 如需使用参考图，请预先将图片放入 ComfyUI 的 input/ 目录，
// 并在 workflow 的 LoadImage 节点中引用对应文件名。

/** 等待指定毫秒（vm2 沙箱中 setTimeout 不可靠，使用 Date 轮询） */
function sleep(ms: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // busy-wait (vm2 沙箱中 Promise+setTimeout 不可靠)
  }
  return Promise.resolve();
}

/**
 * 标准化节点 ID：将非标准节点 ID（如 "57:30"）转为简单整数 ID（如 "1"）
 * ComfyUI v0.18+ 对含冒号的节点 ID 支持不稳定，此函数确保所有 ID 合规
 */
function normalizeNodeIds(workflow: object): object {
  const oldIds = Object.keys(workflow);

  // 检查是否需要标准化（只要有一个 ID 不是纯数字就需要）
  const needsNormalization = oldIds.some(id => !/^\d+$/.test(id));
  if (!needsNormalization) return workflow;

  logger(`[ComfyUI] 标准化节点 ID: ${oldIds.length} 个节点 (例如 ${oldIds[0]} → 1)`);

  // 生成旧 ID → 新 ID 的映射
  const idMap: Record<string, string> = {};
  let nextId = 1;
  for (const oldId of oldIds) {
    idMap[oldId] = String(nextId++);
  }

  /** 递归重映射工作流中所有节点引用 (["57:8", 0] → ["3", 0]) */
  function remap(obj: any): any {
    if (Array.isArray(obj)) {
      // ComfyUI 节点引用格式: [nodeId, outputIndex]
      if (obj.length === 2 && typeof obj[0] === "string" && idMap[obj[0]] !== undefined) {
        return [idMap[obj[0]], obj[1]];
      }
      return obj.map(remap);
    }
    if (obj && typeof obj === "object") {
      const result: any = {};
      for (const [k, v] of Object.entries(obj)) {
        result[k] = remap(v);
      }
      return result;
    }
    return obj;
  }

  // 构建标准化后的工作流
  const normalized: any = {};
  for (const [oldId, nodeData] of Object.entries(workflow)) {
    normalized[idMap[oldId]] = remap(nodeData);
  }

  logger(`[ComfyUI] 标准化完成: ${Object.keys(normalized).length} 个节点`);
  return normalized;
}

/** 从 ComfyUI 输出节点中提取第一个媒体文件 URL */
function findFirstMedia(outputs: Record<string, any>, baseUrl: string): string | null {
  for (const nodeId of Object.keys(outputs)) {
    const output = outputs[nodeId];
    if (!output || typeof output !== "object") continue;

    // ComfyUI 标准输出类型: images, gifs, video, files
    const mediaKeys = ["images", "gifs", "video", "files"];
    for (const key of mediaKeys) {
      const items = output[key] || [];
      if (items.length > 0) {
        const m = items[0];
        const filename = m.filename || m.name;
        if (filename) {
          return `${baseUrl}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(m.subfolder || "")}&type=${encodeURIComponent(m.type || "output")}`;
        }
      }
    }
  }
  return null;
}

/** 提交工作流到 ComfyUI 并轮询，返回结果 URL（host 负责转 base64） */
async function submitAndWait(workflow: object, baseUrl: string, retries = 2): Promise<string> {
  // 标准化节点 ID（将 "57:30" 转为简单整数，规避 ComfyUI v0.18+ 的兼容问题）
  workflow = normalizeNodeIds(workflow);

  logger(`[ComfyUI] 提交生成任务...`);

  // 检查工作流结构
  const nodeIds = Object.keys(workflow);
  const classTypes = nodeIds.map(id => workflow[id]?.class_type || "???");
  logger(`[ComfyUI] 节点数: ${nodeIds.length}, 节点类型: [${classTypes.slice(0, 5).join(", ")}${classTypes.length > 5 ? "..." : ""}]`);

  // 验证工作流节点 ID 和值类型
  for (const id of nodeIds) {
    const val = workflow[id];
    if (typeof val !== "object" || val === null) {
      throw new Error(
        `ComfyUI 工作流错误: 节点 "${id}" 的值类型为 ${typeof val}，应为对象。\n` +
        `这通常是因为工作流使用了错误的导出格式。\n` +
        `请确保在 ComfyUI 中使用 "Save (API Format)" 导出，而不是普通保存。\n` +
        `如果节点 ID 包含冒号 (如 "${id}")，说明是从 ComfyUI-Easy-Use 等插件导出的非标准格式，请使用标准导出方式。`
      );
    }
    // 检查节点 ID 是否包含冒号（非标准格式）
    if (id.includes(":")) {
      logger(`[ComfyUI] 警告: 节点 ID "${id}" 包含冒号，这可能是非标准 API 格式，ComfyUI v0.18+ 可能拒绝此工作流`);
    }
  }

  const body = JSON.stringify({ prompt: workflow });
  logger(`[ComfyUI] 请求体大小: ${body.length} bytes`);

  const submitRes = await fetch(`${baseUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!submitRes.ok) {
    const errText = await submitRes.text();
    const truncated = errText.length > 500 ? errText.substring(0, 500) + "..." : errText;

    // 增强错误提示：检测常见问题
    let hint = "";
    if (errText.includes("validate_prompt") || errText.includes("node_data.get")) {
      hint = "\n\n可能原因：工作流格式不被当前 ComfyUI 版本兼容。请尝试：\n" +
        "1. 在 ComfyUI 中打开工作流\n" +
        "2. 菜单 → Save (API Format) 重新导出\n" +
        "3. 将新导出的 JSON 配置到 Toonflow 设置 → 模型服务 → ComfyUI";
    } else if (errText.includes("out of memory") || errText.includes("CUDA")) {
      hint = "\n\n可能原因：显存不足，请关闭其他 GPU 应用后重试";
    }

    throw new Error(`ComfyUI 提交失败 (${submitRes.status}): ${truncated}${hint}`);
  }
  const submitData = await submitRes.json();
  const promptId = submitData.prompt_id;
  logger(`[ComfyUI] 任务 ID: ${promptId}`);

  const startTime = Date.now();

  const pollResult = await pollTask(async () => {
    const histRes = await fetch(`${baseUrl}/history/${promptId}`);
    if (!histRes.ok) return { completed: false };
    const history = await histRes.json();
    const entry = history[promptId];
    if (!entry) return { completed: false };

    // 检测 0 秒完成（显存不足/队列异常），重试
    if (entry.status?.completed) {
      const execTime = entry.status?.execution_time;
      const elapsed = execTime ?? (Date.now() - startTime) / 1000;
      const outputs = entry.outputs || {};
      const outputCount = Object.keys(outputs).length;

      logger(`[ComfyUI] 完成检查: exec_time=${execTime}s, elapsed=${elapsed.toFixed(2)}s, outputs=${outputCount}, retries=${retries}`);

      // 检查所有类型的媒体输出 (images, gifs, video, files)
      const fileUrl = findFirstMedia(outputs, baseUrl);
      if (fileUrl) {
        logger(`[ComfyUI] 生成完成 (${elapsed.toFixed(1)}s)`);
        return { completed: true, data: fileUrl };
      }

      // 无输出 + 执行时间极短（<3s）→ 可能是队列异常，重试
      if (outputCount === 0 && elapsed < 3.0 && retries > 0) {
        logger(`[ComfyUI] 检测到异常快速完成 (${elapsed.toFixed(2)}s, 无输出)，重试中...`);
        return { completed: true, error: "__RETRY__" };
      }

      return { completed: true, error: "输出中没有找到媒体文件" };
    }
    if (entry.status?.status_str === "error") {
      // 即使 ComfyUI 报 error（如预览回调崩溃），也可能已有生成结果
      // 先检查 outputs 中是否有媒体文件
      const outputs = entry.outputs || {};
      const fileUrl = findFirstMedia(outputs, baseUrl);
      if (fileUrl) {
        logger(`[ComfyUI] 状态为 error 但已有输出文件，视为成功`);
        return { completed: true, data: fileUrl };
      }
      return { completed: true, error: entry.status?.error_message || "ComfyUI 生成失败" };
    }
    return { completed: false };
  }, 2000, 2700000); // 轮询间隔 2 秒，超时 45 分钟

  // 0 秒完成重试逻辑（使用忙等待替代 setTimeout）
  if (pollResult.error === "__RETRY__" && retries > 0) {
    logger(`[ComfyUI] 重试第 ${3 - retries + 1} 次...`);
    await sleep(3000);
    return submitAndWait(workflow, baseUrl, retries - 1);
  }

  if (pollResult.error) {
    // 尝试中断 ComfyUI 当前任务（如果有卡住的任务）
    try { await fetch(`${baseUrl}/interrupt`, { method: "POST" }); } catch {}
    throw new Error(`ComfyUI 生成失败: ${pollResult.error}`);
  }
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

  if (!customJson) {
    throw new Error(
      `ComfyUI 文生图工作流未配置。请按以下步骤操作：\n` +
      `1. 打开 ComfyUI Web UI (${baseUrl})\n` +
      `2. 加载或创建一个可用的文生图工作流\n` +
      `3. 菜单 → Save (API Format) 导出为 JSON\n` +
      `4. 将 CLIPTextEncode 节点的 text 字段改为 __PROMPT__\n` +
      `5. 在 Toonflow 设置 → 模型服务 → ComfyUI → "文生图工作流 JSON" 中粘贴该 JSON`
    );
  }

  logger(`[ComfyUI Image] 使用自定义工作流`);
  const workflow = prepareWorkflow(customJson, config.prompt);
  return await submitAndWait(workflow, baseUrl);
};

// ============================================================
// 视频请求
// ============================================================
const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  const baseUrl = vendor.inputValues.baseUrl;
  const customJson = vendor.inputValues.videoWorkflowJson || "";

  if (!customJson) {
    throw new Error(
      `ComfyUI 文生视频工作流未配置。请按以下步骤操作：\n` +
      `1. 打开 ComfyUI Web UI (${baseUrl})\n` +
      `2. 加载或创建一个可用的视频工作流（如 LTX2.3 单图视频）\n` +
      `3. 菜单 → Save (API Format) 导出为 JSON\n` +
      `4. 将 CLIPTextEncode 节点的 text 字段改为 __PROMPT__\n` +
      `5. 在 Toonflow 设置 → 模型服务 → ComfyUI → "文生视频工作流 JSON" 中粘贴该 JSON\n` +
      `   或使用 file:// 路径: file://E:/AI/ComfyAI_Video-ShortVideo/工作流/LTX2.3/LTX2.3单图视频.json`
    );
  }

  logger(`[ComfyUI Video] 使用自定义工作流`);

  // ── 上传参考图片到 ComfyUI input 目录 ──
  // 工作流中的 LoadImage 节点需要从磁盘加载文件，必须提前上传
  // 如果未提供图片，生成一个 1x1 透明占位 PNG
  const uploadedFiles: string[] = [];
  const ts = Date.now();
  const imageCount = Math.max(1, config.imageBase64?.length || 0);
  logger(`[ComfyUI Video] 处理 ${imageCount} 张参考图片...`);
  for (let i = 0; i < imageCount; i++) {
    let b64 = config.imageBase64?.[i] || "";
    const filename = `toonflow_video_${ts}_${i}.png`;
    try {
      // 如果没有 base64 数据，生成一个 1x1 透明 PNG
      if (!b64) {
        // 1x1 透明 PNG 的 base64（极小占位图）
        b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
      }
      const cleanB64 = b64.includes(",") ? b64.split(",")[1] : b64;
      const imgBuffer = Buffer.from(cleanB64, "base64");
      // 用 Buffer 构造 multipart body（vm2 沙箱中 TextEncoder 不可用）
      const boundary = `----ToonflowBoundary${Date.now()}`;
      const header = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`);
      const footer = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n--${boundary}--\r\n`);
      const merged = Buffer.concat([header, imgBuffer, footer]);
      
      const uploadRes = await fetch(`${baseUrl}/upload/image`, {
        method: "POST",
        headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
        body: merged,
      });
      if (uploadRes.ok) {
        logger(`[ComfyUI Video] 图片 ${i} 上传成功: ${filename}`);
        uploadedFiles.push(filename);
      } else {
        logger(`[ComfyUI Video] 图片 ${i} 上传失败: ${uploadRes.status}`);
      }
    } catch (e: any) {
      logger(`[ComfyUI Video] 图片 ${i} 上传异常: ${e.message}`);
    }
  }

  // 将 duration/resolution 信息拼入 prompt
  let enhancedPrompt = config.prompt;
  if (config.duration) enhancedPrompt += ` Duration: ${config.duration}s.`;
  if (config.resolution) enhancedPrompt += ` Resolution: ${config.resolution}.`;

  const workflow = prepareWorkflow(customJson, enhancedPrompt, uploadedFiles.length > 0 ? uploadedFiles : undefined);
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
