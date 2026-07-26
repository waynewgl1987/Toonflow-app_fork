var diagTrace = function(msg) { try { require("fs").appendFileSync("data/logs/final_trace5.log", Date.now() + " " + msg + "\n"); } catch(e) {} };
diagTrace("MODULE_START");
