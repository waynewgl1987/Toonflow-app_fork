import Database from 'better-sqlite3';
const db = new Database('data/db2.sqlite');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables (' + tables.length + '):', tables.map(t => t.name).join(', '));
const count = db.prepare('SELECT COUNT(*) as c FROM o_setting').get();
console.log('o_setting rows:', count.c);
db.close();
