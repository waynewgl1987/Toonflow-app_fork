// Minimal Express server - no DB init
const express = require("express");
const http = require("http");
const app = express();
const server = http.createServer(app);
const start = Date.now();

app.get("/", (req, res) => res.send("ok"));
app.get("/api/services/status", (req, res) => res.json({ status: "running" }));

server.listen(10588, () => {
  console.log("[TEST] Server started in", Date.now() - start, "ms");
  console.log("[TEST] Listening on 10588");
});
