// Mini WebGL2 3D motoru: instanced çizim, gölge haritası, parlak plastik/metal shader, bloom, ACES
(function () {
  const G = {};
  let gl, cw = 1, ch = 1, hdr = false;

  // ---------- matematik ----------
  const M = {
    persp(fovy, a, n, f) { const t = 1 / Math.tan(fovy / 2), r = new Float32Array(16); r[0] = t / a; r[5] = t; r[10] = (f + n) / (n - f); r[11] = -1; r[14] = 2 * f * n / (n - f); return r; },
    ortho(l, r_, b, t, n, f) { const r = new Float32Array(16); r[0] = 2 / (r_ - l); r[5] = 2 / (t - b); r[10] = -2 / (f - n); r[12] = -(r_ + l) / (r_ - l); r[13] = -(t + b) / (t - b); r[14] = -(f + n) / (f - n); r[15] = 1; return r; },
    lookAt(e, c, u) {
      let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2], l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
      let xx = u[1] * zz - u[2] * zy, xy = u[2] * zx - u[0] * zz, xz = u[0] * zy - u[1] * zx; l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]);
    },
    mul(a, b) { const r = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; r[i * 4 + j] = s; } return r; },
    xform(m, x, y, z) { const w = m[3] * x + m[7] * y + m[11] * z + m[15]; return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w]; },
    qAxis(ax, ay, az, ang) { const s = Math.sin(ang / 2), l = Math.hypot(ax, ay, az) || 1; return [ax / l * s, ay / l * s, az / l * s, Math.cos(ang / 2)]; },
    qMul(a, b) { return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]]; },
    qRot(q, x, y, z) { // vektörü döndür
      const [qx, qy, qz, qw] = q, ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
      return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
    },
    qFromTo(dx, dy, dz) { // (0,1,0) -> d
      const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
      if (dy < -0.99999) return [1, 0, 0, 0];
      const x = dz, y = 0, z = -dx, w = 1 + dy, n = Math.hypot(x, y, z, w); return [x / n, y / n, z / n, w / n];
    },
  };
  G.M = M;

  // ---------- geometri ----------
  function geo(p, n, i) { return { p: new Float32Array(p), n: new Float32Array(n), i: new Uint16Array(i) }; }
  function sphere(seg, ring) {
    const p = [], n = [], i = [];
    for (let r = 0; r <= ring; r++) { const v = r / ring, th = v * Math.PI; for (let s = 0; s <= seg; s++) { const u = s / seg, ph = u * Math.PI * 2; const x = Math.sin(th) * Math.cos(ph), y = Math.cos(th), z = Math.sin(th) * Math.sin(ph); p.push(x, y, z); n.push(x, y, z); } }
    for (let r = 0; r < ring; r++) for (let s = 0; s < seg; s++) { const a = r * (seg + 1) + s, b = a + seg + 1; i.push(a, a + 1, b, b, a + 1, b + 1); }
    return geo(p, n, i);
  }
  function cylinder(seg) {
    const p = [], n = [], i = [];
    for (let s = 0; s <= seg; s++) { const a = s / seg * Math.PI * 2, x = Math.cos(a), z = Math.sin(a); p.push(x, -.5, z, x, .5, z); n.push(x, 0, z, x, 0, z); }
    for (let s = 0; s < seg; s++) { const a = s * 2; i.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    for (const y of [-.5, .5]) { const c = p.length / 3; p.push(0, y, 0); n.push(0, Math.sign(y), 0); for (let s = 0; s <= seg; s++) { const a = s / seg * Math.PI * 2; p.push(Math.cos(a), y, Math.sin(a)); n.push(0, Math.sign(y), 0); } for (let s = 0; s < seg; s++) y > 0 ? i.push(c, c + s + 2, c + s + 1) : i.push(c, c + s + 1, c + s + 2); }
    return geo(p, n, i);
  }
  function cone(seg) {
    const p = [], n = [], i = [], k = 1 / Math.hypot(1, 1);
    for (let s = 0; s <= seg; s++) { const a = s / seg * Math.PI * 2, x = Math.cos(a), z = Math.sin(a); p.push(x, 0, z, 0, 1, 0); n.push(x * k, k, z * k, x * k, k, z * k); }
    for (let s = 0; s < seg; s++) { const a = s * 2; i.push(a, a + 1, a + 2); }
    return geo(p, n, i);
  }
  function box() {
    const p = [], n = [], i = [], F = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    F.forEach(([nx, ny, nz]) => {
      const u = ny ? [1, 0, 0] : [0, 1, 0], v = [ny * u[2] - nz * u[1], nz * u[0] - nx * u[2], nx * u[1] - ny * u[0]], c = p.length / 3;
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { p.push((nx + u[0] * a + v[0] * b) * .5, (ny + u[1] * a + v[1] * b) * .5, (nz + u[2] * a + v[2] * b) * .5); n.push(nx, ny, nz); }
      i.push(c, c + 1, c + 2, c, c + 2, c + 3);
    });
    return geo(p, n, i);
  }
  function torus(seg, tseg, tr) {
    const p = [], n = [], i = [];
    for (let a = 0; a <= seg; a++) { const u = a / seg * Math.PI * 2, cu = Math.cos(u), su = Math.sin(u); for (let b = 0; b <= tseg; b++) { const v = b / tseg * Math.PI * 2, cv = Math.cos(v), sv = Math.sin(v); p.push((1 + tr * cv) * cu, tr * sv, (1 + tr * cv) * su); n.push(cv * cu, sv, cv * su); } }
    for (let a = 0; a < seg; a++) for (let b = 0; b < tseg; b++) { const x = a * (tseg + 1) + b, y = x + tseg + 1; i.push(x, y, x + 1, x + 1, y, y + 1); }
    return geo(p, n, i);
  }

  // ---------- shader'lar ----------
  const VS = `#version 300 es
  layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm;
  layout(location=3) in vec4 aM0; layout(location=4) in vec4 aM1; layout(location=5) in vec4 aM2; layout(location=6) in vec4 aM3;
  layout(location=7) in vec4 aCol; layout(location=8) in vec4 aPar;
  uniform mat4 uVP; uniform mat4 uLVP;
  out vec3 vW; out vec3 vN; out vec3 vL; out vec3 vT; out vec4 vCol; out vec4 vPar; out vec4 vLS;
  void main(){
    mat4 M = mat4(aM0,aM1,aM2,aM3); vec4 w = M*vec4(aPos,1.0);
    vW = w.xyz; vN = normalize(transpose(inverse(mat3(M)))*aNrm); vL = aPos;
    vT = normalize(mat3(M)*vec3(-aPos.z,0.0,aPos.x)+1e-5);
    vCol = aCol; vPar = aPar; vLS = uLVP*w; gl_Position = uVP*w;
  }`;
  const FS = `#version 300 es
  precision highp float; precision highp sampler2DShadow;
  in vec3 vW; in vec3 vN; in vec3 vL; in vec3 vT; in vec4 vCol; in vec4 vPar; in vec4 vLS;
  uniform vec3 uCam; uniform vec3 uLDir; uniform sampler2DShadow uShadow; uniform sampler2D uTitle;
  uniform vec4 uTitleRect; uniform float uTime; uniform vec3 uBox;
  out vec4 o;
  float h3(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  float n3(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
    return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }
  float fbm(vec3 p){ float a=.5,s=0.; for(int i=0;i<5;i++){ s+=a*n3(p); p*=2.03; a*=.5; } return s; }
  vec3 env(vec3 d){ // neon gece ortamı: karanlık, pembe-camgöbeği neon şeritler
    vec3 c = mix(vec3(.010,.008,.025), vec3(.05,.03,.12), smoothstep(-.4,.6,d.y));
    c += vec3(1.6,1.4,2.2)*smoothstep(.86,.97,d.y);                                         // tavan paneli
    c += vec3(2.6,.25,1.5)*smoothstep(.80,.95,-d.x)*smoothstep(-.2,.4,d.y);                 // sol neon (pembe)
    c += vec3(.15,1.9,2.6)*smoothstep(.80,.95, d.x)*smoothstep(-.2,.4,d.y);                 // sağ neon (camgöbeği)
    float f = smoothstep(.55,.9,d.z)*smoothstep(.0,.25,d.y)*smoothstep(.6,.3,abs(d.x));
    c += vec3(.9,.6,1.6)*f;                                                                 // ön mor ışık
    c += vec3(.6,.2,1.2)*smoothstep(-.5,-.85,d.y);                                          // zemin parıltısı
    return c;
  }
  float shadow(){
    vec3 p = vLS.xyz/vLS.w*0.5+0.5;
    if(p.x<0.||p.x>1.||p.y<0.||p.y>1.||p.z>1.) return 1.0;
    float s=0., t=1.0/2048.0;
    for(int x=-2;x<=2;x++) for(int y=-2;y<=2;y++) s += texture(uShadow, vec3(p.xy+vec2(x,y)*t*1.2, p.z-0.0015));
    return s/25.0;
  }
  void main(){
    vec3 N = normalize(vN); if(!gl_FrontFacing) N = -N;
    vec3 V = normalize(uCam - vW);
    vec3 alb = vCol.rgb; float pat = vCol.a;
    float rough = vPar.x, metal = vPar.y, emis = vPar.z, ao = vPar.w;
    float wrap = 0.25;
    if(pat > .5 && pat < 1.5){ // çizgili beyaz top
      vec3 l = normalize(vL); float ang = atan(l.z,l.x), k = 7.0;
      float s = sin(ang*k), pole = smoothstep(.93,.80,abs(l.y));
      float groove = mix(1.0, smoothstep(0.0,.55,abs(s)), pole);
      alb = mix(alb*vec3(.50,.58,.92), alb, groove);
      N = normalize(N + normalize(vT)*cos(ang*k)*sign(s)*(1.0-groove)*1.3);
      rough = mix(.55, rough, groove);
    } else if(pat > 1.5 && pat < 4.5){ // koyu parlak panel + ince ızgara
      vec3 q = vW;
      float n = fbm(q*3.0)*.5 + n3(q*30.0)*.15;
      alb *= .75 + .35*n;
      vec2 gp = (abs(N.y)>.9 ? q.xz : abs(N.x)>.9 ? q.zy : q.xy)/.5;
      vec2 gg = abs(fract(gp)-.5);
      float line = smoothstep(.485,.497,max(gg.x,gg.y));
      alb = mix(alb, alb*.35, line);
      emis += line*.0;
      rough = mix(rough, .9, line);
    } else if(pat > 5.5 && pat < 6.5){ wrap = .8; } // bulut — yumuşak
    float NdV = max(dot(N,V),1e-3);
    vec3 L = normalize(uLDir), H = normalize(L+V);
    float NdL = dot(N,L), sh = shadow();
    if(pat > 1.5 && pat < 4.5) sh = mix(1.0, sh, .5);
    float diff = max((NdL+wrap)/(1.0+wrap),0.0);
    float a2 = max(rough*rough,.002); a2*=a2;
    float NdH = max(dot(N,H),0.0), dd = NdH*NdH*(a2-1.0)+1.0, D = a2/(3.14159*dd*dd);
    float k = (rough+1.0)*(rough+1.0)/8.0, Gs = NdV/(NdV*(1.0-k)+k) * max(NdL,0.0)/(max(NdL,0.0)*(1.0-k)+k);
    vec3 F0 = mix(vec3(.04), alb, metal);
    vec3 F = F0 + (1.0-F0)*pow(1.0-max(dot(H,V),0.0),5.0);
    vec3 spec = D*Gs*F/(4.0*NdV*max(NdL,0.0)+1e-3) * max(NdL,0.0);
    if(pat < 1.5 || pat > 5.5 || (pat>4.5 && pat<5.5)) ao *= mix(.42,1.0,smoothstep(-.85,.55,N.y)); // temas gölgesi
    vec3 sky = vec3(.20,.16,.42), gnd = vec3(.10,.04,.14);
    vec3 hemi = mix(gnd, sky, N.y*.5+.5);
    vec3 R = reflect(-V,N);
    vec3 envc = mix(env(R), hemi, clamp(rough*1.3,0.0,1.0));
    vec3 Fe = F0 + (max(vec3(1.0-rough),F0)-F0)*pow(1.0-NdV,5.0);
    vec3 lc = vec3(1.35,1.25,1.6);
    // yan neon ışıklar (gölgesiz, renkli kenar ışığı)
    vec3 Lp = normalize(vec3(-1.0,.35,.45)), Lc = normalize(vec3(1.0,.35,.45));
    vec3 neon = vec3(1.7,.18,.95)*max(dot(N,Lp)*.8+.2,0.0) + vec3(.12,1.15,1.7)*max(dot(N,Lc)*.8+.2,0.0);
    vec3 col = alb*(1.0-metal)*(diff*lc*sh*.8 + hemi*.35 + neon*.22)*ao + spec*lc*sh + envc*Fe*mix(ao,1.0,.35) + alb*emis;
    // derinlik: dolabın gerisi biraz koyulaşır
    col *= mix(.6, 1.0, smoothstep(-uBox.z, uBox.z, vW.z));
    o = vec4(col, 1.0);
  }`;
  const VS_SH = `#version 300 es
  layout(location=0) in vec3 aPos;
  layout(location=3) in vec4 aM0; layout(location=4) in vec4 aM1; layout(location=5) in vec4 aM2; layout(location=6) in vec4 aM3;
  layout(location=7) in vec4 aCol; uniform mat4 uLVP;
  void main(){ if((aCol.a>1.5&&aCol.a<4.5)||aCol.a>6.5){ gl_Position=vec4(2.,2.,2.,1.); return; } gl_Position = uLVP*mat4(aM0,aM1,aM2,aM3)*vec4(aPos,1.0); }`;
  const FS_SH = `#version 300 es
  precision mediump float; void main(){}`;
  const VS_Q = `#version 300 es
  out vec2 uv; void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2); uv = p; gl_Position = vec4(p*2.0-1.0,0,1); }`;
  const FS_BRIGHT = `#version 300 es
  precision highp float; in vec2 uv; uniform sampler2D uT; uniform vec2 uTx; uniform float uThr; out vec4 o;
  void main(){ vec3 c = (texture(uT,uv+uTx*vec2(-1,-1)).rgb+texture(uT,uv+uTx*vec2(1,-1)).rgb+texture(uT,uv+uTx*vec2(-1,1)).rgb+texture(uT,uv+uTx*vec2(1,1)).rgb)*.25;
    float l = max(c.r,max(c.g,c.b)); o = vec4(c*smoothstep(uThr, uThr+.6, l), 1.0); }`;
  const FS_DOWN = `#version 300 es
  precision highp float; in vec2 uv; uniform sampler2D uT; uniform vec2 uTx; out vec4 o;
  void main(){ o = (texture(uT,uv+uTx*vec2(-1,-1))+texture(uT,uv+uTx*vec2(1,-1))+texture(uT,uv+uTx*vec2(-1,1))+texture(uT,uv+uTx*vec2(1,1)))*.25; }`;
  const FS_BLUR = `#version 300 es
  precision highp float; in vec2 uv; uniform sampler2D uT; uniform vec2 uDir; out vec4 o;
  void main(){ float w[5] = float[](.227027,.1945946,.1216216,.054054,.016216);
    vec3 c = texture(uT,uv).rgb*w[0]; for(int i=1;i<5;i++){ c += texture(uT,uv+uDir*float(i)*1.4).rgb*w[i]; c += texture(uT,uv-uDir*float(i)*1.4).rgb*w[i]; } o = vec4(c,1); }`;
  const FS_COMP = `#version 300 es
  precision highp float; in vec2 uv; uniform sampler2D uScene, uB1, uB2, uB3, uB4; uniform float uBloom, uExp, uTime; out vec4 o;
  vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.); }
  void main(){
    vec3 c = texture(uScene,uv).rgb;
    vec3 b = texture(uB1,uv).rgb*.35 + texture(uB2,uv).rgb*.55 + texture(uB3,uv).rgb*.75 + texture(uB4,uv).rgb*.9;
    c = (c + b*uBloom)*uExp;
    c = aces(c); c = pow(c, vec3(1.0/2.2));
    vec2 d = uv-.5; c *= 1.0 - dot(d,d)*.35;
    c += (fract(sin(dot(uv*1000.0+uTime, vec2(12.9898,78.233)))*43758.5453)-.5)*.012;
    o = vec4(c,1);
  }`;

  function compile(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function program(vs, fs) {
    const p = gl.createProgram(); gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
    return { p, u };
  }

  // ---------- instanced batch'ler ----------
  const STRIDE = 24, meshes = {};
  function makeMesh(name, g, cap) {
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, g.p, gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, g.n, gl.STATIC_DRAW); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.i, gl.STATIC_DRAW);
    const inst = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, inst); gl.bufferData(gl.ARRAY_BUFFER, cap * STRIDE * 4, gl.DYNAMIC_DRAW);
    for (let k = 0; k < 6; k++) { gl.enableVertexAttribArray(3 + k); gl.vertexAttribPointer(3 + k, 4, gl.FLOAT, false, STRIDE * 4, k * 16); gl.vertexAttribDivisor(3 + k, 1); }
    gl.bindVertexArray(null);
    meshes[name] = { vao, inst, count: g.i.length, cap, data: new Float32Array(cap * STRIDE), n: 0 };
  }

  // TRS + renk + malzeme ekle
  G.add = function (mesh, px, py, pz, q, sx, sy, sz, col, pat, rough, metal, emis, ao) {
    const m = meshes[mesh]; if (m.n >= m.cap) return;
    const d = m.data, o = m.n++ * STRIDE;
    const [x, y, z, w] = q || [0, 0, 0, 1];
    const x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    d[o] = (1 - (yy + zz)) * sx; d[o + 1] = (xy + wz) * sx; d[o + 2] = (xz - wy) * sx; d[o + 3] = 0;
    d[o + 4] = (xy - wz) * sy; d[o + 5] = (1 - (xx + zz)) * sy; d[o + 6] = (yz + wx) * sy; d[o + 7] = 0;
    d[o + 8] = (xz + wy) * sz; d[o + 9] = (yz - wx) * sz; d[o + 10] = (1 - (xx + yy)) * sz; d[o + 11] = 0;
    d[o + 12] = px; d[o + 13] = py; d[o + 14] = pz; d[o + 15] = 1;
    d[o + 16] = col[0]; d[o + 17] = col[1]; d[o + 18] = col[2]; d[o + 19] = pat;
    d[o + 20] = rough; d[o + 21] = metal; d[o + 22] = emis; d[o + 23] = ao;
  };
  // a noktasından b noktasına uzanan silindir/kapsül parçası
  G.seg = function (ax, ay, az, bx, by, bz, r, col, pat, rough, metal, emis, ao) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, l = Math.hypot(dx, dy, dz);
    G.add('cyl', (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, M.qFromTo(dx, dy, dz), r, l, r, col, pat, rough, metal, emis, ao);
  };

  // ---------- framebuffer'lar ----------
  let progMain, progSh, progBright, progDown, progBlur, progComp, shadowFBO, shadowTex, msFBO, resFBO, resTex, levels = [], titleTex, emptyVAO;
  function tex(w, h, internal, format, type, filter) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function fboFor(t) { const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return f; }
  const colorFmt = () => hdr ? [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT] : [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE];

  G.init = function (canvas) {
    gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 desteklenmiyor');
    hdr = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
    progMain = program(VS, FS); progSh = program(VS_SH, FS_SH);
    progBright = program(VS_Q, FS_BRIGHT); progDown = program(VS_Q, FS_DOWN); progBlur = program(VS_Q, FS_BLUR); progComp = program(VS_Q, FS_COMP);
    makeMesh('sphere', sphere(40, 28), 3000);
    makeMesh('cyl', cylinder(28), 1500);
    makeMesh('cone', cone(14), 1500);
    makeMesh('box', box(), 600);
    makeMesh('torus', torus(32, 14, .42), 400);
    emptyVAO = gl.createVertexArray();
    shadowTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, 2048, 2048, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    shadowFBO = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFBO); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
    titleTex = gl.createTexture();
    return gl;
  };
  G.resize = function (w, h) {
    cw = w; ch = h;
    const [ifmt, fmt, type] = colorFmt();
    msFBO && gl.deleteFramebuffer(msFBO);
    const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));
    msFBO = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, msFBO);
    const crb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, crb); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, ifmt, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, crb);
    const drb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, drb); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, drb);
    resTex = tex(w, h, ifmt, fmt, type, gl.LINEAR); resFBO = fboFor(resTex);
    levels = [];
    let lw = w, lh = h;
    for (let i = 0; i < 4; i++) {
      lw = Math.max(1, lw >> 1); lh = Math.max(1, lh >> 1);
      const a = tex(lw, lh, ifmt, fmt, type, gl.LINEAR), b = tex(lw, lh, ifmt, fmt, type, gl.LINEAR);
      levels.push({ w: lw, h: lh, a, b, fa: fboFor(a), fb: fboFor(b) });
    }
  };
  G.setTitle = function (canvas) {
    gl.bindTexture(gl.TEXTURE_2D, titleTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  G.begin = function () { for (const k in meshes) meshes[k].n = 0; };

  function drawAll(shadowPass) {
    for (const k in meshes) {
      const m = meshes[k]; if (!m.n) continue;
      gl.bindVertexArray(m.vao);
      if (!shadowPass) { gl.bindBuffer(gl.ARRAY_BUFFER, m.inst); gl.bufferSubData(gl.ARRAY_BUFFER, 0, m.data, 0, m.n * STRIDE); }
      gl.drawElementsInstanced(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0, m.n);
    }
    gl.bindVertexArray(null);
  }
  function quad(p, fbo, w, h, setup) { gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h); gl.useProgram(p.p); setup(p.u); gl.bindVertexArray(emptyVAO); gl.drawArrays(gl.TRIANGLES, 0, 3); }
  function bindTex(unit, t, loc) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(loc, unit); }

  // cam: {eye, target, fov}, scene: {lightDir, box:[hw,h,hd], titleRect, time, bloom, exposure}
  G.render = function (cam, sc) {
    const aspect = cw / ch;
    const proj = M.persp(cam.fov, aspect, 0.1, 60), view = M.lookAt(cam.eye, cam.target, [0, 1, 0]);
    const VP = M.mul(proj, view); G.VP = VP;
    const L = sc.lightDir, c = [0, sc.box[1] * .45, 0], le = [c[0] + L[0] * 10, c[1] + L[1] * 10, c[2] + L[2] * 10];
    const ext = Math.max(sc.box[0], sc.box[1]) * 1.15;
    const LVP = M.mul(M.ortho(-ext, ext, -ext, ext, 1, 25), M.lookAt(le, c, [0, 0, -1]));

    // 1) upload + gölge
    for (const k in meshes) { const m = meshes[k]; if (m.n) { gl.bindBuffer(gl.ARRAY_BUFFER, m.inst); gl.bufferSubData(gl.ARRAY_BUFFER, 0, m.data, 0, m.n * STRIDE); } }
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFBO); gl.viewport(0, 0, 2048, 2048); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(progSh.p); gl.uniformMatrix4fv(progSh.u.uLVP, false, LVP);
    gl.disable(gl.CULL_FACE);
    drawAll(true);
    // 2) ana sahne (MSAA)
    gl.bindFramebuffer(gl.FRAMEBUFFER, msFBO); gl.viewport(0, 0, cw, ch);
    gl.clearColor(.02, .02, .04, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.CULL_FACE);
    const u = progMain.u; gl.useProgram(progMain.p);
    gl.uniformMatrix4fv(u.uVP, false, VP); gl.uniformMatrix4fv(u.uLVP, false, LVP);
    gl.uniform3fv(u.uCam, cam.eye); gl.uniform3fv(u.uLDir, L); gl.uniform1f(u.uTime, sc.time);
    gl.uniform3fv(u.uBox, sc.box); gl.uniform4fv(u.uTitleRect, sc.titleRect);
    bindTex(0, shadowTex, u.uShadow); bindTex(1, titleTex, u.uTitle);
    for (const k in meshes) { const m = meshes[k]; if (!m.n) continue; gl.bindVertexArray(m.vao); gl.drawElementsInstanced(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0, m.n); }
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
    // 3) çözümle + bloom
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msFBO); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, resFBO);
    gl.blitFramebuffer(0, 0, cw, ch, 0, 0, cw, ch, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    quad(progBright, levels[0].fa, levels[0].w, levels[0].h, u => { bindTex(0, resTex, u.uT); gl.uniform2f(u.uTx, .5 / cw, .5 / ch); gl.uniform1f(u.uThr, sc.bloomThreshold ?? 1.0); });
    for (let i = 0; i < levels.length; i++) {
      const lv = levels[i];
      if (i > 0) { const p = levels[i - 1]; quad(progDown, lv.fa, lv.w, lv.h, u => { bindTex(0, p.a, u.uT); gl.uniform2f(u.uTx, .5 / p.w, .5 / p.h); }); }
      quad(progBlur, lv.fb, lv.w, lv.h, u => { bindTex(0, lv.a, u.uT); gl.uniform2f(u.uDir, 1 / lv.w, 0); });
      quad(progBlur, lv.fa, lv.w, lv.h, u => { bindTex(0, lv.b, u.uT); gl.uniform2f(u.uDir, 0, 1 / lv.h); });
    }
    quad(progComp, null, cw, ch, u => {
      bindTex(0, resTex, u.uScene); levels.forEach((lv, i) => bindTex(1 + i, lv.a, u['uB' + (i + 1)]));
      gl.uniform1f(u.uBloom, sc.bloom ?? .8); gl.uniform1f(u.uExp, sc.exposure ?? 1); gl.uniform1f(u.uTime, sc.time % 10);
    });
  };
  G.project = function (x, y, z) { const p = M.xform(G.VP, x, y, z); return [(p[0] * .5 + .5), (1 - (p[1] * .5 + .5)), p[2]]; };
  G.info = () => ({ hdr });
  window.GLR = G;
})();
