#!/usr/bin/env node

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const HISTORY_DIR = path.join(os.homedir(), '.llm-chat');
const HISTORY_FILE = path.join(HISTORY_DIR, 'conversations.json');
const INDEX_HTML = path.join(__dirname, 'public', 'index.html');

// ---------- conversation history (JSON file on disk) ----------

async function loadConversations() {
  try {
    const raw = await fsp.readFile(HISTORY_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function saveConversations(list) {
  await fsp.mkdir(HISTORY_DIR, { recursive: true });
  await fsp.writeFile(HISTORY_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function deriveTitle(messages) {
  const firstUser = messages.find((m) => m.role === 'user');
  if (!firstUser) return 'New chat';
  const text = (firstUser.content || '').trim().replace(/\s+/g, ' ');
  return text.length > 60 ? text.slice(0, 57) + '...' : text || 'New chat';
}

// ---------- tiny request helpers ----------

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// ---------- route handlers ----------

async function handleModels(req, res) {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!r.ok) throw new Error(`Ollama responded with ${r.status}`);
    const data = await r.json();
    sendJson(res, 200, { models: data.models || [] });
  } catch (err) {
    sendJson(res, 502, {
      error: 'Could not reach Ollama. Make sure it is running (try `ollama serve`) and that you have pulled at least one model (e.g. `ollama pull llama3.2`).',
      detail: err.message,
    });
  }
}

async function handleChat(req, res) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const { model, messages } = payload;
  if (!model || !Array.isArray(messages)) {
    sendJson(res, 400, { error: 'Request must include "model" and "messages"' });
    return;
  }

  let ollamaRes;
  try {
    ollamaRes = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true }),
    });
  } catch (err) {
    sendJson(res, 502, {
      error: 'Could not reach Ollama. Is it running?',
      detail: err.message,
    });
    return;
  }

  if (!ollamaRes.ok || !ollamaRes.body) {
    const text = await ollamaRes.text().catch(() => '');
    sendJson(res, ollamaRes.status || 502, {
      error: 'Ollama returned an error',
      detail: text || `HTTP ${ollamaRes.status}`,
    });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
  });

  const nodeStream = Readable.fromWeb(ollamaRes.body);
  await new Promise((resolve) => {
    nodeStream.on('data', (chunk) => res.write(chunk));
    nodeStream.on('end', () => { res.end(); resolve(); });
    nodeStream.on('error', () => { res.end(); resolve(); });
    req.on('close', () => { nodeStream.destroy(); resolve(); });
  });
}

async function handleListConversations(req, res) {
  const list = await loadConversations();
  const summaries = list
    .map(({ id, title, model, updatedAt }) => ({ id, title, model, updatedAt }))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  sendJson(res, 200, { conversations: summaries });
}

async function handleGetConversation(req, res, id) {
  const list = await loadConversations();
  const conversation = list.find((c) => c.id === id);
  if (!conversation) {
    sendJson(res, 404, { error: 'Conversation not found' });
    return;
  }
  sendJson(res, 200, { conversation });
}

async function handleUpsertConversation(req, res) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const { id, model, messages } = payload;
  if (!Array.isArray(messages)) {
    sendJson(res, 400, { error: 'Request must include "messages"' });
    return;
  }

  const list = await loadConversations();
  const now = new Date().toISOString();
  let conversation = id ? list.find((c) => c.id === id) : null;

  if (conversation) {
    conversation.model = model || conversation.model;
    conversation.messages = messages;
    conversation.title = conversation.title || deriveTitle(messages);
    conversation.updatedAt = now;
  } else {
    conversation = {
      id: crypto.randomUUID(),
      title: deriveTitle(messages),
      model: model || null,
      messages,
      createdAt: now,
      updatedAt: now,
    };
    list.push(conversation);
  }

  await saveConversations(list);
  sendJson(res, 200, { conversation });
}

async function handleDeleteConversation(req, res, id) {
  const list = await loadConversations();
  const next = list.filter((c) => c.id !== id);
  if (next.length === list.length) {
    sendJson(res, 404, { error: 'Conversation not found' });
    return;
  }
  await saveConversations(next);
  sendJson(res, 200, { ok: true });
}

async function handleIndex(req, res) {
  try {
    const html = await fsp.readFile(INDEX_HTML, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Could not load UI: ' + err.message);
  }
}

// ---------- router ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;
  console.log(`REQ ${req.method} ${pathname}`);

  try {
    if (req.method === 'GET' && pathname === '/') return await handleIndex(req, res);
    if (req.method === 'GET' && pathname === '/api/models') return await handleModels(req, res);
    if (req.method === 'POST' && pathname === '/api/chat') return await handleChat(req, res);
    if (req.method === 'GET' && pathname === '/api/conversations') return await handleListConversations(req, res);
    if (req.method === 'POST' && pathname === '/api/conversations') return await handleUpsertConversation(req, res);

    const convMatch = pathname.match(/^\/api\/conversations\/([^/]+)$/);
    if (convMatch) {
      const id = decodeURIComponent(convMatch[1]);
      if (req.method === 'GET') return await handleGetConversation(req, res, id);
      if (req.method === 'DELETE') return await handleDeleteConversation(req, res, id);
    }

    // Serve static files from the public directory (css, jsx, images, etc.)
    if (req.method === 'GET') {
      try {
        // sanitize path
        const rel = pathname.replace(/^\//, '');
        const fp = path.join(__dirname, 'public', rel);
        console.log(`Static request: ${req.method} ${pathname} -> ${fp}`);
        if (!fp.startsWith(path.join(__dirname, 'public'))) {
          sendJson(res, 403, { error: 'Forbidden' });
          return;
        }
        if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
          const ext = path.extname(fp).toLowerCase();
          const mime = {
            '.js': 'application/javascript; charset=utf-8',
            '.mjs': 'application/javascript; charset=utf-8',
            '.jsx': 'text/javascript; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.html': 'text/html; charset=utf-8',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.svg': 'image/svg+xml',
            '.json': 'application/json; charset=utf-8',
            '.map': 'application/octet-stream',
            '.wasm': 'application/wasm',
            '.ico': 'image/x-icon',
            '.txt': 'text/plain; charset=utf-8',
          }[ext] || 'application/octet-stream';
          const stream = fs.createReadStream(fp);
          res.writeHead(200, { 'Content-Type': mime });
          stream.pipe(res);
          return;
        }
      } catch (e) {
        // fall through to 404
      }
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: 'Internal error', detail: err.message });
    else res.end();
  }
});

// ---------- boot: find a free port, listen, open browser ----------

function listenOnFreePort(startPort) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const onError = (err) => {
        if (err.code === 'EADDRINUSE' && port < startPort + 20) {
          server.removeListener('error', onError);
          tryPort(port + 1);
        } else {
          reject(err);
        }
      };
      server.once('error', onError);
      server.listen(port, () => {
        server.removeListener('error', onError);
        resolve(port);
      });
    };
    tryPort(startPort);
  });
}

function openBrowser(url) {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  const args = platform === 'win32' ? ['', url] : [url];
  try {
    spawn(cmd, args, { shell: platform === 'win32', stdio: 'ignore', detached: true }).unref();
  } catch {
    // ignore — user can open the URL manually
  }
}

const startPort = Number(process.env.PORT) || 3000;
const port = await listenOnFreePort(startPort);
const url = `http://localhost:${port}`;
console.log(`\n  llm-chat running at ${url}`);
console.log(`  History stored at ${HISTORY_FILE}`);
console.log(`  Talking to Ollama at ${OLLAMA_URL}\n`);
openBrowser(url);
