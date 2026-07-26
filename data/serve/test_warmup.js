// Test: warm up better-sqlite3 before loading the full app
const start = Date.now();
function log(m) { console.log(`[${Date.now()-start}ms] ${m}`); }

// Step 1: Warm up better-sqlite3
log("Warming up better-sqlite3...");
const Database = require("better-sqlite3");
const warmup = new Database("data/db2.sqlite");
warmup.prepare("SELECT 1").get();
warmup.close();
log("Warmup done");

// Step 2: Load knex and do a fast hasTable
log("Loading knex...");
const knex = require("knex");
log("knex loaded");

const db = knex({
  client: "better-sqlite3",
  connection: { filename: "data/db2.sqlite" },
  useNullAsDefault: true,
});

async function main() {
  log("Doing hasTable...");
  await db.schema.hasTable("o_user");
  log("First hasTable done");
  await db.schema.hasTable("o_project"); 
  log("Second hasTable done");
  await db.destroy();
  log("All done, now loading full app.js...");
  
  // Step 3: Load the full app
  require("./app.js");
}
main().catch(e => log("Error: " + e.message));
