// 작지 BOM 검증 — 카메라 가이드·자동 촬영 → 폰 안 OCR → 현재 BOM 대조 → 틀린 항목 빨간 줄
import { makeIndex, evaluate, extractNums, pickOrder, treeOf, nameOf } from './rules.js';

const $ = (s) => document.querySelector(s);
const state = { idx: null, guide: 'land', last: null, result: null, bomOnly: false };
const VERDICT = {
  OK: ['분출 가능', '현재 BOM과 일치 — 틀린 항목 없음'],
  CHECK: ['확인 후 분출', '노란 표시 항목을 육안 확인'],
  STOP: ['분출 보류', '빨간 줄 항목 수정 후 재발행'],
  UNKNOWN: ['판정 불가', 'BOM 데이터에 없는 품번'],
};
const COLOR = { red: '#D0342C', redT: '#A02318', redB: '#F9DCD9', yel: '#E8A317', yelT: '#8A5A00', yelB: '#FBEED0', ok: '#1E9E5A', okT: '#0F6B3E', okB: '#D8EFE1', navy: '#1A3B7B' };

// ---------- 공통 UI ----------
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  window.scrollTo(0, 0);
}
let toastT;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms);
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

// ---------- 저장소(IndexedDB: BOM 데이터 / localStorage: 이력) ----------
const IDB = {
  open() {
    return new Promise((ok, no) => {
      const r = indexedDB.open('RTX_WOC', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
    });
  },
  async get(k) {
    const db = await this.open();
    return new Promise((ok, no) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); });
  },
  async set(k, v) {
    const db = await this.open();
    return new Promise((ok, no) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = ok; tx.onerror = () => no(tx.error); });
  },
};
const HKEY = 'RTX_WOC_HISTORY';
const hist = {
  all() { try { return JSON.parse(localStorage.getItem(HKEY) || '[]'); } catch { return []; } },
  add(rec) {
    const a = [rec, ...this.all()].slice(0, 300);
    try { localStorage.setItem(HKEY, JSON.stringify(a)); } catch { toast('이력 저장 불가 — 브라우저 저장 공간 확인'); }
  },
};

// ---------- BOM 데이터 ----------
async function decodeDb(buf) {
  const b = new Uint8Array(buf);
  let text;
  if (b[0] === 0x1f && b[1] === 0x8b) {
    if (!('DecompressionStream' in window)) throw new Error('이 브라우저는 .gz를 못 엽니다 — bom_db.json 파일을 쓰세요');
    text = await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  } else text = new TextDecoder().decode(b);
  const db = JSON.parse(text);
  if (!db.meta || !db.orders || !db.names || db.meta.schema !== 1) throw new Error('BOM 데이터 형식이 아닙니다');
  return db;
}
function setDb(db) {
  state.idx = makeIndex(db);
  renderDbInfo();
}
async function initDb() {
  try {
    const buf = await IDB.get('bomdb');
    if (buf) setDb(await decodeDb(buf));
  } catch (e) { console.warn(e); }
  // 사내 서버에 data/bom_db.json.gz를 함께 올린 경우 자동 갱신
  try {
    const r = await fetch('data/bom_db.json.gz', { cache: 'no-cache' });
    if (r.ok) {
      const buf = await r.arrayBuffer();
      const db = await decodeDb(buf);
      if (!state.idx || state.idx.db.meta.built !== db.meta.built) { setDb(db); await IDB.set('bomdb', buf); }
    }
  } catch { /* 파일 없음 — 수동 불러오기 사용 */ }
  renderDbInfo();
}
function renderDbInfo() {
  const b = $('#dbBadge'), info = $('#dbInfo');
  $('#btnScan').disabled = !state.idx;
  if (!state.idx) { b.className = 'badge warn'; b.textContent = 'BOM 데이터 없음'; info.textContent = '불러온 BOM 데이터가 없습니다. [BOM 데이터 불러오기]로 bom_db.json.gz 파일을 선택하세요.'; return; }
  const m = state.idx.db.meta;
  const days = Math.floor((Date.now() - new Date(m.bomDate).getTime()) / 864e5);
  b.className = days > 14 ? 'badge warn' : 'badge ok';
  b.textContent = `BOM ${m.bomDate.slice(2).replace(/-/g, '.')} 기준`;
  info.innerHTML = `SAP BOM <b>${esc(m.bomDate)}</b> 추출본 · 품번 ${m.products.toLocaleString()}개 · 미결 BOM 이슈 ${m.openIssues}건<br>` +
    `<span class="muted">데이터 생성 ${esc(m.built)}${days > 14 ? ` · <b style="color:var(--wT)">${days}일 지남 — 최신 추출본으로 갱신 필요</b>` : ''}</span>`;
}
$('#dbFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const buf = await f.arrayBuffer();
    const db = await decodeDb(buf);
    await IDB.set('bomdb', buf);
    setDb(db);
    toast(`BOM 데이터 적용 — ${db.meta.bomDate} 기준`);
  } catch (err) { toast(err.message || 'BOM 데이터를 열 수 없습니다', 4000); }
});

// ---------- 카메라 ----------
const video = $('#video'), guide = $('#guide');
let stream = null, loopT = null, prevGray = null, stableMs = 0, lastTick = 0, capturing = false;

async function openCamera() {
  if (!state.idx) return toast('먼저 BOM 데이터를 불러오세요');
  if (!navigator.mediaDevices?.getUserMedia) return toast('이 브라우저는 카메라를 지원하지 않습니다 — [사진 선택]을 쓰세요', 4000);
  show('camera');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } } });
  } catch {
    show('home');
    return toast('카메라를 열 수 없습니다 — 권한을 허용하거나 [사진 선택]을 쓰세요', 4000);
  }
  video.srcObject = stream;
  await video.play().catch(() => {});
  const track = stream.getVideoTracks()[0];
  try {
    const caps = track.getCapabilities?.() || {};
    if (caps.focusMode?.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
  } catch { /* 초점 제어 미지원 기기 */ }
  layoutGuide();
  capturing = false; prevGray = null; stableMs = 0; lastTick = performance.now();
  loopT = setTimeout(tick, 400);
}
function closeCamera() {
  clearTimeout(loopT); loopT = null;
  stream?.getTracks().forEach((t) => t.stop()); stream = null;
}
function layoutGuide() {
  const W = innerWidth, H = innerHeight, land = W > H;
  // 세로 화면: 위 안내·아래 버튼 / 가로 화면: 오른쪽 버튼 열(촬영 칸을 최대한 크게)
  const box = land ? { x: 10, y: 44, w: W - 130, h: H - 54 } : { x: 0, y: 96, w: W, h: H - 226 };
  const ar = state.guide === 'land' ? 297 / 210 : 210 / 297;
  let w = box.w * 0.96, h = w / ar;
  if (h > box.h * 0.96) { h = box.h * 0.96; w = h * ar; }
  Object.assign(guide.style, { left: `${box.x + (box.w - w) / 2}px`, top: `${box.y + (box.h - h) / 2}px`, width: `${w}px`, height: `${h}px` });
  $('#btnRotate').textContent = state.guide === 'land' ? '▯ 세로칸' : '▭ 가로칸';
  $('#camSub').textContent = state.guide === 'land' && H > W ? '폰을 가로로 돌리면 글자가 더 정확히 읽힙니다' : '';
}
addEventListener('resize', () => { if (stream) layoutGuide(); });

// 화면의 가이드 네모 → 영상 픽셀 좌표(object-fit: cover 보정)
function guideRect() {
  const vw = video.videoWidth, vh = video.videoHeight;
  const r = video.getBoundingClientRect(), g = guide.getBoundingClientRect();
  const s = Math.max(r.width / vw, r.height / vh);
  const ox = r.left + (r.width - vw * s) / 2, oy = r.top + (r.height - vh * s) / 2;
  return { x: (g.left - ox) / s, y: (g.top - oy) / s, w: g.width / s, h: g.height / s, vw, vh };
}

// 프레임 상태: 밝기(종이) · 글자 밀도 · 흔들림 · 가장자리 여백(종이가 칸을 채웠는지)
const probe = document.createElement('canvas');
function frameStats() {
  const g = guideRect();
  const SW = 160, SH = Math.max(40, Math.round((SW * g.h) / g.w));
  probe.width = SW; probe.height = SH;
  const c = probe.getContext('2d', { willReadFrequently: true });
  c.drawImage(video, g.x, g.y, g.w, g.h, 0, 0, SW, SH);
  const d = c.getImageData(0, 0, SW, SH).data, n = SW * SH, gray = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) { gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; sum += gray[i]; }
  let edges = 0, bandSum = 0, bandN = 0, bandEdges = 0, diff = 0;
  const bx = Math.round(SW * 0.04), by = Math.round(SH * 0.04);
  for (let y = 1; y < SH - 1; y++) for (let x = 1; x < SW - 1; x++) {
    const i = y * SW + x;
    const m = Math.abs(gray[i + 1] - gray[i - 1]) + Math.abs(gray[i + SW] - gray[i - SW]);
    const e = m > 60 ? 1 : 0;
    edges += e;
    if (x <= bx || x >= SW - 1 - bx || y <= by || y >= SH - 1 - by) { bandSum += gray[i]; bandN++; bandEdges += e; }
  }
  if (prevGray && prevGray.length === n) { for (let i = 0; i < n; i++) diff += Math.abs(gray[i] - prevGray[i]); diff /= n; } else diff = 99;
  prevGray = gray;
  return { mean: sum / n, edge: edges / n, motion: diff, band: bandSum / Math.max(1, bandN), bandEdge: bandEdges / Math.max(1, bandN) };
}

function tick() {
  if (!stream || capturing) return;
  const now = performance.now(), dt = now - lastTick; lastTick = now;
  if (video.readyState >= 2 && video.videoWidth) {
    const s = frameStats();
    const hint = $('#camHint');
    let msg = '', ok = false, need = 900;
    if (s.mean < 80) msg = '너무 어둡습니다 — 밝은 곳에서 찍어 주세요';
    else if (s.edge < 0.015) msg = '작지를 네모칸 안에 넣어 주세요';
    else if (s.motion > 5) msg = '흔들림 없이 잠시 멈춰 주세요';
    else {
      ok = true;
      const filled = s.band > 140 && s.bandEdge < 0.12;     // 칸 가장자리가 종이 여백 = 작지가 칸을 채움
      need = filled ? 800 : 1800;
      msg = filled ? '그대로 유지 — 자동 촬영' : '칸에 맞추는 중… 그대로 두면 자동 촬영';
    }
    stableMs = ok ? stableMs + dt : 0;
    hint.textContent = msg; hint.classList.toggle('warn', !ok);
    guide.classList.toggle('ready', ok);
    $('#guideBar').style.width = `${Math.min(100, (stableMs / need) * 100)}%`;
    if (ok && stableMs >= need) return capture();
  }
  loopT = setTimeout(tick, 160);
}

function grabGuide() {
  const g = guideRect();
  const mx = g.w * 0.03, my = g.h * 0.03;
  const x = Math.max(0, g.x - mx), y = Math.max(0, g.y - my);
  const w = Math.min(g.vw - x, g.w + 2 * mx), h = Math.min(g.vh - y, g.h + 2 * my);
  const cv = document.createElement('canvas');
  cv.width = Math.round(w); cv.height = Math.round(h);
  cv.getContext('2d').drawImage(video, x, y, w, h, 0, 0, cv.width, cv.height);
  return cv;
}
async function capture() {
  if (capturing || !stream) return;
  capturing = true;
  clearTimeout(loopT);
  const f = $('#flash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
  navigator.vibrate?.(60);
  const cv = grabGuide();
  closeCamera();
  await analyze(paperCrop(cv), true);
}

$('#btnScan').addEventListener('click', openCamera);
$('#btnShutter').addEventListener('click', capture);
$('#btnCamClose').addEventListener('click', () => { closeCamera(); show('home'); });
$('#btnRotate').addEventListener('click', () => { state.guide = state.guide === 'land' ? 'port' : 'land'; layoutGuide(); stableMs = 0; });

// 사진 선택(폰 기본 카메라·갤러리 — 고해상도)
$('#photoFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  if (!state.idx) return toast('먼저 BOM 데이터를 불러오세요');
  try {
    const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
    const s = Math.min(1, 3200 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    await analyze(paperCrop(cv), false);
  } catch (err) { console.error(err); toast('사진을 열 수 없습니다'); }
});

// 사진에서 종이(밝은 영역)만 잘라 해상도 확보 — 못 찾으면 원본 그대로
function paperCrop(src) {
  const S = 256, k = S / Math.max(src.width, src.height);
  const w = Math.max(16, Math.round(src.width * k)), h = Math.max(16, Math.round(src.height * k));
  const sm = document.createElement('canvas'); sm.width = w; sm.height = h;
  const c = sm.getContext('2d', { willReadFrequently: true });
  c.drawImage(src, 0, 0, w, h);
  const d = c.getImageData(0, 0, w, h).data, g = new Uint8Array(w * h), hg = new Float64Array(256);
  for (let i = 0; i < w * h; i++) { g[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) | 0; hg[g[i]]++; }
  let sum = 0, sumB = 0, wB = 0, best = 0, t = 128;            // 오츠 임계값
  for (let i = 0; i < 256; i++) sum += i * hg[i];
  for (let i = 0; i < 256; i++) {
    wB += hg[i]; if (!wB) continue;
    const wF = w * h - wB; if (!wF) break;
    sumB += i * hg[i];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) { best = between; t = i; }
  }
  const span = (a, th) => { const i0 = a.findIndex((v) => v > th); return [i0, a.length - 1 - [...a].reverse().findIndex((v) => v > th)]; };
  const rows = [];
  for (let y = 0; y < h; y++) { let r = 0; for (let x = 0; x < w; x++) if (g[y * w + x] > t) r++; rows.push(r / w); }
  const [y0, y1] = span(rows, 0.35);
  if (y0 < 0) return src;
  const cols = [];                                             // 열은 종이 행 범위 안에서만 셈
  for (let x = 0; x < w; x++) { let n = 0; for (let y = y0; y <= y1; y++) if (g[y * w + x] > t) n++; cols.push(n / (y1 - y0 + 1)); }
  const [x0, x1] = span(cols, 0.5);
  if (x0 < 0) return src;
  const area = ((x1 - x0 + 1) * (y1 - y0 + 1)) / (w * h);
  if (area < 0.12 || area > 0.9) return src;
  const m = 0.03 * Math.max(x1 - x0, y1 - y0);
  const X0 = Math.max(0, (x0 - m) / k), Y0 = Math.max(0, (y0 - m) / k);
  const X1 = Math.min(src.width, (x1 + 1 + m) / k), Y1 = Math.min(src.height, (y1 + 1 + m) / k);
  const cv = document.createElement('canvas');
  cv.width = Math.round(X1 - X0); cv.height = Math.round(Y1 - Y0);
  cv.getContext('2d').drawImage(src, X0, Y0, X1 - X0, Y1 - Y0, 0, 0, cv.width, cv.height);
  return cv;
}

// ---------- OCR ----------
let worker = null, onProg = null;
async function getWorker() {
  if (worker) return worker;
  if (!window.Tesseract) throw new Error('글자 인식 엔진을 불러오지 못했습니다');
  const base = new URL('vendor/tesseract/', location.href).href;
  worker = await Tesseract.createWorker('eng', 1, {
    workerPath: base + 'worker.min.js', corePath: base, langPath: base, gzip: true,
    logger: (m) => onProg?.(m),
  });
  await worker.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' });
  return worker;
}
function setBusy(text, p) {
  if (text) $('#busyText').textContent = text;
  if (p !== undefined) $('#busyBar').style.width = `${Math.round(p * 100)}%`;
}

// 회색조 → 조명 보정(종이 밝기로 나눔: 그림자·조명 얼룩 제거) → 명암 늘이기, 긴 변 2400px 근처로 맞춤
function prepForOcr(src, rot = 0, target = 2400) {
  const sw = src.width, sh = src.height;
  const s = Math.max(0.5, Math.min(3.4, target / Math.max(sw, sh)));
  const w = Math.round(sw * s), h = Math.round(sh * s);
  const cv = document.createElement('canvas');
  const swap = rot % 180 !== 0;
  cv.width = swap ? h : w; cv.height = swap ? w : h;
  const c = cv.getContext('2d', { willReadFrequently: true });
  c.imageSmoothingQuality = 'high';
  c.translate(cv.width / 2, cv.height / 2); c.rotate((rot * Math.PI) / 180);
  c.drawImage(src, -w / 2, -h / 2, w, h);
  const W = cv.width, H = cv.height;
  const img = c.getImageData(0, 0, W, H), d = img.data, n = W * H;
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  // 배경(종이) 밝기: 블록 평균 → 3x3 최댓값 2회(글자 제외) → 쌍선형 보간
  const B = Math.max(16, Math.ceil(Math.max(W, H) / 40)), bw = Math.ceil(W / B), bh = Math.ceil(H / B);
  let bg = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let sum = 0, cnt = 0;
    for (let y = by * B; y < Math.min(H, by * B + B); y += 2) for (let x = bx * B; x < Math.min(W, bx * B + B); x += 2) { sum += g[y * W + x]; cnt++; }
    bg[by * bw + bx] = sum / cnt;
  }
  for (let pass = 0; pass < 2; pass++) {
    const nb = new Float32Array(bg.length);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < bh && xx >= 0 && xx < bw) m = Math.max(m, bg[yy * bw + xx]);
      }
      nb[y * bw + x] = m;
    }
    bg = nb;
  }
  const hg = new Uint32Array(256);
  for (let y = 0; y < H; y++) {
    const fy = Math.min(bh - 1.001, Math.max(0, y / B - 0.5)), y0 = fy | 0, ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(bw - 1.001, Math.max(0, x / B - 0.5)), x0 = fx | 0, tx = fx - x0;
      const i0 = y0 * bw + x0, i1 = Math.min(bh - 1, y0 + 1) * bw + x0, xr = x0 + 1 < bw ? 1 : 0;
      const b = (bg[i0] * (1 - tx) + bg[i0 + xr] * tx) * (1 - ty) + (bg[i1] * (1 - tx) + bg[i1 + xr] * tx) * ty;
      const v = Math.min(255, (g[y * W + x] / Math.max(24, b)) * 245) | 0;
      g[y * W + x] = v; hg[v]++;
    }
  }
  let lo = 0, acc = 0;
  for (; lo < 255; lo++) { acc += hg[lo]; if (acc > n * 0.005) break; }
  const k = 255 / Math.max(40, 240 - lo);
  for (let i = 0; i < n; i++) { const v = Math.max(0, Math.min(255, (g[i] - lo) * k)); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.putImageData(img, 0, 0);
  return { canvas: cv, scale: s, rot };
}

// OCR 좌표(전처리 이미지) → 원본 사진 좌표
function mapBox(b, prep, src) {
  const s = prep.scale, W = src.width, H = src.height;
  const pts = [[b.x0, b.y0], [b.x1, b.y1]].map(([x, y]) => {
    if (prep.rot === 90) return [y / s, H - x / s];
    if (prep.rot === 270) return [W - y / s, x / s];
    return [x / s, y / s];
  });
  return { x0: Math.min(pts[0][0], pts[1][0]), y0: Math.min(pts[0][1], pts[1][1]), x1: Math.max(pts[0][0], pts[1][0]), y1: Math.max(pts[0][1], pts[1][1]) };
}

async function ocr(src, rot, params = null, target = 2400) {
  const prep = prepForOcr(src, rot, target);
  const w = await getWorker();
  if (params) await w.setParameters(params);
  try {
    const { data } = await w.recognize(prep.canvas);
    const words = (data.words || []).filter((x) => x.text.trim()).map((x) => ({ text: x.text, conf: x.confidence, b: mapBox(x.bbox, prep, src) }));
    const numWords = [];
    for (const wd of words) for (const n of extractNums(wd.text)) numWords.push({ num: n, b: wd.b, conf: wd.conf });
    return { words, numWords, nums: numWords.map((x) => x.num), text: data.text || '' };
  } finally {
    if (params) await w.setParameters({ tessedit_pageseg_mode: '11', thresholding_method: '0' });
  }
}
// 2차 인식 결과 합치기 — 같은 번호가 같은 자리에 겹치면 하나만 남김
function mergeOcr(a, b) {
  const near = (p, q) => Math.abs(p.y0 - q.y0) < (p.y1 - p.y0) && Math.abs(p.x0 - q.x0) < (p.y1 - p.y0) * 2;
  const numWords = [...a.numWords, ...b.numWords.filter((x) => !a.numWords.some((y) => y.num === x.num && near(x.b, y.b)))];
  return { words: [...a.words, ...b.words.filter((x) => !a.words.some((y) => near(x.b, y.b)))], numWords,
    nums: numWords.map((x) => x.num), text: `${a.text}\n${b.text}` };
}
// 현재 BOM 1레벨 구성품 중 작지에서 못 읽은 개수
function unread(order, nums) {
  const s = new Set(nums);
  return treeOf(state.idx, order).filter((t) => t.level === 1 && !s.has(t.num)).length;
}

async function analyze(src, fromCamera) {
  show('busy'); setBusy('글자 인식 엔진 준비 중…', 0.05);
  onProg = (m) => {
    if (m.status === 'recognizing text') setBusy('작지 글자 읽는 중…', 0.3 + m.progress * 0.65);
    else if (/loading|initializ/.test(m.status)) setBusy('글자 인식 엔진 준비 중…', 0.05 + (m.progress || 0) * 0.25);
  };
  try {
    let o = null, order = null, rot = 0;
    for (rot of [0, 90, 270]) {                   // 가로·세로가 바뀐 사진 대비
      if (rot) setBusy(`방향 바꿔 다시 읽는 중(${rot}°)…`);
      o = await ocr(src, rot);
      order = pickOrder(state.idx, o.nums);
      if (order) break;
    }
    if (order && unread(order, o.nums) > 0) {     // 덜 읽힌 구성품 → 다른 이진화(Sauvola)로 한 번 더 읽어 합침
      setBusy('못 읽은 구성품 다시 읽는 중…', 0.3);
      o = mergeOcr(o, await ocr(src, rot, { thresholding_method: '2' }));
      order = pickOrder(state.idx, o.nums) || order;
    }
    if (order && unread(order, o.nums) > 0 && Math.max(src.width, src.height) < 1800) {   // 저해상도 → 크게 키워 3차
      setBusy('작은 글자 크게 키워 다시 읽는 중…', 0.3);
      o = mergeOcr(o, await ocr(src, rot, null, 3400));
    }
    state.last = { src, ...o };
    state.bomOnly = false;
    if (!order) {
      show(fromCamera ? 'camera' : 'home');
      if (fromCamera) { await openCamera(); toast('작지 품번을 못 읽었습니다 — 더 가까이, 밝게 다시 맞춰 주세요', 3500); }
      else { toast('작지 품번을 못 읽었습니다 — [품번 입력]으로 직접 넣을 수 있습니다', 4000); openManual(true); }
      return;
    }
    runEval(order);
  } catch (err) {
    console.error(err);
    show('home');
    toast(`분석 실패: ${err.message || err}`, 4500);
  }
}

// ---------- 판정 ----------
function runEval(order) {
  const idx = state.idx;
  let res;
  if (state.bomOnly || !state.last) {
    const kids = treeOf(idx, order).filter((t) => t.level === 1).map((t) => t.num);
    res = evaluate(idx, order, kids);
    state.bomOnly = true;
  } else res = evaluate(idx, order, state.last.nums, state.last.text);
  state.result = res;
  const reds = [...res.items.values()].filter((i) => i.status === 'red');
  const yels = [...res.items.values()].filter((i) => i.status === 'yellow');
  if (!state.bomOnly) drawAnnotated(res, reds, yels);
  renderResult(res, reds, yels);
  hist.add({ t: stamp(), order, desc: res.desc, verdict: res.verdict, red: reds.length, yellow: yels.length + res.missing.length,
    mode: state.bomOnly ? 'BOM 자체' : '작지 대조',
    why: [...reds.flatMap((i) => i.reasons.filter((r) => r.sev === '상' || r.sev === '치명').map((r) => `${i.num} ${r.rule}`)),
      ...res.orderNotes.filter((r) => r.sev === '상' || r.sev === '치명').map((r) => r.rule)].slice(0, 4).join(' / ') });
  renderHistory();
  show('result');
}

// ---------- 결과 이미지(빨간 줄) ----------
// 번호 칸에서 좌우로 같은 행 글자를 이어 찾음(작지가 기울어도 행을 따라감)
function rowExtent(b, words) {
  const h = b.y1 - b.y0, cy = (q) => (q.y0 + q.y1) / 2;
  const cand = words.map((w) => w.b).filter((q) => { const wh = q.y1 - q.y0; return wh < h * 2.2 && wh > h * 0.4; });
  let left = b, right = b;
  const seen = new Set([b]);
  const slope = () => (right === left ? 0 : (cy(right) - cy(left)) / Math.max(1, (right.x0 + right.x1) / 2 - (left.x0 + left.x1) / 2));
  for (let dir of [1, -1]) {
    for (;;) {
      const edge = dir > 0 ? right : left, ex = dir > 0 ? edge.x1 : edge.x0;
      let best = null;
      for (const q of cand) {
        if (seen.has(q)) continue;
        const gap = dir > 0 ? q.x0 - ex : ex - q.x1;
        if (gap < -h * 0.2 || gap > h * 40) continue;
        const qx = (q.x0 + q.x1) / 2, pred = cy(edge) + slope() * (qx - (edge.x0 + edge.x1) / 2);
        if (Math.abs(cy(q) - pred) > h * 0.55) continue;
        if (!best || gap < (dir > 0 ? best.x0 - ex : ex - best.x1)) best = q;
      }
      if (!best) break;
      seen.add(best);
      if (dir > 0) right = best; else left = best;
    }
  }
  return { x0: left.x0, x1: right.x1, yl: cy(left), yr: cy(right), y0: b.y0, y1: b.y1, h };
}

function drawAnnotated(res, reds, yels) {
  const { src, numWords, words } = state.last;
  const out = $('#out');
  const W = src.width, bh = Math.round(Math.max(56, W * 0.075)), unit = Math.max(2, W / 600);
  out.width = W; out.height = src.height + bh;
  const c = out.getContext('2d');
  // 판정 머리띠(사진 위에 별도 띠 — 작지 내용을 가리지 않음)
  const [title] = VERDICT[res.verdict];
  const col = res.verdict === 'OK' ? [COLOR.okB, COLOR.ok, COLOR.okT] : res.verdict === 'CHECK' ? [COLOR.yelB, COLOR.yel, COLOR.yelT] : [COLOR.redB, COLOR.red, COLOR.redT];
  c.fillStyle = col[0]; c.fillRect(0, 0, W, bh);
  c.fillStyle = col[1]; c.fillRect(0, bh - Math.max(3, bh * 0.07), W, Math.max(3, bh * 0.07));
  c.fillStyle = col[2]; c.textBaseline = 'middle'; c.textAlign = 'left';
  const icon = res.verdict === 'OK' ? '✔' : res.verdict === 'CHECK' ? '!' : '✖';
  let fs = bh * 0.5;
  c.font = `900 ${fs}px sans-serif`;
  const tw = c.measureText(`${icon} ${title}`).width;
  c.fillText(`${icon} ${title}`, bh * 0.3, bh * 0.47);
  const info = [`작지 ${res.order} · 빨간 줄 ${reds.length}건 · 확인 ${yels.length + res.missing.length}건`, `BOM ${res.bomDate} 기준 · ${stamp()}`];
  const room = W - tw - bh * 0.9;
  fs = Math.min(bh * 0.26, room / Math.max(...info.map((s) => s.length)) * 1.6);
  c.font = `700 ${fs}px sans-serif`; c.textAlign = 'right';
  c.fillText(info[0], W - bh * 0.3, bh * 0.32); c.fillText(info[1], W - bh * 0.3, bh * 0.66);
  c.translate(0, bh);
  c.drawImage(src, 0, 0);
  const boxesOf = (it) => numWords.filter((n) => n.num === it.num || (it.ocrFix && n.num === it.ocrFix)).map((n) => n.b);

  const marker = (x, y, r, label, fill, stroke, ink) => {
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = fill; c.fill();
    c.lineWidth = Math.max(2, r * 0.16); c.strokeStyle = stroke; c.stroke();
    c.fillStyle = ink; c.font = `800 ${Math.round(r * 1.2)}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(label, x, y + r * 0.05);
  };
  // 작지 품번 표시
  for (const n of numWords.filter((x) => x.num === res.order)) {
    const b = n.b, p = (b.y1 - b.y0) * 0.25;
    c.lineWidth = unit * 1.5; c.strokeStyle = COLOR.navy; c.setLineDash([unit * 4, unit * 2]);
    c.strokeRect(b.x0 - p, b.y0 - p, b.x1 - b.x0 + 2 * p, b.y1 - b.y0 + 2 * p); c.setLineDash([]);
  }
  // 빨간 줄: 틀린 항목 행 전체를 긋고 번호 표시
  reds.forEach((it, i) => {
    for (const b of boxesOf(it)) {
      const r = rowExtent(b, words), y = (r.y0 + r.y1) / 2, m = r.h * 0.6;
      const k = (r.yr - r.yl) / Math.max(1, r.x1 - r.x0), ya = r.yl - k * m, yb = r.yr + k * m;
      c.strokeStyle = COLOR.red; c.lineCap = 'round';
      c.globalAlpha = 0.16; c.lineWidth = r.h * 1.7;
      c.beginPath(); c.moveTo(r.x0 - m, ya); c.lineTo(r.x1 + m, yb); c.stroke(); c.globalAlpha = 1;
      c.lineWidth = Math.max(unit * 1.6, r.h * 0.16);
      c.beginPath(); c.moveTo(r.x0 - m, ya); c.lineTo(r.x1 + m, yb); c.stroke();
      c.lineWidth = Math.max(unit, r.h * 0.1);
      c.strokeRect(b.x0 - r.h * 0.2, b.y0 - r.h * 0.25, b.x1 - b.x0 + r.h * 0.4, r.h * 1.5);
      const mr = r.h * 0.85, mx = r.x1 + m + mr * 1.3 < W ? r.x1 + m + mr * 1.2 : Math.max(mr, r.x0 - m - mr * 1.2);
      marker(mx, mx > r.x1 ? yb : ya, mr, String(i + 1), COLOR.redB, COLOR.red, COLOR.redT);
    }
  });
  // 노란 표시: 밑줄 + 느낌표
  yels.forEach((it) => {
    for (const b of boxesOf(it)) {
      const r = rowExtent(b, words), m = r.h * 0.4;
      c.strokeStyle = COLOR.yel; c.lineWidth = Math.max(unit * 1.2, r.h * 0.12);
      c.beginPath(); c.moveTo(r.x0 - m, r.yl + r.h * 0.75); c.lineTo(r.x1 + m, r.yr + r.h * 0.75); c.stroke();
      marker(Math.max(r.h, r.x0 - m - r.h * 0.9), r.yl, r.h * 0.7, '!', COLOR.yelB, COLOR.yel, COLOR.yelT);
    }
  });
  c.setTransform(1, 0, 0, 1, 0, 0);
}

// ---------- 결과 화면 ----------
// 지적 1건: 요지 한 줄 + 감사 근거(교차검증·대상)는 접기
function reasonHtml(r) {
  const cls = r.sev === '상' || r.sev === '치명' ? 'red' : r.sev === '참고' ? 'info' : 'yellow';
  const [head, ...rest] = String(r.msg).split(' | ');
  const ledger = r.inLedger ? ' <span class="tag info">전수 감사 미결 대장 등재</span>' : '';
  const more = rest.length ? `<details class="ev"><summary>근거</summary>${rest.map((x) => `<div>${esc(x)}</div>`).join('')}</details>` : '';
  return `<div class="why"><span class="tag ${cls}">${esc(r.sev)} · ${esc(r.rule)}</span>${esc(head)}${ledger}${more}</div>`;
}
function li(it, i, kind) {
  const rs = it.reasons.length ? it.reasons : [];
  const mk = kind === 'red' ? `<span class="mk">${i + 1}</span>` : kind === 'yellow' ? '<span class="mk y">!</span>' : '';
  const why = rs.map(reasonHtml).join('');
  const fix = it.ocrFix ? `<div class="why"><span class="tag info">OCR 보정</span>작지에서 ${esc(it.ocrFix)}로 읽힘(마스터에 없는 번호) → ${esc(it.num)}로 대조</div>` : '';
  const q = it.qty != null ? ` · BOM ${it.qty} ${esc(it.uom || '')}` : '';
  const pos = kind === 'red' && !it.onSheet && !state.bomOnly ? ' <span class="tag info">작지에서 줄 위치 못 찾음</span>' : '';
  return `<li>${mk}<span class="num">${esc(it.num)}</span>${pos}${it.level > 1 ? ` <span class="tag info">Lv${it.level}</span>` : ''}<div class="nm">${esc(it.name || '품명 없음')}${q}</div>${why}${fix}</li>`;
}
function renderResult(res, reds, yels) {
  const [title, sub] = VERDICT[res.verdict];
  const v = $('#verdict');
  v.className = `verdict ${res.verdict}`;
  const counts = res.verdict === 'UNKNOWN' ? '' : ` · 빨간 줄 ${reds.length}건 · 확인 ${yels.length + res.missing.length}건`;
  v.innerHTML = `${state.bomOnly ? '' : res.verdict === 'OK' ? '✔ ' : res.verdict === 'CHECK' ? '⚠ ' : '✖ '}${title}<small>${esc(sub)}${counts}${state.bomOnly ? ' · 작지 대조 없음(BOM 자체 검증)' : ''}</small>`;
  $('#imgWrap').style.display = state.bomOnly ? 'none' : '';
  $('.imgTools').style.display = state.bomOnly ? 'none' : '';
  $('#btnSave').style.display = state.bomOnly ? 'none' : '';
  $('.actions').style.gridTemplateColumns = state.bomOnly ? '1fr 1fr' : '';

  const read = [...res.items.values()].filter((i) => i.onSheet && !i.extra).length;
  const direct = [...res.items.values()].filter((i) => !i.extra).length;
  const ds = res.descScore;
  const descTxt = ds == null ? '—' : ds >= 0.8 ? `일치(${Math.round(ds * 100)}%)` : `<b style="color:var(--wT)">확인 필요(${Math.round(ds * 100)}%) — 작지 품명과 SAP 품명이 같은지 육안 확인</b>`;
  let h = `<div class="card"><h2>1) 작지 — ${esc(res.order)}</h2><div class="kv">
    <b>품명(SAP)</b><span>${esc(res.desc || '—')}</span>
    ${state.bomOnly ? '' : `<b>품명 판독</b><span>${descTxt}</span><b>구성품 인식</b><span>현재 BOM ${direct}개 중 ${read}개</span>`}
    <b>제품군</b><span>${esc(res.family || '—')}${res.role && res.role !== 'FG' ? ` · 하위 작지(${esc(res.role)})` : ''}</span>
    <b>BOM 기준</b><span>${esc(res.bomDate)} SAP 추출본</span></div></div>`;

  const notesHard = res.orderNotes.filter((r) => r.sev !== '참고');
  if (reds.length || notesHard.some((r) => r.sev === '상' || r.sev === '치명')) {
    h += `<div class="card"><h2>2) 빨간 줄 — 분출 전 수정</h2><ul class="list">${reds.map((it, i) => li(it, i, 'red')).join('')}`;
    h += notesHard.filter((r) => r.sev === '상' || r.sev === '치명').map((r) => `<li>${reasonHtml(r)}</li>`).join('');
    h += '</ul></div>';
  }
  const yNotes = notesHard.filter((r) => r.sev !== '상' && r.sev !== '치명');
  if (yels.length || yNotes.length) {
    h += `<div class="card"><h2>3) 확인 필요</h2><ul class="list">${yels.map((it, i) => li(it, i, 'yellow')).join('')}`;
    h += yNotes.map((r) => `<li>${reasonHtml(r)}</li>`).join('');
    h += '</ul></div>';
  }
  const fixes = [...res.items.values()].filter((i) => i.ocrFix && i.status === 'ok');
  if (fixes.length) h += `<div class="card"><h2>참고 — 번호 1자리 보정 ${fixes.length}건</h2><ul class="list">${fixes.map((it) => li(it, 0, '')).join('')}</ul></div>`;
  if (res.missing.length && !state.bomOnly) {
    h += `<div class="card"><h2>4) 작지에서 못 읽은 BOM 구성품 <span class="muted">육안 확인</span></h2><ul class="list">${res.missing.map((it) => li({ ...it, reasons: [] }, 0, '')).join('')}</ul></div>`;
  }
  if (res.known) {
    const rows = treeOf(state.idx, res.order).filter((t) => t.level === 1).map((t) => {
      const it = res.items.get(t.num) || {};
      const mark = state.bomOnly ? '' : it.onSheet ? '✔' : '–';
      const st = it.status === 'red' ? ' style="color:var(--bT);font-weight:700"' : it.status === 'yellow' ? ' style="color:var(--wT)"' : '';
      return `<tr${st}><td>${esc(t.num)}</td><td>${esc(nameOf(state.idx, t.num))}${t.sub ? ` <span class="tag info">${esc(t.sub)}</span>` : ''}</td><td class="c">${t.qty ?? '미추출'} ${esc(t.uom || '')}</td>${state.bomOnly ? '' : `<td class="c">${mark}</td>`}</tr>`;
    }).join('');
    const info = res.orderNotes.filter((r) => r.sev === '참고').map((r) => `<p class="muted">참고 · ${esc(r.rule)}: ${esc(r.msg)}</p>`).join('');
    h += `<div class="card"><details><summary>현재 BOM 구성품 (1레벨 ${direct}개)</summary>
      <table class="bom"><tr><th>품번</th><th>품명</th><th>수량</th>${state.bomOnly ? '' : '<th>작지</th>'}</tr>${rows}</table>${info}</details></div>`;
  }
  $('#detail').innerHTML = h;
  $('#imgWrap').classList.remove('zoom');
}

$('#btnZoom').addEventListener('click', () => $('#imgWrap').classList.toggle('zoom'));
$('#btnAgain').addEventListener('click', openCamera);
$('#btnSave').addEventListener('click', async () => {
  if (state.bomOnly) return toast('작지 사진이 없는 검증입니다');
  const r = state.result;
  const name = `WOcheck_${r.order}_${stamp().replace(/[-: ]/g, '').slice(0, 12)}.jpg`;
  const blob = await new Promise((ok) => $('#out').toBlob(ok, 'image/jpeg', 0.88));
  const file = new File([blob], name, { type: 'image/jpeg' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  saveBlob(blob, name);
});
function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ---------- 품번 직접 입력 ----------
const dlg = $('#dlgManual');
function openManual(withPhoto) {
  if (!state.idx) return toast('먼저 BOM 데이터를 불러오세요');
  state.manualWithPhoto = !!withPhoto && !!state.last;
  $('#manualNote').textContent = state.manualWithPhoto ? '찍은 작지의 구성품을 이 품번 BOM과 대조합니다.' : '사진 없이 입력하면 현재 BOM 자체만 검증합니다.';
  $('#inManual').value = state.manualWithPhoto && state.result ? state.result.order : '';
  dlg.showModal();
  setTimeout(() => $('#inManual').focus(), 50);
}
$('#btnManual').addEventListener('click', () => { state.last = null; openManual(false); });
$('#btnFix').addEventListener('click', () => openManual(!state.bomOnly));
$('#btnManualCancel').addEventListener('click', () => dlg.close());
$('#btnManualOk').addEventListener('click', () => {
  const v = $('#inManual').value.replace(/\D/g, '');
  if (!/^1\d{6}$/.test(v)) return toast('7자리 SAP 품번을 넣어 주세요');
  dlg.close();
  state.bomOnly = !state.manualWithPhoto;
  if (state.bomOnly) state.last = null;
  runEval(v);
});
$('#inManual').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnManualOk').click(); });

// ---------- 이력·엑셀 ----------
function renderHistory() {
  const a = hist.all();
  $('#history').innerHTML = a.length ? a.slice(0, 15).map((r) => `<li><span class="pill ${r.verdict}">${VERDICT[r.verdict][0]}</span>
    <span><b>${esc(r.order)}</b> ${esc((r.desc || '').slice(0, 34))}</span><span class="muted">${esc(r.mode === 'BOM 자체' ? 'BOM' : '작지')}</span>
    <span class="t">${esc(r.t)}${r.why ? ' · ' + esc(r.why) : ''}</span></li>`).join('') : '<li class="muted">검증 이력이 없습니다.</li>';
}
$('#btnXlsx').addEventListener('click', () => {
  const a = hist.all();
  if (!a.length) return toast('내보낼 이력이 없습니다');
  if (!window.XLSX) return toast('엑셀 모듈을 불러오지 못했습니다');
  const period = `${a[a.length - 1].t.slice(0, 10)}~${a[0].t.slice(0, 10)}`;
  const cnt = (v) => a.filter((r) => r.verdict === v).length;
  const sum = [['작지 BOM 검증 이력 요약'], ['기간', period], ['BOM 기준', state.idx?.db.meta.bomDate || '—'], [],
    ['판정', '건수'], ['분출 가능', cnt('OK')], ['확인 후 분출', cnt('CHECK')], ['분출 보류', cnt('STOP')], ['판정 불가', cnt('UNKNOWN')], ['합계', a.length]];
  const rows = [['일시', '작지 품번', '품명', '판정', '빨간 줄', '확인 필요', '검증 방식', '주요 사유'],
    ...a.map((r) => [r.t, r.order, r.desc, VERDICT[r.verdict][0], r.red, r.yellow, r.mode, r.why || ''])];
  const wb = XLSX.utils.book_new();
  const s1 = XLSX.utils.aoa_to_sheet(sum); s1['!cols'] = [{ wch: 16 }, { wch: 26 }];
  const s2 = XLSX.utils.aoa_to_sheet(rows); s2['!cols'] = [{ wch: 17 }, { wch: 10 }, { wch: 40 }, { wch: 12 }, { wch: 8 }, { wch: 9 }, { wch: 10 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, s1, '요약');
  XLSX.utils.book_append_sheet(wb, s2, '검증 이력');
  const blob = new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  saveBlob(blob, `WOcheck_${a[0].t.slice(0, 10)}.xlsx`);   // 일부 브라우저가 한글 파일명을 download로 바꿔 영문 사용
});

// ---------- 시작 ----------
renderHistory();
initDb();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
window.__woc = { state, runEval, analyze, prepForOcr }; // 테스트용
