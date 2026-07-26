import { readFile, writeFile } from "fs/promises";
import getPath from "@/utils/getPath";
import fs from "fs";
import path from "path";
import knex from "knex";
import initDB from "@/lib/initDB";
// import fixDB from "@/lib/fixDB";
import type { DB } from "@/types/database";
import crypto from "crypto";
import fixDB from "@/lib/fixDB";

type TableName = keyof DB & string;
type RowType<TName extends TableName> = DB[TName];

const dbPath = getPath("db2.sqlite");
console.log("数据库目录:", dbPath);
const dbDir = path.dirname(dbPath);

// 确保数据库目录存在
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// 创建空数据库文件
if (!fs.existsSync(dbPath)) {
  fs.writeFileSync(dbPath, "");
}

const db = knex({
  client: "better-sqlite3",
  connection: {
    filename: dbPath,
  },
  useNullAsDefault: true,
});

// 数据库是否初始化完成（用于路由层判断降级）
export let dbReady = false;

// 延迟初始化数据库：不在模块加载时执行，由 app.ts 在 server.listen 之后调用
export async function initDatabase(): Promise<void> {
  const dbStart = Date.now();
  const dbPhase = (name: string) => console.log(`[数据库] ${name} (${Date.now() - dbStart}ms)`);
  try {
    dbPhase("开始表结构初始化");
    // 改用原始 better-sqlite3 替代 knex.schema.hasTable（避免 esbuild bundle 导致 hasTable 阻塞）
    await initDB(db);
    dbPhase("表结构初始化完成");
    await fixDB(db);
    dbPhase("fixDB 迁移完成");
    if (process.env.NODE_ENV == "dev") initKnexType(db).catch((e: any) => console.warn("[数据库] initKnexType 失败（不影响启动）:", e.message));
    dbReady = true;
    console.log(`[数据库] 初始化完成（总耗时 ${Date.now() - dbStart}ms）`);
  } catch (err) {
    console.error("[数据库] 初始化失败:", err instanceof Error ? err.message : err);
    // 不阻塞启动，允许降级运行（部分功能可能不可用）
  }
}

// 兼容旧版：仅在非 Electron 且非 prod 环境下自动初始化（开发模式）
if (process.env.NODE_ENV !== "prod" && typeof process.versions?.electron === "undefined") {
  setImmediate(() => { initDatabase().catch(() => {}); });
  console.log("[数据库] 开发模式：延迟初始化已通过 setImmediate 调度");
}

const dbClient = Object.assign(<TName extends TableName>(table: TName) => db<RowType<TName>, RowType<TName>[]>(table), db);
dbClient.schema = db.schema;
export default dbClient;

export { db };

async function initKnexType(knexDb: any) {
  const { Client } = await import("@rmp135/sql-ts");
  const outFile = "src/types/database.d.ts";
  const dbClient = Client.fromConfig({
    interfaceNameFormat: "${table}",
    typeMap: {
      number: ["bigint"],
      string: ["text", "varchar", "char"],
    },
  }).fetchDatabase(knexDb);
  const declarations = await dbClient.toTypescript();
  const dbObject = await dbClient.toObject();
  const customHeader = `//该文件由脚本自动生成，请勿手动修改`;
  // 清除上次的注释头
  let declBody = declarations.replace(/^\/\*[\s\S]*?\*\/\s*/, "");
  declBody = declBody.replace(/(\n\s*)\/\*([^*][\s\S]*?)\*\//g, "$1/**$2*/");
  const tableInterfaces = dbObject.schemas.flatMap((schema) => schema.tables.map((table) => table.interfaceName));
  const aggregateTypes = `
export interface DB {
${tableInterfaces.map((name) => `  ${JSON.stringify(name)}: ${name};`).join("\n")}
}
`;
  // 哈希仅基于结构化信息，header和空格不算
  const hashSource = JSON.stringify({
    tableInterfaces,
    declBody,
  });
  const hash = crypto.createHash("md5").update(hashSource).digest("hex");
  // 文件内容
  const content = `// @db-hash ${hash}\n${customHeader}\n\n` + declBody + aggregateTypes;
  let needWrite = true;
  try {
    const current = await readFile(outFile, "utf8");
    // 文件头已存在相同 hash，不需要写
    const match = current.match(/^\/\/\s*@db-hash\s*([a-zA-Z0-9]+)\n/);
    const currentHash = match ? match[1] : null;
    if (currentHash === hash) {
      needWrite = false;
    }
  } catch (err) {
    needWrite = true;
  }
  if (needWrite) await writeFile(outFile, content, "utf8");
}
