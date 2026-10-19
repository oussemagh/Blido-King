// Blido King: static file server + WebSocket room relay (no game logic here).
// Every player runs the same game; this server only forwards messages and keeps presence.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const INDEX = process.env.INDEX_FILE || path.join(__dirname, 'index.html');
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

const MAX_ROOMS = 2000, MAX_PEERS = 8, MAX_ROOMS_PER_SOCKET = 4;
const ROOM_RE = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
const TOPIC_RE = /^[a-z][a-z0-9_.-]{0,47}$/;

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  if (url === '/' || url === '/index.html') {
    fs.readFile(INDEX, (err, data) => {
      if (err) { res.writeHead(500); return res.end('index.html missing'); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      res.end(data);
    });
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found');
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 8192 });
server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin;
  if (req.url.split('?')[0] !== '/ws' || (ORIGINS.length && !ORIGINS.includes(origin))) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

const rooms = new Map(); // name -> Map(peerId -> { ws, presence, updatedAt })
let counter = 0;
const newId = () => 'p' + (++counter).toString(36) + Math.random().toString(36).slice(2, 6);
const json = o => JSON.stringify(o);
const sizeOf = v => Buffer.byteLength(JSON.stringify(v === undefined ? null : v));

function snapshot(name) {
  const r = rooms.get(name); if (!r) return;
  const peers = [...r.entries()].map(([peer, p]) => ({ peer, presence: p.presence, updatedAt: p.updatedAt }));
  const msg = json({ op: 'peers', room: name, peers });
  for (const p of r.values()) if (p.ws.readyState === 1) p.ws.send(msg);
}
function mergePresence(cur, patch) {
  const next = { ...cur };
  for (const k of Object.keys(patch)) {
    if (!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(k) || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (patch[k] === null) delete next[k]; else next[k] = patch[k];
  }
  return next;
}
function leave(ws, name) {
  const r = rooms.get(name); if (!r) return;
  const id = ws.rooms.get(name);
  if (id) { r.delete(id); ws.rooms.delete(name); }
  if (r.size === 0) rooms.delete(name); else snapshot(name);
}

wss.on('connection', ws => {
  ws.rooms = new Map(); // room name -> peer id
  ws.isAlive = true;
  ws.bucket = 80; ws.last = Date.now();
  ws.on('pong', () => { ws.isAlive = true; });
  const err = (code, room) => ws.readyState === 1 && ws.send(json({ op: 'err', code, room }));

  ws.on('message', raw => {
    // rate limit: burst 80, refill 40 per second
    const now = Date.now();
    ws.bucket = Math.min(80, ws.bucket + (now - ws.last) / 25); ws.last = now;
    if (ws.bucket < 1) return; ws.bucket -= 1;

    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object' || typeof m.room !== 'string' || !ROOM_RE.test(m.room)) return;
    const name = m.room;

    if (m.op === 'join') {
      if (ws.rooms.has(name)) return;
      if (ws.rooms.size >= MAX_ROOMS_PER_SOCKET) return err('limit_reached', name);
      let r = rooms.get(name);
      if (!r) { if (rooms.size >= MAX_ROOMS) return err('limit_reached', name); r = new Map(); rooms.set(name, r); }
      if (r.size >= MAX_PEERS) return err('limit_reached', name);
      const id = newId();
      let presence = {};
      if (m.presence && typeof m.presence === 'object' && sizeOf(m.presence) <= 4096) presence = mergePresence({}, m.presence);
      r.set(id, { ws, presence, updatedAt: now });
      ws.rooms.set(name, id);
      ws.send(json({ op: 'joined', room: name, peer: id }));
      snapshot(name);
      return;
    }

    const id = ws.rooms.get(name);
    const r = rooms.get(name);
    if (!id || !r) return;

    if (m.op === 'emit') {
      if (typeof m.topic !== 'string' || !TOPIC_RE.test(m.topic) || sizeOf(m.data) > 4096) return;
      const out = json({ op: 'msg', room: name, topic: m.topic, data: m.data === undefined ? null : m.data, peer: id });
      for (const p of r.values()) if (p.ws.readyState === 1) p.ws.send(out); // same order for everyone, sender included
    } else if (m.op === 'presence') {
      if (!m.patch || typeof m.patch !== 'object') return;
      const p = r.get(id);
      const next = mergePresence(p.presence, m.patch);
      if (sizeOf(next) > 4096) return;
      p.presence = next; p.updatedAt = now;
      snapshot(name);
    } else if (m.op === 'leave') {
      leave(ws, name);
    }
  });

  ws.on('close', () => { for (const name of [...ws.rooms.keys()]) leave(ws, name); });
  ws.on('error', () => {});
});

// drop dead connections
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 25000);

server.listen(PORT, () => console.log('Blido King server on port ' + PORT));
