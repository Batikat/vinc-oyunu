// Vinç oyunu: sahne, fizik, pençeler, oyun akışı, ağ
(function () {
  const G = window.GLR, M = G.M;
  const lin = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => Math.pow(c / 255, 2.2)); };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

  const DEFAULTS = { title: 'LUCKY CLAW', joinText: "QR'ı okut, 15 saniyede ödülünü kap!", playSeconds: 15, maxPlayers: 4, winRate: .35, playsPerPhone: 0, attractMode: true, qrSize: .15, prizes: [{ name: 'Sürpriz Hediye', weight: 1 }], grandPrize: 'BÜYÜK ÖDÜL' };
  const S = { cfg: { ...DEFAULTS }, W: 5.4, H: 3, D: 1.35, balls: [], claws: [], queue: [], players: new Map(), parts: [], bursts: [], time: 0, ws: null, online: false, lastHuman: 0, debug: false, colorIdx: 0 };
  window.CLAW = S;

  // videodaki palet: neon lime, neon pembe, elektrik mavi, camgöbeği, sarı, şeftali, krem, beyaz
  const BALL_PAL = [['#86ff2e', .9, .2, 3], ['#ff26cf', .7, .2, 3], ['#1d5cff', .18, .18, 2], ['#1fb6ff', .2, .18, 2], ['#ffe02e', .14, .2, 2],
    ['#ffbc9c', .08, .26, 2], ['#f6efdc', .03, .3, 2], ['#ffffff', 0, .24, 1], ['#ff78d6', .25, .22, 1]];
  const PAL_W = BALL_PAL.reduce((s, p) => s + p[3], 0);
  const PLAYER_COLORS = ['#74ff1f', '#ff2fc4', '#2bc6ff', '#ffb01f', '#a070ff', '#ff5d4d'];
  const C_WALL = lin('#8d92b0'), C_FLOOR = lin('#7a7f9c'), C_SILL = lin('#cdd1ee'), C_METAL = lin('#eceef6'), C_STRIPE = lin('#f3f5ff'), C_CLOUD = lin('#eef0ff'), C_STAR = lin('#f4f2ff'), C_LED = lin('#e8e6ff'), C_CABLE = lin('#c9ccd8');

  // ---------- yerleşim ----------
  const FOV = 32 * Math.PI / 180;
  function layout() {
    const aspect = innerWidth / innerHeight, t = Math.tan(FOV / 2);
    S.H = aspect < 1.15 ? clamp(2.7 / aspect, 3, 5.6) : 3; // dikey ekranda dolap uzar
    const d = S.H * .535 / t;
    S.W = 2 * t * d * aspect * .985;
    S.D = clamp(1.15 + S.W * .03, 1.2, 1.6);
    S.cam = { eye: [0, S.H * .5, S.D / 2 + d], target: [0, S.H * .5, 0], fov: FOV };
    const tw = clamp(S.W * .3, 1.3, 2.6);
    S.titleRect = [-tw / 2, S.H - .58, tw, tw * .19];
    S.hoverY = S.H - .98;
  }

  // ---------- toplar ----------
  function pickPal() { let r = Math.random() * PAL_W; for (const p of BALL_PAL) { r -= p[3]; if (r <= 0) return p; } return BALL_PAL[0]; }
  function makeBall(type, x, y, z) {
    const b = { x, y, z, px: x, py: y, pz: z, vx: 0, vy: 0, vz: 0, q: M.qAxis(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1), rnd(0, 6.28)), type, held: null, scale: 1, id: Math.random() };
    if (type === 'solid') { const p = pickPal(); b.r = rnd(.135, .178); b.col = lin(p[0]); b.emis = p[1]; b.rough = p[2]; }
    else if (type === 'stripe') { b.r = rnd(.15, .18); b.col = C_STRIPE; }
    else if (type === 'cloud') { b.r = rnd(.16, .19); b.col = C_CLOUD; }
    else { b.r = .17; b.col = C_STAR; }
    return b;
  }
  function randomType(allowStar) { const r = Math.random(); return r < .72 ? 'solid' : r < .87 ? 'stripe' : r < .985 || !allowStar ? 'cloud' : 'star'; }
  function fillBalls() {
    S.balls = [];
    const vol = S.W * S.D * S.H * .34 * .6, n = clamp(Math.round(vol / (4 / 3 * Math.PI * .155 ** 3)), 120, 520);
    for (let i = 0; i < n; i++) {
      const type = i < 3 ? 'star' : randomType(false);
      S.balls.push(makeBall(type, rnd(-S.W / 2 + .2, S.W / 2 - .2), .2 + (i / n) * S.H * 1.1 + rnd(0, .2), rnd(-S.D / 2 + .2, S.D / 2 - .2)));
    }
    for (let i = 0; i < 300; i++) physics(1 / 60);
  }

  // ---------- fizik (konum tabanlı, uzamsal ızgara) ----------
  const CELL = .42, grid = new Map();
  const key = (i, j, k) => (i + 512) * 1048576 + (j + 512) * 1024 + (k + 512);
  function buildGrid() {
    grid.clear();
    for (const b of S.balls) { const k = key(Math.floor(b.x / CELL), Math.floor(b.y / CELL), Math.floor(b.z / CELL)); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(b); }
  }
  function near(x, y, z, fn) {
    const i0 = Math.floor(x / CELL), j0 = Math.floor(y / CELL), k0 = Math.floor(z / CELL);
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) for (let k = k0 - 1; k <= k0 + 1; k++) { const a = grid.get(key(i, j, k)); if (a) for (const b of a) fn(b); }
  }
  function physics(dt) {
    const sub = 3, h = dt / sub, hw = S.W / 2, hd = S.D / 2;
    for (let s = 0; s < sub; s++) {
      for (const b of S.balls) {
        b.px = b.x; b.py = b.y; b.pz = b.z;
        if (b.held) { const g = b.held.grip; b.x += (g[0] - b.x) * b.held.gripLerp; b.y += (g[1] - b.y) * b.held.gripLerp; b.z += (g[2] - b.z) * b.held.gripLerp; continue; }
        b.vy -= 9.8 * h; b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;
      }
      for (let it = 0; it < 2; it++) {
        buildGrid();
        for (const a of S.balls) {
          near(a.x, a.y, a.z, b => {
            if (b.id <= a.id) return;
            const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, md = a.r + b.r, d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= md * md || d2 < 1e-9) return;
            const d = Math.sqrt(d2), pen = md - d, ia = a.held ? 0 : 1, ib = b.held ? 0 : 1, w = ia + ib; if (!w) return;
            let nx = dx / d, ny = dy / d, nz = dz / d; const ca = pen * ia / w, cb = pen * ib / w;
            if (w === 1) { // biri pençede: diğer top üstünde taşınmasın, yana ve aşağı kaysın
              const free = a.held ? 1 : -1, h = Math.hypot(nx, nz) || 1;
              if (ny * free > -.2) { nx = nx / h * .9; nz = nz / h * .9; ny = -.44 * free; if (Math.hypot(dx, dz) < .01) { nx = .9 * free; } }
            }
            a.x -= nx * ca; a.y -= ny * ca; a.z -= nz * ca; b.x += nx * cb; b.y += ny * cb; b.z += nz * cb;
          });
        }
        for (const c of S.claws) if (c.state !== 'lift' && c.state !== 'result') for (const k of c.coll) near(k[0], k[1], k[2], b => {
          if (b.held) return;
          const dx = b.x - k[0], dy = b.y - k[1], dz = b.z - k[2], md = b.r + k[3], d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= md * md || d2 < 1e-9) return;
          const d = Math.sqrt(d2), p = (md - d) * .6; b.x += dx / d * p; b.y += dy / d * p; b.z += dz / d * p;
        });
        for (const b of S.balls) {
          if (b.held) continue;
          if (b.y < b.r) b.y = b.r;
          if (b.x < -hw + b.r) b.x = -hw + b.r; else if (b.x > hw - b.r) b.x = hw - b.r;
          if (b.z < -hd + b.r) b.z = -hd + b.r; else if (b.z > hd - b.r) b.z = hd - b.r;
        }
      }
      for (const b of S.balls) {
        let vx = (b.x - b.px) / h, vy = (b.y - b.py) / h, vz = (b.z - b.pz) / h;
        const sp = Math.hypot(vx, vy, vz); if (sp > 7) { vx *= 7 / sp; vy *= 7 / sp; vz *= 7 / sp; }
        const fr = b.y <= b.r + .003 ? .9 : .995;
        b.vx = vx * fr; b.vy = vy * .995; b.vz = vz * fr;
        if (sp < .05) { b.vx *= .6; b.vz *= .6; }
      }
    }
    for (const b of S.balls) { // yuvarlanma
      const wx = b.vz / b.r, wz = -b.vx / b.r, w = Math.hypot(wx, wz);
      if (w > .05) { b.q = M.qMul(M.qAxis(wx, 0, wz, w * dt), b.q); const l = Math.hypot(...b.q); b.q = b.q.map(v => v / l); }
    }
  }

  // ---------- pençe ----------
  function newClaw(player, bot) {
    const others = S.claws.map(c => c.x);
    let best = 0, bd = -1;
    for (let i = 0; i < 12; i++) { const x = rnd(-S.W / 2 + .5, S.W / 2 - .5), d = others.length ? Math.min(...others.map(o => Math.abs(o - x))) : 9; if (d > bd) { bd = d; best = x; } }
    const hex = bot ? '#e9ecff' : PLAYER_COLORS[S.colorIdx++ % PLAYER_COLORS.length];
    const used = S.claws.map(c => c.lane); let lane = 0; while (used.includes(lane)) lane++;
    const c = { player, bot, hex, col: lin(hex), lane, hy: S.hoverY - [0, .16, .32, .08, .24, .4][lane % 6], dodge: 0, x: best, z: rnd(-.2, .2), y: S.H + 1.3, vx: 0, vz: 0, ix: 0, iz: 0, open: .5, state: 'enter', t: 0, left: S.cfg.playSeconds,
      swx: 0, swz: 0, swvx: 0, swvz: 0, coll: [], grip: [0, 0, 0], gripLerp: 0, ball: null, outcome: null, tick: -1, hud: null };
    S.claws.push(c); makeHud(c);
    if (player) { player.claw = c; player.plays++; send(player.pid, { t: 'ready', color: hex }); }
    return c;
  }
  const K = 1.5; // pençe ölçeği
  function clawParts(c, draw) {
    const q = M.qMul(M.qAxis(1, 0, 0, c.swz), M.qAxis(0, 0, 1, -c.swx)), top = .66 * K;
    const P = (ox, oy, oz) => { const r = M.qRot(q, ox * K, oy * K - top, oz * K); return [c.x + r[0], c.y + top + r[1], c.zr + r[2]]; };
    const coll = [];
    const col = c.col, metal = C_METAL, glow = c.bot ? .12 : .8;
    if (draw) {
      const tp = P(0, .67, 0);
      G.seg(tp[0], tp[1], tp[2], tp[0], S.H + 3, tp[2], .012, C_CABLE, 5, .35, .6, 0, 1);
      let p = P(0, .645, 0); G.add('cyl', p[0], p[1], p[2], q, .055 * K, .05 * K, .055 * K, metal, 5, .2, .8, 0, 1);
      p = P(0, .36, 0); G.add('cyl', p[0], p[1], p[2], q, .045 * K, .56 * K, .045 * K, lin('#2c2f3a'), 5, .4, .3, 0, 1);
      for (let i = 0; i < 7; i++) { p = P(0, .14 + i * .07, 0); G.add('torus', p[0], p[1], p[2], q, .066 * K, .07 * K, .066 * K, col, 0, .3, 0, glow, 1); }
      p = P(0, .085, 0); G.add('cyl', p[0], p[1], p[2], q, .11 * K, .035 * K, .11 * K, col, 0, .3, 0, glow * .7, 1);
      p = P(0, .04, 0); G.add('sphere', p[0], p[1], p[2], q, .078 * K, .07 * K, .078 * K, metal, 5, .18, .85, 0, 1);
    }
    coll.push([...P(0, .02, 0), .085 * K]);
    const o = c.open, t1 = .18 + .85 * o, t2 = t1 - (1.15 - .6 * o);
    for (let k = 0; k < 3; k++) {
      const a = -Math.PI / 2 + k * Math.PI * 2 / 3, dx = Math.cos(a), dz = Math.sin(a);
      const r0 = .085, y0 = .02, r1 = r0 + .2 * Math.sin(t1), y1 = y0 - .2 * Math.cos(t1), r2 = r1 + .2 * Math.sin(t2), y2 = y1 - .2 * Math.cos(t2);
      const r3 = r2 + .065 * Math.sin(t2 - .9), y3 = y2 - .065 * Math.cos(t2 - .9);
      const A = P(dx * r0, y0, dz * r0), B = P(dx * r1, y1, dz * r1), C = P(dx * r2, y2, dz * r2), D = P(dx * r3, y3, dz * r3);
      if (draw) {
        G.seg(...A, ...B, .022 * K, metal, 5, .22, .85, 0, 1);
        G.add('sphere', ...B, null, .036 * K, .036 * K, .036 * K, col, 0, .25, 0, glow * .8, 1);
        G.seg(...B, ...C, .019 * K, metal, 5, .22, .85, 0, 1);
        G.add('sphere', ...C, null, .028 * K, .028 * K, .028 * K, col, 0, .25, 0, glow * .8, 1);
        G.seg(...C, ...D, .016 * K, metal, 5, .22, .85, 0, 1);
        G.add('sphere', ...D, null, .019 * K, .019 * K, .019 * K, metal, 5, .2, .85, 0, 1);
      }
      for (const f of [.5, 1]) coll.push([A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f, .045 * K]);
      for (const f of [.5, 1]) coll.push([B[0] + (C[0] - B[0]) * f, B[1] + (C[1] - B[1]) * f, B[2] + (C[2] - B[2]) * f, .04 * K]);
    }
    c.coll = coll;
  }
  function surfaceUnder(c) {
    let top = 0; for (const b of S.balls) { if (b.held) continue; const d = Math.hypot(b.x - c.x, b.z - c.zr), R = b.r + .1; if (d < R) top = Math.max(top, b.y + Math.sqrt(R * R - d * d) - .1); }
    return top;
  }
  function decide(c) {
    let best = null, bd = 1e9;
    for (const b of S.balls) { if (b.held) continue; const d = Math.hypot(b.x - c.x, b.z - c.zr); if (d < .34 && b.y + b.r > c.y - .65 && d < bd) { bd = d; best = b; } }
    // kazanma kararı panelde girilen yüzdelere göre (pençe topa yetişebiliyorsa)
    if (!best) for (const b of S.balls) { if (b.held) continue; const d = Math.hypot(b.x - c.x, b.z - c.zr); if (d < .5 && b.y + b.r > c.y - .8 && d < bd) { bd = d; best = b; } }
    if (!best) return { outcome: 'miss' };
    const prize = c.bot ? (Math.random() < .3 ? '-' : null) : rollPrize();
    if (prize) return { ball: best, outcome: 'win', prize };
    return { ball: best, outcome: Math.random() < .45 ? 'slip' : 'miss' };
  }
  function updateClaw(c, dt) {
    c.t += dt;
    const hw = S.W / 2 - .45, hd = S.D / 2 - .32;
    let tvx = 0, tvz = 0;
    if (c.state === 'enter') {
      const k = clamp(c.t / 1.1, 0, 1); c.y = S.H + 1.3 + (c.hy - S.H - 1.3) * ease(k); c.open += (.5 - c.open) * dt * 4;
      if (k >= 1) { c.state = 'play'; c.t = 0; c.left = S.cfg.playSeconds; if (c.player) send(c.player.pid, { t: 'play', seconds: S.cfg.playSeconds, color: c.hex }); }
    } else if (c.state === 'play') {
      if (c.bot) botThink(c, dt);
      tvx = c.ix * 1.5; tvz = c.iz * 1.0;
      c.left = Math.max(0, S.cfg.playSeconds - c.t);
      const s = Math.ceil(c.left); if (s !== c.tick) { c.tick = s; if (c.player) send(c.player.pid, { t: 'tick', left: s }); }
      if (c.left <= 0) drop(c);
    } else if (c.state === 'drop') {
      c.open += (1 - c.open) * dt * 5;
      const stop = Math.max(surfaceUnder(c) + .14, .6);
      c.y -= dt * (c.y - stop > .4 ? 1.5 : .7);
      if (c.y <= stop) { c.y = stop; c.state = 'close'; c.t = 0; const d = decide(c); c.outcome = d.outcome; c.prize = d.prize || ''; if (d.ball && d.outcome !== 'miss') { c.ball = d.ball; d.ball.held = c; c.gripLerp = 0; } }
    } else if (c.state === 'close') {
      const target = c.ball ? .36 : .06; c.open += (target - c.open) * dt * 6; c.gripLerp = clamp(c.t / .55, 0, 1) * .35;
      if (c.t > .7) { c.state = 'lift'; c.t = 0; c.liftFrom = c.y; }
    } else if (c.state === 'lift') {
      c.gripLerp = .6; c.y += dt * (c.ball ? .85 : 1.1);
      const k = (c.y - c.liftFrom) / (c.hy - c.liftFrom);
      if (c.ball && c.outcome === 'slip' && k > .42) { release(c, true); }
      if (c.y >= c.hy) { c.y = c.hy; c.state = 'result'; c.t = 0; finish(c); }
    } else if (c.state === 'result') {
      if (c.outcome === 'win' && c.ball && c.t > .45) { pop(c.ball, c.col); S.balls.splice(S.balls.indexOf(c.ball), 1); c.ball = null; setTimeout(() => S.balls.push(makeBall(randomType(true), rnd(-S.W / 2 + .3, S.W / 2 - .3), S.H + .3, rnd(-.3, .3))), 1600); }
      if (c.t > (c.outcome === 'win' ? 2.4 : 1.2)) { c.state = 'exit'; c.t = 0; }
    } else if (c.state === 'exit') {
      c.y += dt * 1.8; c.open += (.5 - c.open) * dt * 3;
      if (c.y > S.H + 1.5) { removeClaw(c); return; }
    }
    c.vx += (tvx - c.vx) * Math.min(1, dt * 7); c.vz += (tvz - c.vz) * Math.min(1, dt * 7);
    c.x = clamp(c.x + c.vx * dt, -hw, hw); c.z = clamp(c.z + c.vz * dt, -hd, hd);
    if (c.zr === undefined || c.state === 'play' || c.state === 'enter' || c.state === 'exit') c.zr = clamp(c.z + c.dodge, -hd, hd);
    // yay benzeri sallanma
    const ax = (c.vx * .16 - c.swx) * 55 - c.swvx * 5, az = (c.vz * .16 - c.swz) * 55 - c.swvz * 5;
    c.swvx += ax * dt; c.swvz += az * dt; c.swx += c.swvx * dt; c.swz += c.swvz * dt;
    // tutulan topun hedefi
    c.grip = [c.x, c.y - .25 - (c.ball ? c.ball.r : .15) * .9, c.zr];
  }
  function drop(c) { if (c.state !== 'play') return; c.state = 'drop'; c.t = 0; c.ix = c.iz = 0; if (c.player) send(c.player.pid, { t: 'drop' }); }
  function release(c, slip) { if (!c.ball) return; c.ball.held = null; c.ball.vy = -.5; c.ball = null; if (slip) c.open = .55; }
  function finish(c) {
    const win = c.outcome === 'win' && c.ball;
    const prize = win ? c.prize : '';
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (c.player) {
      send(c.player.pid, { t: 'result', win: !!win, prize, code, near: c.outcome === 'slip' });
      if (win && S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify({ t: 'win', pid: c.player.pid, name: c.player.name, prize, code }));
    }
  }
  // her ödülün kendi yüzdesi; toplamın dışında kalan kısım kaybettirir
  function rollPrize() {
    let r = Math.random() * 100;
    for (const p of S.cfg.prizes || []) { const ch = Math.max(0, +p.chance || 0); if (r < ch) return p.name || 'Hediye'; r -= ch; }
    return null;
  }
  function removeClaw(c) {
    release(c); S.claws.splice(S.claws.indexOf(c), 1); c.hud?.remove();
    if (c.player) { c.player.claw = null; sendIdle(c.player); }
    processQueue();
  }

  // ---------- vitrin modu (kimse oynamıyorken) ----------
  function botThink(c, dt) {
    if (!c.goal) { const cands = S.balls.filter(b => !b.held && b.y > .5); const b = cands[Math.floor(Math.random() * cands.length)] || S.balls[0]; c.goal = [b.x, b.z]; c.wait = rnd(2.5, 5); }
    const dx = c.goal[0] - c.x, dz = c.goal[1] - c.z, d = Math.hypot(dx, dz);
    c.ix = d > .05 ? clamp(dx * 3, -1, 1) * .8 : 0; c.iz = d > .05 ? clamp(dz * 3, -1, 1) * .8 : 0;
    if (c.t > c.wait && d < .08) drop(c);
  }

  // ---------- parçacıklar ----------
  const CONF = ['#b6ff22', '#ff26cf', '#1fb6ff', '#ffe02e', '#ffffff', '#ff8a5c'].map(lin);
  function pop(b, col) {
    for (let i = 0; i < 90; i++) {
      const th = rnd(0, 6.28), ph = Math.acos(rnd(-1, 1)), sp = rnd(1.5, 4.2);
      S.parts.push({ x: b.x, y: b.y, z: b.z, vx: Math.sin(ph) * Math.cos(th) * sp, vy: Math.cos(ph) * sp + 1.5, vz: Math.sin(ph) * Math.sin(th) * sp * .4, life: rnd(1.4, 2.6), age: 0, col: i % 4 ? CONF[i % CONF.length] : col, q: M.qAxis(rnd(-1, 1), 1, rnd(-1, 1), rnd(0, 6)), spin: rnd(4, 12), s: rnd(.025, .045), box: Math.random() < .6 });
    }
    S.bursts.push({ x: b.x, y: b.y, z: b.z, age: 0, col });
  }
  function updateParts(dt) {
    for (const p of S.parts) { p.age += dt; p.vy -= 4.5 * dt; p.vx *= .985; p.vz *= .985; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; if (p.y < .05) { p.y = .05; p.vy *= -.3; p.vx *= .7; } p.q = M.qMul(M.qAxis(1, .3, .2, p.spin * dt), p.q); }
    S.parts = S.parts.filter(p => p.age < p.life);
    S.bursts.forEach(b => b.age += dt); S.bursts = S.bursts.filter(b => b.age < .7);
  }

  // ---------- sahneyi çiz ----------
  const DIRS = (() => { const a = [], n = 22; for (let i = 0; i < n; i++) { const y = 1 - 2 * (i + .5) / n, r = Math.sqrt(1 - y * y), t = i * 2.39996; a.push([r * Math.cos(t), y, r * Math.sin(t)]); } return a; })();
  const CLOUD = [[0, 0, 0, .62], [.48, 0, 0, .48], [-.48, 0, 0, .48], [0, .48, 0, .48], [0, -.48, 0, .48], [0, 0, .48, .48], [0, 0, -.48, .48], [.33, .33, .33, .4], [-.33, .33, -.33, .4]];
  function drawScene() {
    const W = S.W, H = S.H, D = S.D, hd = D / 2;
    G.add('box', 0, H / 2, -hd - .1, null, W + 1, H + 1, .2, C_WALL, 4, .85, 0, 0, 1);
    G.add('box', 0, -.1, 0, null, W + 1, .2, D + .6, C_FLOOR, 2, .8, 0, 0, 1);
    G.add('box', -W / 2 - .1, H / 2, 0, null, .2, H + 1, D + .4, C_WALL, 2, .85, 0, 0, 1);
    G.add('box', W / 2 + .1, H / 2, 0, null, .2, H + 1, D + .4, C_WALL, 2, .85, 0, 0, 1);
    G.add('box', 0, H + .1, 0, null, W + 1, .2, D + .4, C_WALL, 2, .85, 0, 0, 1);
    G.add('box', 0, -.16, hd + .14, null, W + 1, .4, .3, C_SILL, 2, .55, 0, .05, 1);           // ön alt pervaz
    G.add('box', 0, H + .2, hd + .08, null, W + 1, .44, .22, C_WALL, 2, .8, 0, 0, 1);           // üst kemer
    G.add('box', 0, H - .035, hd - .05, null, W, .025, .03, C_LED, 7, .5, 0, 5, 1);              // üst LED şerit
    G.add('box', 0, H - .02, -hd + .03, null, W, .02, .03, C_LED, 7, .5, 0, 2.5, 1);
    for (const s of [-1, 1]) G.add('box', s * (W / 2 - .02), H / 2, hd - .05, null, .02, H, .03, C_LED, 7, .5, 0, 1.1, 1);
    // toplar
    for (const b of S.balls) {
      const ao = .62 + .38 * clamp(b.y / (H * .42), 0, 1), r = b.r * b.scale;
      if (b.type === 'solid') G.add('sphere', b.x, b.y, b.z, b.q, r, r, r, b.col, 0, b.rough, 0, b.emis, ao);
      else if (b.type === 'stripe') G.add('sphere', b.x, b.y, b.z, b.q, r, r, r, b.col, 1, .28, 0, .02, ao);
      else if (b.type === 'cloud') for (const k of CLOUD) { const o = M.qRot(b.q, k[0] * r, k[1] * r, k[2] * r); G.add('sphere', b.x + o[0], b.y + o[1], b.z + o[2], null, k[3] * r, k[3] * r, k[3] * r, b.col, 6, .5, 0, .03, ao); }
      else {
        G.add('sphere', b.x, b.y, b.z, b.q, r * .5, r * .5, r * .5, b.col, 0, .15, .2, .25, ao);
        for (const d of DIRS) { const v = M.qRot(b.q, ...d); G.add('cone', b.x + v[0] * r * .3, b.y + v[1] * r * .3, b.z + v[2] * r * .3, M.qFromTo(...v), r * .15, r * .95, r * .15, b.col, 0, .15, .2, .3, ao); }
      }
    }
    for (const c of S.claws) clawParts(c, true);
    for (const p of S.parts) { const f = 1 - Math.max(0, p.age - p.life + .4) / .4; if (p.box) G.add('box', p.x, p.y, p.z, p.q, p.s * 1.6 * f, p.s * .25, p.s * f, p.col, 0, .35, 0, .5, 1); else G.add('sphere', p.x, p.y, p.z, null, p.s * .7 * f, p.s * .7 * f, p.s * .7 * f, p.col, 0, .2, 0, .9, 1); }
    for (const b of S.bursts) { const k = b.age / .7, len = .25 + k * .9, w = .05 * (1 - k); for (const d of DIRS) G.add('cone', b.x + d[0] * k * .3, b.y + d[1] * k * .3, b.z + d[2] * k * .3, M.qFromTo(...d), w, len, w, b.col, 7, .3, 0, 6 * (1 - k), 1); }
  }

  // ---------- HUD (pençe yanındaki sayaç halkası) ----------
  const hudLayer = document.getElementById('hud');
  function makeHud(c) {
    const el = document.createElement('div'); el.className = 'hud';
    el.style.setProperty('--c', c.hex);
    el.innerHTML = `<svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="18" class="bg"/><circle cx="22" cy="22" r="18" class="fg" pathLength="100"/></svg>`;
    hudLayer.appendChild(el); c.hud = el;
  }
  function updateHud() {
    for (const c of S.claws) {
      const el = c.hud; if (!el) continue;
      const show = (c.state === 'play' || c.state === 'enter') && !c.bot;
      el.style.opacity = show ? 1 : 0;
      const p = G.project(c.x + .34, c.y + .72, c.zr);
      el.style.transform = `translate(${p[0] * innerWidth}px,${p[1] * innerHeight}px) translate(-50%,-50%)`;
      el.querySelector('.fg').style.strokeDashoffset = 100 - (c.left / S.cfg.playSeconds) * 100;
    }
  }
  // kazanma anı yazısız: 3D patlama + konfeti

  // ---------- oyuncular / sıra ----------
  function player(pid) { let p = S.players.get(pid); if (!p) S.players.set(pid, p = { pid, name: '', plays: 0, claw: null, online: true }); return p; }
  function humansActive() { return S.claws.filter(c => c.player && c.state !== 'exit').length; }
  function processQueue() {
    while (S.queue.length && humansActive() + S.claws.filter(c => c.bot).length < S.cfg.maxPlayers) newClaw(S.queue.shift());
    if (S.queue.length) S.claws.filter(c => c.bot && c.state === 'play').forEach(drop);
    S.queue.forEach((p, i) => send(p.pid, { t: 'queue', pos: i + 1 }));
    updateQueueChip();
  }
  function sendIdle(p) {
    const lim = +S.cfg.playsPerPhone || 0;
    send(p.pid, lim && p.plays >= lim ? { t: 'limit' } : { t: 'idle', title: S.cfg.title });
  }
  function onMsg(m) {
    if (m.t === 'hello') {
      Object.assign(S.cfg, m.config || {}); S.playUrl = m.playUrl; applyConfig();
      (m.players || []).forEach(pid => { player(pid).online = true; sendIdle(player(pid)); });
      return;
    }
    if (m.t === 'config') { Object.assign(S.cfg, m.config || {}); applyConfig(); return; }
    const p = m.pid && player(m.pid); if (!p) return;
    if (m.t === 'connect') { p.online = true; if (p.claw) send(p.pid, { t: p.claw.state === 'play' ? 'play' : 'drop', seconds: Math.ceil(p.claw.left), color: p.claw.hex }); else if (S.queue.includes(p)) processQueue(); else sendIdle(p); }
    else if (m.t === 'join') {
      if (p.claw || S.queue.includes(p)) return;
      const lim = +S.cfg.playsPerPhone || 0; if (lim && p.plays >= lim) return send(p.pid, { t: 'limit' });
      p.name = (m.name || '').trim().slice(0, 14);
      S.lastHuman = S.time; S.queue.push(p); processQueue();
    } else if (m.t === 'input') { if (p.claw && p.claw.state === 'play') { p.claw.ix = m.x; p.claw.iz = m.z; } }
    else if (m.t === 'grab') { if (p.claw) drop(p.claw); }
    else if (m.t === 'leave') { p.online = false; S.queue = S.queue.filter(q => q !== p); if (p.claw) { p.claw.ix = p.claw.iz = 0; } processQueue(); }
  }
  function send(pid, msg) { if (pid === 'kb' || !S.ws || S.ws.readyState !== 1) return; S.ws.send(JSON.stringify({ t: 'to', pid, msg })); }
  function connect() {
    if (location.protocol === 'file:') return;
    let ws; try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?role=screen'); } catch (e) { return; }
    S.ws = ws;
    ws.onopen = () => { S.online = true; document.body.classList.add('online'); };
    ws.onmessage = e => { try { onMsg(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    ws.onclose = () => { S.online = false; document.body.classList.remove('online'); setTimeout(connect, 1500); };
  }

  // ---------- arayüz ----------
  function applyConfig() {
    const url = S.playUrl || (location.origin + '/play');
    document.getElementById('qrimg').innerHTML = QR.toSVG(url, { quiet: 2 });
    document.getElementById('brand').textContent = S.cfg.title || '';
    document.documentElement.style.setProperty('--qr', (S.cfg.qrSize || .15) * 100 + 'vmin');
    drawTitle();
  }
  function updateQueueChip() { const el = document.getElementById('queue'); el.innerHTML = '<i></i>'.repeat(Math.min(S.queue.length, 12)); }
  function drawTitle() {
    const cv = document.createElement('canvas'); cv.width = 2048; cv.height = Math.round(2048 * S.titleRect[3] / S.titleRect[2]);
    const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    let fs = cv.height * .82; x.font = `900 ${fs}px "Arial Black","Helvetica Neue",Arial,sans-serif`;
    const w = x.measureText(S.cfg.title).width; if (w > cv.width * .96) { fs *= cv.width * .96 / w; x.font = `900 ${fs}px "Arial Black","Helvetica Neue",Arial,sans-serif`; }
    x.fillText(S.cfg.title, cv.width / 2, cv.height * .54);
    G.setTitle(cv);
  }

  // ---------- klavye (test / kurulum) ----------
  const keys = {};
  addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code === 'KeyF') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
    if (e.code === 'KeyQ') document.body.classList.toggle('noqr');
    if (e.code === 'KeyD') { S.debug = !S.debug; document.body.classList.toggle('debug', S.debug); }
    if (e.code === 'KeyT') onMsg({ t: 'join', pid: 'kb', name: 'Test' });
    if (e.code === 'Space') { const p = S.players.get('kb'); if (p?.claw) drop(p.claw); e.preventDefault(); }
  });
  addEventListener('keyup', e => keys[e.code] = false);
  function keyboard() { const p = S.players.get('kb'); if (p?.claw && p.claw.state === 'play') { p.claw.ix = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0); p.claw.iz = (keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0); } }

  // ---------- döngü ----------
  const canvas = document.getElementById('c'), fpsEl = document.getElementById('dbg');
  let last = performance.now(), fpsAcc = 0, fpsN = 0;
  function resize() {
    const scale = Math.min(devicePixelRatio || 1, 1.5), w = Math.min(2560, Math.round(innerWidth * scale)), h = Math.round(w * innerHeight / innerWidth);
    canvas.width = w; canvas.height = h; G.resize(w, h);
    const oldW = S.W; layout(); if (S.balls.length && Math.abs(oldW - S.W) > .3) fillBalls(); drawTitle();
  }
  function frame(now) {
    const dt = Math.min(1 / 30, (now - last) / 1000); last = now; S.time += dt;
    fpsAcc += dt; fpsN++; if (fpsAcc > .5) { fpsEl.textContent = S.debug ? `${Math.round(fpsN / fpsAcc)} fps · ${S.balls.length} top · ${S.claws.length} pençe` : ''; fpsAcc = 0; fpsN = 0; }
    keyboard();
    S.claws.slice().forEach(c => updateClaw(c, dt));
    // pençeler birbirini itmez: yaklaşınca biri öne biri arkaya süzülür, temas etmeden geçerler
    for (const a of S.claws) {
      if (!['play', 'enter', 'exit'].includes(a.state)) continue;
      let tgt = 0;
      for (const b of S.claws) if (a !== b && a.y < S.H + .5 && b.y < S.H + .5 && Math.abs(a.x - b.x) < .75) tgt += a.lane < b.lane ? .34 : -.34;
      tgt = clamp(tgt, -.34, .34); a.dodge += (tgt - a.dodge) * Math.min(1, dt * 4);
    }
    if (S.cfg.attractMode && !S.queue.length && !S.claws.length && S.time - S.lastHuman > 6) { newClaw(null, true); S.lastHuman = S.time; }
    physics(dt); updateParts(dt);
    G.begin(); drawScene();
    const L = [.22, 1, .5], l = Math.hypot(...L);
    G.render(S.cam, { lightDir: L.map(v => v / l), box: [S.W / 2, S.H, S.D / 2], titleRect: S.titleRect, time: S.time, bloom: .55, exposure: .95, bloomThreshold: 1.25 });
    updateHud();
    requestAnimationFrame(frame);
  }
  try { G.init(canvas); } catch (e) { document.body.innerHTML = '<p style="color:#fff;font:24px sans-serif;padding:40px">Bu tarayıcı WebGL2 desteklemiyor. Chrome veya Edge kullanın.</p>'; throw e; }
  layout(); resize(); applyConfig(); fillBalls(); updateQueueChip();
  addEventListener('resize', resize);
  fetch('/info').then(r => r.json()).then(i => { if (!S.online) { Object.assign(S.cfg, i.config || {}); S.playUrl = i.playUrl; applyConfig(); } }).catch(() => { });
  connect();
  requestAnimationFrame(frame);
  S.api = { onMsg, drop, newClaw };
  // test: oyunu ileri sar (render etmeden)
  S.sim = (sec, hook) => { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { S.time += 1 / 60; hook && hook(S.time); S.claws.slice().forEach(c => updateClaw(c, 1 / 60)); physics(1 / 60); updateParts(1 / 60); } };
})();
