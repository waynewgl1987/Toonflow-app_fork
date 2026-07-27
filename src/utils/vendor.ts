import { transform } from "sucrase";
import fs from "fs";
import path from "path";
import u from "@/utils";

export function writeCode(id: string | number, tsCode: string) {
  const rootDir = u.getPath("vendor")
  fs.mkdirSync(rootDir, { recursive: true })
  if (fs.existsSync(path.join(rootDir,  `${id}.ts`))) {
    fs.writeFileSync(path.join(rootDir,  `${id}.ts`), tsCode);
  }
  fs.writeFileSync(path.join(rootDir,  `${id}.ts`), tsCode);
}

export function getCode(id: string): string {
  const rootDir = u.getPath("vendor");
  const targetFile = path.join(rootDir, `${id}.ts`);
  if (!fs.existsSync(targetFile)) return "";
  return fs.readFileSync(targetFile, "utf-8");
}

export async function getModelList(id: string): Promise<Array<any>> {
  const models = await u.db("o_vendorConfig").where("id", id).select("models").first();
  if (!models || !models.models) return [];
  const code = getCode(id);
  const jsCode = transform(code, { transforms: ["typescript"] }).code;
  const vendorData = u.vm(jsCode);
  if(!vendorData || !vendorData.vendor || !vendorData.vendor.models) return [];
  const combined = [...JSON.parse(JSON.stringify(vendorData.vendor.models)), ...JSON.parse(models?.models ?? "[]")];
  const map = new Map<string, any>();
  for (const m of combined) {
    map.set(m.modelName, m);
  }
  return [...map.values()];
}

export function getVendor(id: string) {
  const code = getCode(id);
  const jsCode = transform(code, { transforms: ["typescript"] }).code;
  const vendorData = u.vm(jsCode);
  return vendorData.vendor;
}

/**
 * 查找可用的云端文本供应商（用于本地服务未运行时的兜底）
 * 规则：
 * 1. 已启用 (enable=1)
 * 2. 排除 localhost/127.0.0.1 的供应商（本地服务）
 * 3. 供应商代码中有 textRequest 或 text 函数
 * 4. 按 id 排序返回第一个匹配的
 */
export async function findCloudTextVendor(): Promise<{ id: string; name: string; modelName: string } | null> {
  const vendors = await u.db("o_vendorConfig").where("enable", 1).select("id", "inputValues");
  
  for (const v of vendors) {
    // 排除本地供应商（包含 localhost 或 127.0.0.1）
    const inputValues = JSON.parse(v.inputValues ?? "{}");
    const baseUrl = inputValues.baseUrl ?? "";
    if (baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1")) continue;
    
    // 检查供应商代码是否有 textRequest 能力
    const code = getCode(v.id);
    if (!code) continue;
    try {
      const jsCode = transform(code, { transforms: ["typescript"] }).code;
      const vendorData = u.vm(jsCode);
      if (!vendorData?.vendor) continue;
      const vendorObj = vendorData.vendor;
      // 检查是否有 textRequest 或 text 函数
      const hasTextFn = typeof vendorObj.textRequest === "function" || typeof vendorObj.text === "function";
      if (!hasTextFn) continue;
      
      // 获取模型列表
      const models = await getModelList(v.id);
      if (models.length === 0) continue;
      
      // 优先找 deepseek-v4-flash（用户指定此模型作为兜底）
      let textModel = models.find((m: any) => m.modelName === "deepseek-v4-flash");
      if (!textModel) textModel = models.find((m: any) => m.type === "text" || !m.type);
      if (!textModel) continue;
      
      return { id: v.id, name: v.id, modelName: textModel.modelName };
    } catch {
      continue;
    }
  }
  return null;
}
