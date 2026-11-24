// Vinç Oyunu sunucusu — hiçbir paket gerektirmez. Çalıştır: node server.js
// LED ekran:  http://<bu-bilgisayar>:PORT/          (tam ekran yap: F tuşu)
// Telefonlar: ekrandaki QR -> http://<bu-bilgisayar>:PORT/play
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = +process.env.PORT || 8080;
const PUBLIC = path.join(__dirname, 'public');
const CONFIG_FILE = path.join(__dirname, 'config.json');

function lanIP() {
  const nets = os.networkInterfaces(); const found = [];
  for (const [name, list] of Object.entries(nets)) for (const n of list || [])
    if (n.family === 'IPv4' && !n.internal) found.push({ name, ip: n.address });
  // Wi-Fi / Ethernet tipik ağlarını öne al
  found.sort((a, b) => score(b.ip) - score(a.ip));
  return found[0]?.ip || 'localhost';
  function score(ip) { return ip.startsWith('192.168.') ? 3 : ip.startsWith('10.') ? 2 : ip.startsWith('172.') ? 1 : 0; }
}
function playURL() {
  const cfg = readConfig();
  const base = process.env.PUBLIC_URL || cfg.publicUrl || `http://${lanIP()}:${PORT}`;
  return base.replace(/\/$/, '') + '/play';
}
function readConfig() { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) { return {}; } }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = url.pathname;
  if (p === '/info') return send(res, 200, JSON.stringify({ playUrl: playURL(), config: readConfig() }), MIME['.json']);
  if (p === '/' || p === '/screen') p = '/screen.html';
  if (p === '/play' || p === '/p') p = '/controller.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'yasak');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'bulunamadı');
    send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream');
  });
});
function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body);
}

// ---------- Minimal WebSocket (RFC 6455) ----------
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
let screens = new Set();
const players = new Map(); // pid -> sock
let nextConn = 1;

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);
  const url = new URL(req.url, 'http://x');
  const conn = { id: nextConn++, socket, role: url.searchParams.get('role'), pid: null, buf: Buffer.alloc(0), frag: [] };
  socket.on('data', d => { conn.buf = Buffer.concat([conn.buf, d]); parseFrames(conn); });
  socket.on('close', () => onClose(conn));
  socket.on('error', () => socket.destroy());
  onOpen(conn, url);
});

function parseFrames(c) {
  while (c.buf.length >= 2) {
    const b0 = c.buf[0], b1 = c.buf[1], op = b0 & 15, fin = b0 & 128, masked = b1 & 128;
    let len = b1 & 127, off = 2;
    if (len === 126) { if (c.buf.length < 4) return; len = c.buf.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (c.buf.length < 10) return; len = Number(c.buf.readBigUInt64BE(2)); off = 10; }
    if (len > 1 << 20) return c.socket.destroy();
    const need = off + (masked ? 4 : 0) + len;
    if (c.buf.length < need) return;
    let payload = c.buf.subarray(off + (masked ? 4 : 0), need);
    if (masked) { const m = c.buf.subarray(off, off + 4); payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3]; }
    c.buf = c.buf.subarray(need);
    if (op === 8) { c.socket.end(Buffer.from([0x88, 0])); return; }
    if (op === 9) { wsSendRaw(c.socket, payload, 10); continue; }
    if (op === 10) continue;
    c.frag.push(payload);
    if (fin) { const msg = Buffer.concat(c.frag).toString('utf8'); c.frag = []; try { onMessage(c, JSON.parse(msg)); } catch (e) { } }
  }
}
function wsSendRaw(socket, data, op = 1) {
  const len = data.length; let head;
  if (len < 126) head = Buffer.from([0x80 | op, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  if (!socket.destroyed) socket.write(Buffer.concat([head, data]));
}
const wsSend = (c, obj) => c && wsSendRaw(c.socket, Buffer.from(JSON.stringify(obj)));
const toScreens = obj => screens.forEach(s => wsSend(s, obj));

// ---------- Oda mantığı: ekran oyunun beynidir, sunucu aktarır ----------
function onOpen(c, url) {
  if (c.role === 'screen') {
    screens.add(c);
    wsSend(c, { t: 'hello', playUrl: playURL(), config: readConfig(), players: [...players.keys()] });
    players.forEach(p => wsSend(p, { t: 'reset' }));
    log('LED ekran bağlandı');
  } else {
    let pid = (url.searchParams.get('pid') || '').replace(/[^a-z0-9]/gi, '').slice(0, 24);
    if (!pid) pid = crypto.randomBytes(6).toString('hex');
    const old = players.get(pid); if (old && old !== c) { old.replaced = true; wsSend(old, { t: 'replaced' }); setTimeout(() => old.socket.destroy(), 50); }
    c.pid = pid; players.set(pid, c);
    wsSend(c, { t: 'welcome', pid, screen: screens.size > 0 });
    toScreens({ t: 'connect', pid });
    log('Oyuncu bağlandı', pid, '— toplam', players.size);
  }
}
function onMessage(c, m) {
  if (c.role === 'screen') {
    if (m.t === 'to' && m.pid) wsSend(players.get(m.pid), m.msg);
    else if (m.t === 'all') players.forEach(p => wsSend(p, m.msg));
    return;
  }
  if (!c.pid) return;
  if (m.t === 'ping') return wsSend(c, { t: 'pong', at: m.at });
  if (!screens.size) return wsSend(c, { t: 'noscreen' });
  // istemciden gelen alanları süz
  const safe = { t: String(m.t || '').slice(0, 12), pid: c.pid };
  if (m.t === 'join') safe.name = String(m.name || '').slice(0, 14);
  if (m.t === 'input') { safe.x = clamp(+m.x || 0); safe.z = clamp(+m.z || 0); }
  toScreens(safe);
}
function onClose(c) {
  if (c.role === 'screen') { screens.delete(c); log('LED ekran ayrıldı'); players.forEach(p => wsSend(p, { t: 'noscreen' })); return; }
  if (c.pid && players.get(c.pid) === c && !c.replaced) { players.delete(c.pid); toScreens({ t: 'leave', pid: c.pid }); }
}
const clamp = v => Math.max(-1, Math.min(1, v));
const log = (...a) => console.log(new Date().toLocaleTimeString('tr-TR'), ...a);

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  ==== VİNÇ OYUNU HAZIR ====');
  console.log('  LED ekran  : http://localhost:' + PORT + '/   (F = tam ekran)');
  console.log('  Telefonlar : ' + playURL() + '   (QR ekranda)');
  console.log('  Telefonlar ile bu bilgisayar aynı Wi-Fi ağında olmalı.\n');
});
