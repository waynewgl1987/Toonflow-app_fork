import { generateText, streamText, wrapLanguageModel, stepCountIs, extractReasoningMiddleware } from "ai";
import { devToolsMiddleware } from "@ai-sdk/devtools";
import axios from "axios";
import { transform } from "sucrase";
import * as fs from "fs";
import * as path from "path";
import u from "@/utils";
import logger from "@/logger";
import { ensureService, getServiceStatus } from "@/utils/serviceManager";
import net from "net";

type AiType =
  | "scriptAgent"
  | "productionAgent"
  | "universalAi"
  | "scriptAgent:decisionAgent"
  | "scriptAgent:supervisionAgent"
  | "scriptAgent:storySkeletonAgent"
  | "scriptAgent:adaptationStrategyAgent"
  | "scriptAgent:scriptAgent"
  | "productionAgent:decisionAgent"
  | "productionAgent:supervisionAgent"
  | "productionAgent:deriveAssetsAgent"
  | "productionAgent:generateAssetsAgent"
  | "productionAgent:directorPlanAgent"
  | "productionAgent:storyboardGenAgent"
  | "productionAgent:storyboardPanelAgent"
  | "productionAgent:storyboardTableAgent";

type FnName = "textRequest" | "imageRequest" | "videoRequest" | "ttsRequest";

const AiTypeValues: AiType[] = [
  "scriptAgent",
  "productionAgent",
  "universalAi",
  "scriptAgent:decisionAgent",
  "scriptAgent:supervisionAgent",
  "scriptAgent:storySkeletonAgent",
  "scriptAgent:adaptationStrategyAgent",
  "scriptAgent:scriptAgent",
  "productionAgent:decisionAgent",
  "productionAgent:supervisionAgent",
  "productionAgent:deriveAssetsAgent",
  "productionAgent:generateAssetsAgent",
  "productionAgent:directorPlanAgent",
  "productionAgent:storyboardGenAgent",
  "productionAgent:storyboardPanelAgent",
  "productionAgent:storyboardTableAgent",
  "universalAi",
];
async function resolveModelName(value: AiType | `${string}:${string}`): Promise<`${string}:${string}`> {
  if (AiTypeValues.includes(value as AiType)) {
    const agentUseModeVal = await u.db("o_setting").where("key", "agentUseMode").first();

    //正常流程
    //高级配置
    if (agentUseModeVal?.value == "1") {
      const agentDeployData = await u.db("o_agentDeploy").where("key", value).first();
      if (!agentDeployData?.modelName) throw new Error(`高级配置模式下，未找到对应的模型配置 ${value}`);
      return agentDeployData?.modelName as `${number}:${string}`;
    }
    //简易配置
    if (agentUseModeVal?.value == "0") {
      const [mainly] = value!.split(/:(.+)/);
      const mainlyData = await u.db("o_agentDeploy").where("key", mainly).first();
      if (!mainlyData?.modelName) throw new Error(`简易配置模式下，未找到部署配置 ${value}`);
      return mainlyData?.modelName as `${number}:${string}`;
    }

    //未查到agentUseModeVal 维持原判断
    const agentDeployData = await u.db("o_agentDeploy").where("key", value).first();
    let modelName = null;

    if (!agentDeployData?.modelName) {
      const [mainly] = agentDeployData!.key!.split(/:(.+)/);
      const mainlyData = await u.db("o_agentDeploy").where("key", mainly).first();
      if (!mainlyData?.modelName) throw new Error(`未找到部署配置 ${value}`);
      modelName = mainlyData.modelName;
    }
    modelName = agentDeployData?.modelName || modelName;
    return modelName as `${number}:${string}`;
  }
  return value as `${number}:${string}`;
}

async function getModelConfig(value: AiType | `${string}:${string}`) {
  if (AiTypeValues.includes(value as AiType)) {
    const agentUseModeVal = await u.db("o_setting").where("key", "agentUseMode").first();
    //正常流程
    //高级配置
    if (agentUseModeVal?.value == "1") {
      const agentDeployData = await u.db("o_agentDeploy").where("key", value).first();
      if (!agentDeployData?.modelName) throw new Error(`高级配置模式下，未找到对应的模型配置 ${value}`);
      return agentDeployData;
    }
    //简易配置
    if (agentUseModeVal?.value == "0") {
      const [mainly] = value!.split(/:(.+)/);
      const mainlyData = await u.db("o_agentDeploy").where("key", mainly).first();
      if (!mainlyData?.modelName) throw new Error(`简易配置模式下，未找到部署配置 ${value}`);
      return mainlyData;
    }

    //未查到 agentUseModelVal 维持原流程
    const agentDeployData = await u.db("o_agentDeploy").where("key", value).first();

    if (!agentDeployData?.modelName) {
      const [mainly] = agentDeployData!.key!.split(/:(.+)/);
      const mainlyData = await u.db("o_agentDeploy").where("key", mainly).first();
      if (!mainlyData?.modelName) throw new Error(`未找到部署配置 ${value}`);
      return mainlyData;
    }
    return agentDeployData;
  }
  return null;
}

async function getVendorTemplateFn(
  fnName: "textRequest",
  modelName: `${string}:${string}`,
): Promise<(think?: boolean, thinkLevel?: 0 | 1 | 2 | 3) => any>;
async function getVendorTemplateFn(fnName: Exclude<FnName, "textRequest">, modelName: `${string}:${string}`): Promise<(input: any) => any>;
async function getVendorTemplateFn(fnName: FnName, modelName: `${string}:${string}`): Promise<any> {
  const [id, name] = modelName.split(/:(.+)/);

  // 自动管理服务：在调用前确保所需服务已启动
  await ensureService(fnName, id);

  const vendorConfigData = await u.db("o_vendorConfig").where("id", id).first();
  if (!vendorConfigData) throw new Error(`未找到供应商配置 id=${id}`);
  const modelList = await u.vendor.getModelList(id);
  const selectedModel = modelList.find((i: any) => i.modelName == name);
  if (!selectedModel) throw new Error(`未找到模型 ${name} id=${id}`);
  const code = u.vendor.getCode(id);
  const jsCode = transform(code, { transforms: ["typescript"] }).code;
  const running = u.vm(jsCode);
  if (running.vendor) {
    const inputValues = JSON.parse(vendorConfigData.inputValues ?? "{}");
    // 支持 file:// 路径加载工作流 JSON 文件（在沙箱外读取）
    for (const key of Object.keys(inputValues)) {
      if (typeof inputValues[key] === "string" && inputValues[key].startsWith("file://")) {
        const filePath = inputValues[key].slice(7);
        if (!fs.existsSync(filePath)) continue;
        inputValues[key] = fs.readFileSync(filePath, "utf-8");
      }
    }
    // 后备方案：如果数据库未配置工作流，尝试读取默认路径的 API 格式文件
    const defaultWorkflows: Record<string, string> = {
      imageWorkflowJson: path.join(process.cwd(), "ComfyUI", "workflows", "image_z_image_turbo.json"),
      videoWorkflowJson: path.join(process.cwd(), "ComfyUI", "workflows", "LTX2.3_singleVideo.json"),
      frameVideoWorkflowJson: path.join(process.cwd(), "ComfyUI", "workflows", "LTX2.3_frameVideo.json"),
    };
    for (const [key, defaultPath] of Object.entries(defaultWorkflows)) {
      if (!inputValues[key] || inputValues[key] === "{}" || (typeof inputValues[key] === "string" && inputValues[key].startsWith("file://"))) {
        if (fs.existsSync(defaultPath)) {
          const content = fs.readFileSync(defaultPath, "utf-8");
          try {
            const parsed = JSON.parse(content);
            if (parsed && typeof parsed === "object" && "id" in parsed && "nodes" in parsed) {
              console.warn(`[ComfyUI] ${key} 默认文件 ${defaultPath} 是 UI 格式，请用 "Save (API Format)" 重新导出`);
              continue;
            }
            if (Object.keys(parsed).length > 0) {
              inputValues[key] = content;
            }
          } catch {}
        }
      }
    }
    Object.assign(running.vendor.inputValues, inputValues);
    running.vendor.models = modelList;
  }
  const fn = running[fnName];
  if (!fn) throw new Error(`未找到供应商配置中的函数 ${fnName} id=${id}`);
  if (fnName == "textRequest")
    return (think?: boolean, thinkLevel: 0 | 1 | 2 | 3 = 0) => {
      const effectiveThink = think ?? !!selectedModel.think;
      return fn(selectedModel, effectiveThink, thinkLevel);
    };
  else return <T>(input: T) => fn(input, selectedModel);
}

async function withTaskRecord<T>(
  modelKey: AiType | `${string}:${string}`,
  taskClass: string,
  describe: string,
  relatedObjects: string,
  projectId: number,
  fn: (modelName: `${string}:${string}`, think: Boolean, thinkLevel: 0 | 1 | 2 | 3) => Promise<T>,
): Promise<T> {
  const modelName = await resolveModelName(modelKey);
  const [_, model] = modelName.split(/:(.+)/);
  const recordId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  logger.genLog({ event: "ai_call_start", recordId, modelKey, model, taskClass, describe, projectId, relatedObjects });
  const taskRecord = await u.task(projectId, taskClass, model, { describe: describe, content: relatedObjects });
  try {
    const result = await fn(modelName, false, 0);

    taskRecord(1);
    logger.genLog({ event: "ai_call_success", recordId, modelKey, model, taskClass, projectId });
    return result;
  } catch (e) {
    const errMsg = u.error(e).message;
    taskRecord(-1, errMsg);
    logger.genLog({ event: "ai_call_error", recordId, modelKey, model, taskClass, projectId, error: errMsg, stack: (e as Error).stack });
    throw new Error(errMsg);
  }
}

async function urlToBase64(url: string, retries = 3, delay = 1000): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(url, { responseType: "arraybuffer" });
      const base64 = Buffer.from(res.data).toString("base64");
      return `${base64}`;
    } catch (e) {
      if (attempt === retries) throw e;
      await new Promise((resolve) => setTimeout(resolve, delay * attempt));
    }
  }
  throw new Error("urlToBase64 failed");
}
class AiText {
  private AiType: AiType | `${string}:${string}`;
  private think?: boolean;
  private thinkLevel: 0 | 1 | 2 | 3;
  private recordId: string;
  constructor(AiType: AiType | `${string}:${string}`, think?: boolean, thinkLevel: 0 | 1 | 2 | 3 = 0) {
    this.AiType = AiType;
    this.think = think;
    this.thinkLevel = thinkLevel;
    this.recordId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  private async resolveModel(middleware?: any | any[]) {
    const switchAiDevTool = await u.db("o_setting").where("key", "switchAiDevTool").first();
    const modelName = await resolveModelName(this.AiType);
    const sdkFn = await getVendorTemplateFn("textRequest", modelName);
    const baseModel = await sdkFn(this.think, this.thinkLevel);
    const mws = [
      ...(switchAiDevTool?.value === "1" ? [devToolsMiddleware()] : []),
      ...(middleware ? (Array.isArray(middleware) ? middleware : [middleware]) : []),
    ];
    return mws.length > 0 ? wrapLanguageModel({ model: baseModel, middleware: mws.length === 1 ? mws[0] : mws }) : baseModel;
  }
  async invoke(input: Omit<Parameters<typeof generateText>[0], "model">) {
    const config = await getModelConfig(this.AiType);
    const modelName = await resolveModelName(this.AiType);
    logger.genLog({ event: "text_invoke_start", recordId: this.recordId, aiType: this.AiType, modelName, inputSnippet: JSON.stringify(input).slice(0, 200) });
    try {
      const result = await generateText({
        ...(input.tools && { stopWhen: stepCountIs(Object.keys(input.tools).length * 50) }),
        ...input,
        model: await this.resolveModel(),
        ...(config?.temperature && { temperature: config.temperature }),
        ...(config?.maxOutputTokens && { maxOutputTokens: config.maxOutputTokens }),
      } as Parameters<typeof generateText>[0]);
      logger.genLog({ event: "text_invoke_success", recordId: this.recordId, aiType: this.AiType, modelName, usage: result.usage });
      return result;
    } catch (e) {
      logger.genLog({ event: "text_invoke_error", recordId: this.recordId, aiType: this.AiType, modelName, error: (e as Error).message, stack: (e as Error).stack });
      throw e;
    }
  }
  async stream(input: Omit<Parameters<typeof streamText>[0], "model">) {
    const config = await getModelConfig(this.AiType);
    const modelName = await resolveModelName(this.AiType);
    logger.genLog({ event: "text_stream_start", recordId: this.recordId, aiType: this.AiType, modelName, inputSnippet: JSON.stringify(input).slice(0, 200) });
    try {
      const result = await streamText({
        ...(input.tools && { stopWhen: stepCountIs(Object.keys(input.tools).length * 50) }),
        ...input,
        model: await this.resolveModel(extractReasoningMiddleware({ tagName: "reasoning_content", separator: "\n" })),
        ...(config?.temperature && { temperature: config.temperature }),
        ...(config?.maxOutputTokens && { maxOutputTokens: config.maxOutputTokens }),
      } as Parameters<typeof streamText>[0]);
      logger.genLog({ event: "text_stream_success", recordId: this.recordId, aiType: this.AiType, modelName });
      return result;
    } catch (e) {
      logger.genLog({ event: "text_stream_error", recordId: this.recordId, aiType: this.AiType, modelName, error: (e as Error).message, stack: (e as Error).stack });
      throw e;
    }
  }
}

function referenceList2imageBase642(id: string, input: any) {
  const version = u.vendor.getVendor(id).version;
  const refCount = input.referenceList?.length || 0;
  logger.genLog({ event: "video_ref2b64", vendorId: id, version, refCount, hasRef: !!input.referenceList });
  if (!version || isNaN(parseFloat(version)) || parseFloat(version) < 2.0) {
    const b64List = input.referenceList?.map((item: any) => {
      const b64 = item?.base64 || "";
      return { type: item?.type, len: b64.length, preview: b64.slice(0, 30) };
    }) || [];
    input.imageBase64 = input.referenceList?.map((item: any) => item.base64) || [];
    logger.genLog({ event: "video_ref2b64_result", vendorId: id, copied: true, imageCount: input.imageBase64.length, details: b64List });
    return input;
  }
  logger.genLog({ event: "video_ref2b64_result", vendorId: id, copied: false, reason: `version=${version} >= 2.0` });
  return input;
}

export type ReferenceList = { type: "image"; base64: string } | { type: "audio"; base64: string } | { type: "video"; base64: string };

interface ImageConfig {
  prompt: string;
  referenceList?: Extract<ReferenceList, { type: "image" }>[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
  /** 可选种子：同一场景共享，实现跨帧一致性。不传则由供应商自行决定 */
  seed?: number;
}

interface TaskRecord {
  taskClass: string; // 任务分类
  describe: string; // 任务描述
  relatedObjects: string; // 相关对象信息，便于后续分析和追踪
  projectId: number; // 项目ID
}

class AiImage {
  private key: `${string}:${string}`;
  private result: string = "";
  private recordId: string;
  constructor(key: `${string}:${string}`) {
    this.key = key;
    this.recordId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  async run(input: ImageConfig, taskRecord?: TaskRecord) {
    const modelName = await resolveModelName(this.key);
    logger.genLog({ event: "image_run_start", recordId: this.recordId, key: this.key, modelName, prompt: input.prompt?.slice(0, 200), size: input.size, taskClass: taskRecord?.taskClass, projectId: taskRecord?.projectId });
    const exec = async (mn: `${string}:${string}`) => {
      const fn = await getVendorTemplateFn("imageRequest", mn);
      await referenceList2imageBase642(mn.split(/:(.+)/)[0], input);
      logger.genLog({ event: "image_vendor_call", recordId: this.recordId, key: this.key, phase: "调用供应商 imageRequest" });
      this.result = await fn(input);
      logger.genLog({ event: "image_vendor_result", recordId: this.recordId, key: this.key, phase: "供应商返回结果", resultType: typeof this.result, startsWithHttp: this.result.startsWith("http"), length: this.result.length });
      if (this.result.startsWith("http")) {
        logger.genLog({ event: "image_download_start", recordId: this.recordId, key: this.key, phase: "开始从 URL 下载图片转 base64" });
        this.result = await urlToBase64(this.result);
        logger.genLog({ event: "image_download_done", recordId: this.recordId, key: this.key, phase: "下载完成", base64Length: this.result.length });
      }
      // 更新进度: 下载完成，准备保存
      if (taskRecord) {
        try { updateGeneration(taskRecord.projectId, { status: "downloading" }); } catch {}
      }
      return this;
    };
    try {
      if (taskRecord) {
        await withTaskRecord(this.key, taskRecord.taskClass, taskRecord.describe, taskRecord.relatedObjects, taskRecord.projectId, exec);
        logger.genLog({ event: "image_run_success", recordId: this.recordId, key: this.key });
        // 生成成功，重置 ComfyUI 失败计数
        try { const { resetComfyFailure } = await import("@/utils/serviceManager"); resetComfyFailure(); } catch {}
        return this;
      }
      await exec(modelName);
      logger.genLog({ event: "image_run_success", recordId: this.recordId, key: this.key });
      try { const { resetComfyFailure } = await import("@/utils/serviceManager"); resetComfyFailure(); } catch {}
      return this;
    } catch (e) {
      logger.genLog({ event: "image_run_error", recordId: this.recordId, key: this.key, error: (e as Error).message, stack: (e as Error).stack });
      if ((e as Error).message?.includes("输出中没有找到媒体文件")) {
        try {
          const { recordComfyFailure, resetComfyFailure } = await import("@/utils/serviceManager");
          if (recordComfyFailure()) {
            console.log("[ComfyUI] 连续生成失败，将在下次调用时重启 ComfyUI");
          }
        } catch {}
      }
      throw e;
    }
  }

  async save(path: string) {
    logger.genLog({ event: "image_save_start", recordId: this.recordId, path, base64Length: this.result?.length || 0 });
    try {
      await u.oss.writeFile(path, this.result);
      // 验证文件是否写入成功
      const exists = await u.oss.fileExists(path);
      logger.genLog({ event: "image_save_result", recordId: this.recordId, path, exists });
    } catch (e) {
      logger.genLog({ event: "image_save_error", recordId: this.recordId, path, error: (e as Error).message });
      throw e;
    }
    return this;
  }
}

type VideoMode =
  | "singleImage" //单图参考
  | "startEndRequired" //首尾帧（两张都得有）
  | "endFrameOptional" //首尾帧（尾帧可选）
  | "startFrameOptional" //首尾帧（首帧可选）
  | "text" //文本
  | (`videoReference:${number}` | `imageReference:${number}` | `audioReference:${number}`)[]; //多参考（数字代表限制数量）

interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  referenceList?: ReferenceList[];
  audio?: boolean;
  mode: VideoMode[];
}

class AiVideo {
  private key: `${string}:${string}`;
  private result: string = "";
  private recordId: string;
  constructor(key: `${string}:${string}`) {
    this.key = key;
    this.recordId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  async run(input: VideoConfig, taskRecord?: TaskRecord) {
    const modelName = await resolveModelName(this.key);
    logger.genLog({ event: "video_run_start", recordId: this.recordId, key: this.key, modelName, prompt: input.prompt?.slice(0, 200), taskClass: taskRecord?.taskClass, projectId: taskRecord?.projectId });
    try {
      const exec = async (mn: `${string}:${string}`) => {
        const fn = await getVendorTemplateFn("videoRequest", mn);
        await referenceList2imageBase642(mn.split(/:(.+)/)[0], input);
        logger.genLog({ event: "video_vendor_call", recordId: this.recordId, modelName: mn, imgCount: input.imageBase64?.length || 0, imgSizes: (input.imageBase64 || []).map((b: string) => (b || "").length) });

        this.result = await fn(input);

        if (this.result.startsWith("http")) this.result = await urlToBase64(this.result);
      };
      if (taskRecord) {
        await withTaskRecord(this.key, taskRecord.taskClass, taskRecord.describe, taskRecord.relatedObjects, taskRecord.projectId, exec);
        logger.genLog({ event: "video_run_success", recordId: this.recordId, key: this.key });
        return this;
      }
      await exec(modelName);
      logger.genLog({ event: "video_run_success", recordId: this.recordId, key: this.key });
      return this;
    } catch (e) {
      logger.genLog({ event: "video_run_error", recordId: this.recordId, key: this.key, error: (e as Error).message, stack: (e as Error).stack });
      throw e;
    }
  }
  async save(path: string) {
    logger.genLog({ event: "video_save", recordId: this.recordId, path });
    await u.oss.writeFile(path, this.result);
    return this;
  }
}
class AiAudio {
  private key: `${string}:${string}`;
  private result: string = "";
  private recordId: string;
  constructor(key: `${string}:${string}`) {
    this.key = key;
    this.recordId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  async run(input: VideoConfig, taskRecord?: TaskRecord) {
    const modelName = await resolveModelName(this.key);
    logger.genLog({ event: "audio_run_start", recordId: this.recordId, key: this.key, modelName, taskClass: taskRecord?.taskClass, projectId: taskRecord?.projectId });
    const exec = async (mn: `${string}:${string}`) => {
      try {
        const fn = await getVendorTemplateFn("ttsRequest", mn);
        await referenceList2imageBase642(mn.split(/:(.+)/)[0], input);
        this.result = await fn(input);

        if (this.result.startsWith("http")) this.result = await urlToBase64(this.result);
        return this;
      } catch (e) {
        logger.genLog({ event: "audio_exec_error", recordId: this.recordId, key: this.key, error: (e as Error).message });
        throw e;
      }
    };
    try {
      if (taskRecord) {
        await withTaskRecord(this.key, taskRecord.taskClass, taskRecord.describe, taskRecord.relatedObjects, taskRecord.projectId, exec);
        logger.genLog({ event: "audio_run_success", recordId: this.recordId, key: this.key });
        return this;
      }
      await exec(modelName);
      logger.genLog({ event: "audio_run_success", recordId: this.recordId, key: this.key });
      return this;
    } catch (e) {
      logger.genLog({ event: "audio_run_error", recordId: this.recordId, key: this.key, error: (e as Error).message, stack: (e as Error).stack });
      throw e;
    }
  }
  async save(path: string) {
    logger.genLog({ event: "audio_save", recordId: this.recordId, path });
    await u.oss.writeFile(path, this.result);
    return this;
  }
}

/**
 * 智能文本模型选择器（带本地→云端兜底）
 *
 * 优先级：
 * 1. 本地 Qwen3 正在运行 → 使用配置的模型（openai:xxx，指向本地 Qwen3）
 * 2. Qwen3 未运行 → 查找可用的云端文本供应商 → 使用云端模型
 * 3. 没有云端供应商 → 抛出错误
 *
 * 返回：模型 key 格式为 "vendorId:modelName"
 */
/**
 * 检查本地 Qwen3 是否在运行，如果不在运行且 ComfyUI 在运行，
 * 则返回云端兜底模型 key，避免启动 Qwen3 杀掉 ComfyUI
 */
/**
 * 智能文本模型选择器（带本地→云端兜底）
 * @param forceCloud true=强制使用云端，false=本地优先（默认）
 */
export async function resolveFallbackTextModel(agentKey: AiType | `${string}:${string}`, forceCloud: boolean = false): Promise<`${string}:${string}`> {
  const configuredModel = await resolveModelName(agentKey);
  const [vendorId] = configuredModel.split(/:(.+)/);
  const diagFile = path.join(process.cwd(), "data", "logs", "agent_diagnostic.log");
  const diag = (msg: string) => { try { fs.appendFileSync(diagFile, `  [resolveFallback] ${msg}\n`); } catch {} };

  diag(`agentKey=${agentKey} configuredModel=${configuredModel} vendorId=${vendorId} forceCloud=${forceCloud}`);

  // 只处理指向本地 Qwen3 的 openai 供应商
  if (vendorId !== "openai") { diag(`vendor不是openai，直接返回`); return configuredModel; }

  // forceCloud=true → 跳过本地检查，直接找云端
  if (forceCloud) {
    diag(`forceCloud=true，跳过本地 Qwen3`);
  } else {
    // 检查本地 Qwen3 是否在运行
    const status = await getServiceStatus();
    diag(`Qwen3运行=${status.qwen3.running} ComfyUI运行=${status.comfyui.running}`);
    if (status.qwen3.running) { diag(`Qwen3在运行，返回原模型`); return configuredModel; }
  }

  // Qwen3 不在运行 → 尝试从已启用的供应商中找云端文本模型
  const cloudVendors = ["deepseek", "openai", "atlascloud"];
  for (const vid of cloudVendors) {
    diag(`检查云端供应商: ${vid}`);
    try {
      const vmod = await import("@/utils/vendor");
      const models = await vmod.getModelList(vid).catch((e: any) => { diag(`  getModelList失败: ${e.message}`); return []; });
      diag(`  模型列表: ${models.length}个`);
      if (models.length === 0) continue;

      // 检查是否是本地供应商
      const vcfg = await import("@/utils/db").then(async m => {
        try {
          const db = (m as any).default || m;
          if (typeof db === "function") {
            const row = await db("o_vendorConfig").where("id", vid).first();
            return row;
          }
        } catch (e: any) { diag(`  DB查询失败: ${e.message}`); }
        return null;
      });
      if (!vcfg) { diag(`  未找到供应商配置`); continue; }
      if (!vcfg.enable) { diag(`  未启用`); continue; }
      const iv = JSON.parse(vcfg.inputValues || "{}");
      if ((iv.baseUrl || "").includes("localhost") || (iv.baseUrl || "").includes("127.0.0.1")) { diag(`  本地供应商，跳过`); continue; }
      diag(`  已启用云端供应商`);

      const code = vmod.getCode(vid);
      if (!code || (!code.includes("textRequest") && !code.includes("exports.textRequest"))) { diag(`  无textRequest`); continue; }
      diag(`  有textRequest`);

      let textModel = models.find((m: any) => m.modelName === "deepseek-v4-flash");
      if (!textModel) textModel = models.find((m: any) => m.type === "text" || !m.type);
      if (!textModel) { diag(`  无文本模型`); continue; }
      diag(`  选用: ${vid}:${textModel.modelName}`);

      return `${vid}:${textModel.modelName}` as `${string}:${string}`;
    } catch (e: any) { diag(`  异常: ${e.message}`); continue; }
  }

  diag(`无云端供应商可用，抛出错误`);
  throw new Error(
    "⚠️ 没有可用的 AI 服务。\n" +
    "请选择以下方式之一：\n" +
    "1. 启动本地 Qwen3 服务（控制台 → 启动 Qwen3）\n" +
    "2. 在「设置 → 模型服务」中配置云端 DeepSeek 模型"
  );
}

export default {
  Text: (AiType: AiType | `${string}:${string}`, think?: boolean, thinkLevel?: 0 | 1 | 2 | 3) => new AiText(AiType, think, thinkLevel),
  Image: (key: `${string}:${string}`) => new AiImage(key),
  Video: (key: `${string}:${string}`) => new AiVideo(key),
  Audio: (key: `${string}:${string}`) => new AiAudio(key),
  resolveFallbackTextModel,
};
