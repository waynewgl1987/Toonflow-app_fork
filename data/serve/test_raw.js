// Test: raw better-sqlite3 hasTable vs knex hasTable inside the app context
const start = Date.now();
const path = require("path");
process.chdir("E:\\AI\\Toonflow-app");

function log(m) { console.log("[" + (Date.now()-start) + "ms]", m); }

// Test 1: raw better-sqlite3
const Database = require("better-sqlite3");
log("loaded better-sqlite3");

const db = new Database("data/db2.sqlite");
log("opened database");

const tables = ["o_user","o_project","o_artStyle","o_agentDeploy","o_setting","o_tasks","o_prompt","o_modelPrompt","o_novel","o_event","o_eventChapter","o_script","o_assets","o_image","o_storyboard","o_agentWorkData","o_video","o_videoTrack","o_vendorConfig","o_imageFlow","o_assets2Storyboard","o_scriptAssets","o_skillList","o_skillAttribution","memories","o_assetsRole2Audio"];

log("testing " + tables.length + " tables with raw better-sqlite3...");
for (let i = 0; i < tables.length; i++) {
  const ts = Date.now();
  const row = db.prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name=?").get(tables[i]);
  const elapsed = Date.now() - ts;
  if (elapsed > 100) log("SLOW: " + tables[i] + " took " + elapsed + "ms");
}
log("raw better-sqlite3 done: " + (Date.now()-start) + "ms");
db.close();

// Test 2: knex hasTable
log("now testing knex...");
const knex = require("knex");
const kdb = knex({
  client: "better-sqlite3",
  connection: { filename: "data/db2.sqlite" },
  useNullAsDefault: true,
});

async function testKnex() {
  for (let i = 0; i < tables.length; i++) {
    const ts = Date.now();
    const exists = await kdb.schema.hasTable(tables[i]);
    const elapsed = Date.now() - ts;
    if (elapsed > 100) log("SLOW knex: " + tables[i] + " took " + elapsed + "ms");
  }
  log("knex hasTable done: " + (Date.now()-start) + "ms");
  await kdb.destroy();
}
testKnex().catch(e => log("Error: " + e.message));
