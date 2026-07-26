const Database = require('better-sqlite3');
const db = new Database('E:/AI/Toonflow-app/data/db2.sqlite');
const rows = db.prepare("SELECT id, state, filePath, errorReason, assetsId FROM o_image ORDER BY id DESC LIMIT 10").all();
console.log(JSON.stringify(rows, null, 2));
