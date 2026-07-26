"use strict";
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Minimal middleware
app.use(require('morgan')('dev'));
app.use(require('cors')({ origin: '*' }));
app.use(express.json({ limit: '100mb' }));

// Static files
const webDir = path.join(process.cwd(), 'data', 'web');
if (fs.existsSync(webDir)) {
  app.use(express.static(webDir, { acceptRanges: false }));
}

// Simple test route
app.get('/api/test', (req, res) => res.json({ ok: true }));

// 404
app.use((req, res) => res.status(404).json({ message: 'Not found' }));
// Error handler
app.use((err, req, res, next) => res.status(500).send('Error'));

server.listen(10588, () => {
  console.log('[SUCCESS] Server listening on 10588');
});

// Module-level check
setTimeout(() => console.log('[TIMER] Module timer fired'), 500);
