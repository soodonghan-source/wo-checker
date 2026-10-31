// 작업지시서 BOM 검증 규칙 — 브라우저·Node 공용 (ES module)
// 기준: 시트 재질·타 모델 시트 규칙 + 스프링 사양 규칙(RX30·31·32 아웃렛 압력↔스프링, RX40 계열 다수결)
//       + 데이터 파일의 미결 BOM 이슈 + 작지 인쇄 구성품 ↔ 현재 BOM 대조

// ---------- 품명 판독 ----------
export const SEAT_MAT = { K: ['PCTFE'], P: ['PVDF'], V: ['VESPEL'], PI: ['VESPEL'], F: ['PFA'], T: ['PTFE'] };
const SEAT_RE = /^(PAS|SEAT|SIEGE)|VALVE SEAT|\/SEAT\/|^ENS TIGE\/M[48]\.1\/|^TETE PNEU\/.*(PCTFE|VESPEL|PVDF|PFA)/;
const REG_SEAT_RE = /^SEAT|\/SEAT|VALVE SEAT|^SUB\/REG\//;
const MAT_KEYS = [['PCTFE', 'PCTFE'], ['VESPEL', 'VESPEL'], ['POLYIMID', 'VESPEL'], ['/PI', 'VESPEL'], ['PVDF', 'PVDF'],
  ['PFA', 'PFA'], ['PEEK', 'PEEK'], ['PTFE', 'PTFE'], ['METAL', 'METAL']];

export function seatMat(name) {
  const u = String(name || '').toUpperCase();
  for (const [k, v] of MAT_KEYS) if (u.includes(k)) return v;
  return null;
}
export const isValveSeat = (n) => SEAT_RE.test(String(n || '').toUpperCase());
export const isRegSeat = (n) => REG_SEAT_RE.test(String(n || '').toUpperCase());

const outBar = (code) => (code === '01' ? 0.7 : /^\d+$/.test(code) ? Number(code) : null);

// 레귤레이터: RX + 타입(2) + 아웃렛(2) + 시트(1) + Cv(3) + 소재·표면 …
export function parseRegulator(desc) {
  const d = String(desc || '');
  const m = d.match(/^RX(\d{2})(\d{2})([A-Z])(\d{3})([A-Z])([A-Z])/);
  if (!m) return null;
  const mm = [...d.matchAll(/[MPS]\d{3}/g)];
  const inlet = mm.length ? mm[mm.length - 1][0].slice(1) : null;
  const tail = mm.length ? d.slice(mm[mm.length - 1].index + 4) : '';
  const opts = tail.match(/PG[0O1]|HF|HT|H|L\d+(?:[.,]\d+)?"?|_\d{3}|[A-Z]+\d*/g) || [];
  return { kind: 'REG', series: 'RX' + m[1], outlet: m[2], bar: outBar(m[2]), seat: m[3], cv: m[4], inlet, opts };
}

const VALVE_MODELS = /^(RX04|RX08|M4SI|M8SI|M4\.1|M8\.1|M12|M20)([SVUC])?\s+(.*)$/;
// 밸브: 모델 + 표면 + 구동 + 컨피그 + 바디/시트 + 연결 (verify_bom.valve_parse·valve_fallback 이식)
export function parseValve(desc) {
  const d = String(desc || '');
  const m = d.match(VALVE_MODELS);
  let model = m ? m[1] : null, seat = null, body = null;
  if (m) {
    const mm = m[3].match(/^([A-Z]+[0-9]?[A-Z]*?)\s*(\d?\*?\d+[WV]\d+(?:P\d|PEG|PSG|TPS|T)?)\s*([A-Z]{1,2}\/?[A-Z]{0,2})?(?=\s|$)/);
    if (mm && mm[3]) {
      let tok = mm[3];
      if (!tok.includes('/') && tok.length === 2 && 'AIHM'.includes(tok[0]) && 'KPVFEM'.includes(tok[1])) tok = tok[0] + '/' + tok[1];
      [body, seat] = tok.includes('/') ? tok.split('/', 2) : ['-', tok];
    }
  }
  if (!seat) {                                   // 비표준 품명 보정 판독
    let f = d.match(/(?<![A-Z])([AIH])\/([KVPFEM])(?=[^A-Z]|$|[A-D][:/])/);
    if (f) { body = f[1]; seat = f[2]; }
    else if ((f = d.match(/(?:^|\s|\d|NC|LM|HQ)A([KVM])(?=\s|$|\d|A[:/]|[A-D][:/])/))) { body = 'A'; seat = f[1]; }
    else if ((f = d.match(/\s([KVPF])(?=\s|$|A[:/])/) || d.match(/\d([KV])(?=A:)/))) { body = '-'; seat = f[1]; }
    if (!model) { const g = d.match(/(?<![A-Z])(RX04|RX08|M4SI|M8SI|M4\.1|M8\.1|M12|M20)/); model = g ? g[1] : null; }
  }
  if (!model && !seat) return null;
  return { kind: 'VALVE', model, seat, body };
}

// 레귤레이터 헤드 서브어셈블리(ETIGEI/RX3200/L95.8/HF/10bar/attele …)
export function parseHead(desc) {
  const d = String(desc || '');
  if (!/^ETIGEI\//i.test(d)) return null;
  const s = d.match(/^ETIGEI\/RX(\d{2})/i);
  const b = d.match(/\/(\d+(?:\.\d+)?)\s*bar/i) || d.match(/\/(\d+)b(?=\/|$)/i);
  return { kind: 'HEAD', series: s ? 'RX' + s[1] : null, bar: b ? Number(b[1]) : null, hf: /\/HF\//i.test(d) };
}

// ---------- 스프링 ----------
// RX30·31·32 압력 스프링: 26.10.19 BOM 전 품번에서 아웃렛 압력·Cv별로 1종씩 갈림(예외 0)
const RX30_SERIES = new Set(['RX30', 'RX31', 'RX32']);
const RX30_MAIN = /^SPRING\s*\/?\s*(RX30\/|D49\/)/i;
const SPRING_LABEL = { VAC: '0.7 bar(VAC)용', D49_15: '2 bar용(D49 Di15)', D49_29: '4 bar용(D49 DE29.8)',
  '7b': '7 bar용', '10b': '10 bar 표준(Cv 009)용', '10HF': '10 bar HF(Cv 015)용', '21b': '21 bar용' };
export function rx30SpringCode(name) {
  const n = String(name || '').toUpperCase();
  if (!RX30_MAIN.test(n)) return null;
  if (/\/VAC\//.test(n)) return 'VAC';
  if (/10HF/.test(n)) return '10HF';
  const b = n.match(/RX30\/(\d+)B\//);
  if (b) return b[1] + 'b';
  if (/D49\/.*DI\s*15/.test(n)) return 'D49_15';
  if (/D49\/.*DE\s*29[.,]8/.test(n)) return 'D49_29';
  return '?';
}
export function rx30SpringExpect(bar, hf) {
  if (bar === 0.7) return 'VAC';
  if (bar === 2) return 'D49_15';
  if (bar === 4) return 'D49_29';
  if (bar === 7) return '7b';
  if (bar === 10) return hf === null ? null : hf ? '10HF' : '10b';
  if (bar === 21) return '21b';
  return null;
}
export const springLabel = (c) => SPRING_LABEL[c] || c;
const RX40_MAIN = /^SPRING\/RX40\/|^SPRING\/RX4000\/ISO10243/i;
const RX40_SERIES = new Set(['RX40', 'RX41', 'RX42', 'RX50', 'RX52']);

// ---------- DB 도우미 ----------
export function makeIndex(db) {
  const nonsap = new Set(db.nonsap || []);
  const nonsapRe = new RegExp(db.nonsapPattern || '^CONSU/LUBRICANT|LOCTITE', 'i');
  const idx = { db, nonsap, nonsapRe, treeCache: new Map(), springMajority: null };
  idx.springMajority = buildSpringMajority(idx);
  return idx;
}
export const nameOf = (idx, n) => idx.db.names[n] || '';
export const isIgnored = (idx, n) => idx.nonsap.has(n) || idx.nonsapRe.test(nameOf(idx, n));

// 작지 전개: [{num, parent, level, qty, uom, sub}]
export function treeOf(idx, order) {
  if (idx.treeCache.has(order)) return idx.treeCache.get(order);
  const out = [];
  const walk = (p, lv, seen) => {
    for (const [c, q, u, sub] of idx.db.orders[p] || []) {
      if (seen.has(c)) continue;
      out.push({ num: c, parent: p, level: lv, qty: q, uom: u, sub });
      if (idx.db.orders[c]) walk(c, lv + 1, new Set([...seen, c]));
    }
  };
  walk(order, 1, new Set([order]));
  idx.treeCache.set(order, out);
  return out;
}

function buildSpringMajority(idx) {
  const groups = new Map();
  for (const [p, [fam, role]] of Object.entries(idx.db.prod || {})) {
    if (fam !== 'REGULATOR' || role !== 'FG') continue;
    const r = parseRegulator(nameOf(idx, p));
    if (!r || !RX40_SERIES.has(r.series)) continue;
    const springs = [...new Set(treeOf(idx, p).filter((t) => RX40_MAIN.test(nameOf(idx, t.num))).map((t) => t.num))];
    if (springs.length !== 1) continue;
    const key = [r.series, r.outlet, r.cv, r.inlet].join('|');
    if (!groups.has(key)) groups.set(key, new Map());
    const g = groups.get(key);
    g.set(springs[0], (g.get(springs[0]) || 0) + 1);
  }
  const res = new Map();
  for (const [key, g] of groups) {
    const n = [...g.values()].reduce((a, b) => a + b, 0);
    const [top, cnt] = [...g.entries()].sort((a, b) => b[1] - a[1])[0];
    if (n >= 5 && cnt / n >= 0.8) res.set(key, { spring: top, cnt, n });
  }
  return res;
}

// ---------- 규칙 검사: 구성품 목록 → 지적 사항 ----------
// comps: [{num, parent, level}] (현재 BOM 전개 + 작지에만 있는 구성품)
// 반환: [{num, sev:'상'|'중', rule, msg}]  — num 없으면 작지 전체 지적
export function checkRules(idx, order, comps) {
  const out = [];
  const desc = nameOf(idx, order);
  const prod = (idx.db.prod || {})[order];
  const add = (num, sev, rule, msg) => out.push({ num, sev, rule, msg });
  const reg = parseRegulator(desc);
  const head = reg ? null : parseHead(desc);
  const valve = reg || head ? null : prod && prod[0] === 'VALVE' ? parseValve(desc) : null;

  if (reg) {
    const mat = SEAT_MAT[reg.seat];
    const ht = reg.opts.includes('HT');
    for (const c of comps) {
      const n = nameOf(idx, c.num);
      if (!isRegSeat(n)) continue;
      const m = seatMat(n);
      if (ht && m && m !== 'PFA') add(c.num, '상', '시트 재질', `HT(고온) 사양 → PFA 시트여야 함, 이 시트는 ${m}`);
      else if (!ht && mat && m && !mat.includes(m)) add(c.num, '상', '시트 재질', `품명 시트 코드 ${reg.seat}(${mat.join('/')}) ↔ 이 시트 ${m}`);
      if (RX30_SERIES.has(reg.series) && /RX30HF|RX3000/i.test(n)) {
        const hfSeat = /RX30HF/i.test(n);
        if (reg.cv === '015' && !hfSeat) add(c.num, '상', '시트 사양', 'Cv 015(HF) 사양 → RX30HF 시트여야 함, 이 시트는 표준(RX3000)');
        if (reg.cv === '009' && hfSeat) add(c.num, '상', '시트 사양', 'Cv 009 표준 사양 → RX3000 시트여야 함, 이 시트는 HF(RX30HF)');
      }
    }
    if (RX30_SERIES.has(reg.series)) {
      const hf = reg.cv === '015' ? true : reg.cv === '009' ? false : null;
      const exp = rx30SpringExpect(reg.bar, hf);
      const springs = comps.filter((c) => rx30SpringCode(nameOf(idx, c.num)));
      for (const c of springs) {
        const code = rx30SpringCode(nameOf(idx, c.num));
        if (exp && code !== exp) add(c.num, '상', '스프링 사양', `아웃렛 ${reg.bar} bar${reg.bar === 10 ? `·Cv ${reg.cv}` : ''} → ${springLabel(exp)} 스프링이어야 함, 이 스프링은 ${springLabel(code)}`);
      }
      for (const c of comps) {
        const h = parseHead(nameOf(idx, c.num));
        if (!h) continue;
        if (h.bar !== null && reg.bar !== null && h.bar !== reg.bar && !(reg.bar === 0.7 && h.bar === 1))
          add(c.num, '상', '헤드 압력', `아웃렛 ${reg.bar} bar 사양인데 헤드 ${h.bar} bar`);
        if (reg.bar === 10 && hf !== null && h.hf !== hf)
          add(c.num, '상', '헤드 사양', hf ? 'Cv 015(HF) 사양인데 헤드가 HF 아님' : 'Cv 009 표준 사양인데 헤드가 HF');
      }
    }
    if (RX40_SERIES.has(reg.series)) {
      const maj = idx.springMajority.get([reg.series, reg.outlet, reg.cv, reg.inlet].join('|'));
      if (maj) for (const c of comps) {
        if (RX40_MAIN.test(nameOf(idx, c.num)) && c.num !== maj.spring)
          add(c.num, '중', '스프링 사양', `같은 사양(${reg.series} ${reg.outlet}bar Cv${reg.cv} 인렛${reg.inlet}) ${maj.n}품번 중 ${maj.cnt}품번이 ${maj.spring} ${nameOf(idx, maj.spring)} 사용 — 확인 필요`);
      }
    }
  }

  if (head && RX30_SERIES.has(head.series)) {           // 헤드 작지 단독 검증
    const exp = rx30SpringExpect(head.bar, head.bar === 10 ? head.hf : null);
    for (const c of comps) {
      const code = rx30SpringCode(nameOf(idx, c.num));
      if (code && exp && code !== exp) add(c.num, '상', '스프링 사양', `헤드 ${head.bar} bar${head.hf ? ' HF' : ''} → ${springLabel(exp)} 스프링이어야 함, 이 스프링은 ${springLabel(code)}`);
    }
  }

  if (valve && valve.seat) {
    const mat = SEAT_MAT[valve.seat];
    // 다연장(LINDE 등 품명에 모델 2종 이상)은 모델별 시트가 섞이므로 시트 모델 검사 제외
    const models = new Set(desc.match(/(?<![A-Z])(RX04|RX08|M4SI|M8SI|M12|M20)/g) || []);
    const want = models.size > 1 ? null : { RX04: 'M4SI', M4SI: 'M4SI', RX08: 'M8SI', M8SI: 'M8SI', M12: 'M12', M20: 'M20' }[valve.model];
    for (const c of comps) {
      const n = nameOf(idx, c.num);
      if (!isValveSeat(n)) continue;
      const m = seatMat(n);
      if (mat && m && !mat.includes(m)) add(c.num, '상', '시트 재질', `품명 시트 코드 ${valve.seat}(${mat.join('/')}) ↔ 이 시트 ${m}`);
      const u = n.toUpperCase();
      if (want && !/RXSM|IGS/.test(u)) {
        const has = ['M4SI', 'M8SI', 'M12', 'M20'].filter((t) => u.includes(t));
        if (has.length && !has.includes(want)) add(c.num, '상', '시트 모델', `${valve.model} 제품에 ${has.join('/')}용 시트 — 타 모델 시트`);
      }
    }
  }
  return out;
}

// ---------- OCR 숫자 정리 ----------
const OCR_DIGIT = { O: '0', o: '0', D: '0', Q: '0', I: '1', l: '1', '|': '1', i: '1', L: '1', S: '5', s: '5', B: '8', Z: '2', z: '2', G: '6' };
// 7자리 SAP 품번(1xxxxxx) 후보 — 숫자 5개 이상인 토큰만 글자→숫자 보정
export function extractNums(text) {
  const res = [];
  for (const tok of String(text || '').split(/[^0-9A-Za-z|]+/)) {
    if (!tok) continue;
    const digits = (tok.match(/\d/g) || []).length;
    let t = tok;
    if (digits >= 5 && digits < tok.length) t = [...tok].map((ch) => OCR_DIGIT[ch] ?? ch).join('');
    for (const m of t.matchAll(/(?<!\d)1\d{6}(?!\d)/g)) res.push(m[0]);
  }
  return res;
}

const ham1 = (a, b) => a.length === b.length && [...a].filter((ch, i) => ch !== b[i]).length === 1;

// 작지 품번 결정: 인쇄된 다른 품번이 자기 BOM에 가장 많이 들어 있는 품번
export function pickOrder(idx, nums) {
  const uniq = [...new Set(nums)];
  let best = null;
  for (const n of uniq) {
    if (!idx.db.orders[n]) continue;
    const kids = new Set(treeOf(idx, n).map((t) => t.num));
    const score = uniq.filter((x) => x !== n && kids.has(x)).length;
    if (!best || score > best.score) best = { num: n, score };
  }
  return best ? best.num : null;
}

// 품명 근사 일치(작지에 인쇄된 품명 ↔ SAP 품명): 0~1
const normDesc = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export function descScore(desc, text) {
  const p = normDesc(desc), t = normDesc(text);
  if (!p) return 0;
  if (t.includes(p)) return 1;
  let prev = new Array(t.length + 1).fill(0), cur = new Array(t.length + 1);
  for (let i = 1; i <= p.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= t.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (p[i - 1] === t[j - 1] ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return Math.max(0, 1 - Math.min(...prev) / p.length);
}

// ---------- 작지 판정 ----------
// sheetNums: 작지에서 읽은 7자리 품번 목록(중복 허용), text: OCR 전체 문자열
export function evaluate(idx, order, sheetNums, text = '') {
  const db = idx.db;
  const desc = nameOf(idx, order);
  const res = { order, desc, family: (db.prod[order] || [])[0] || '', role: (db.prod[order] || [])[1] || '',
    known: !!db.orders[order], items: new Map(), extras: [], missing: [], orderNotes: [], gate: db.gate[order] || null,
    descScore: text ? descScore(desc, text) : null, verdict: 'OK', bomDate: db.meta.bomDate };
  if (!res.known) {
    res.verdict = 'UNKNOWN';
    res.orderNotes.push({ sev: '상', rule: '데이터 없음', msg: `참조 BOM(${db.meta.bomDate})에 없는 작지 품번 — 최신 SAP BOM으로 데이터 갱신 후 재검증` });
    return res;
  }
  const tree = treeOf(idx, order);
  const direct = tree.filter((t) => t.level === 1);
  const inTree = new Map(tree.map((t) => [t.num, t]));
  const directOf = (num) => {                       // 하위 레벨 구성품 → 작지에 인쇄되는 1레벨 하위 작지
    let t = inTree.get(num);
    while (t && t.level > 1) t = inTree.get(t.parent);
    return t ? t.num : null;
  };

  const found = new Set(), extraNums = [], ocrFix = new Map();
  for (const n of new Set(sheetNums)) {
    if (n === order || isIgnored(idx, n)) continue;
    if (inTree.has(n)) { found.add(n); continue; }
    if (db.names[n]) { extraNums.push(n); continue; } // 알려진 부품인데 현재 BOM에 없음
    // 마스터에 없는 번호만 1자리 오독 보정(마스터에 있는 다른 부품 번호는 보정하지 않음)
    const cand = direct.filter((d) => ham1(d.num, n) && !sheetNums.includes(d.num));
    if (cand.length === 1) { found.add(cand[0].num); ocrFix.set(cand[0].num, n); }
  }

  const item = (num) => {
    if (!res.items.has(num)) {
      const t = inTree.get(num) || {};
      res.items.set(num, { num, name: nameOf(idx, num), qty: t.qty, uom: t.uom, level: t.level,
        onSheet: found.has(num), ocrFix: ocrFix.get(num) || null, reasons: [] });
    }
    return res.items.get(num);
  };
  for (const d of direct) item(d.num);

  // 작지에 인쇄됐지만 현재 BOM에 없는 구성품 — 변경 이력이 있으면 바뀐 품번까지 안내
  const tok = (n) => nameOf(idx, n).split(/[ /]/)[0].toUpperCase();
  for (const n of extraNums) {
    const ch = (db.changes || {})[order]?.[n];
    const repl = ch && ch[0] ? ch[0] : direct.find((d) => !found.has(d.num) && tok(d.num) && tok(d.num) === tok(n))?.num;
    const msg = ch
      ? `${ch[1]} BOM 변경으로 ${repl ? `${repl} ${nameOf(idx, repl)}(으)로 교체` : '삭제'}된 구성품 — 작지 재발행 필요`
      : `현재 BOM(${db.meta.bomDate})에 없는 구성품${repl ? ` — 현재 BOM의 같은 부품군: ${repl} ${nameOf(idx, repl)}` : ''} — 작지 발행 후 BOM 변경 또는 오투입`;
    const e = { num: n, name: nameOf(idx, n), onSheet: true, extra: true, replacedBy: repl || null,
      reasons: [{ sev: '상', rule: '현재 BOM에 없음', msg }] };
    res.items.set(n, e);
    res.extras.push(e);
  }
  const explained = new Set(res.extras.map((e) => e.replacedBy).filter(Boolean));

  // 규칙 검사: 현재 BOM 전개 + 작지에만 있는 구성품
  const comps = [...tree, ...extraNums.map((n) => ({ num: n, level: 1, parent: order }))];
  const mark = (num, r) => {
    if (res.items.has(num) && res.items.get(num).extra) { res.items.get(num).reasons.push(r); return; }
    const d = directOf(num);
    if (!d) { res.orderNotes.push(r); return; }
    const it = item(d);
    it.reasons.push(d === num ? r : { ...r, msg: `하위 작지 안 ${num} ${nameOf(idx, num)}: ${r.msg}` });
  };
  for (const r of checkRules(idx, order, comps)) mark(r.num, r);

  // 데이터 파일의 미결 BOM 이슈(치명·상·중) — 실시간 규칙과 같은 지적이면 한 줄로 합침
  const SAME = { 'C 시트': ['시트 재질'], 'X 시트 재질': ['시트 모델', '시트 재질'] };
  for (const [sev, rule, msg, targets, src] of db.issues[order] || []) {
    const r = { sev, rule, msg: src !== order ? `[완제품 ${src} 기준] ${msg}` : msg, audit: true };
    const tg = targets.filter((t) => inTree.has(t));
    if (!tg.length) { res.orderNotes.push(r); continue; }
    for (const t of tg) {
      const it = res.items.get(directOf(t) || t);
      const live = it && it.reasons.find((x) => !x.audit && (SAME[rule] || []).includes(x.rule));
      if (live) live.inLedger = true;
      else mark(t, r);
    }
  }

  for (const d of direct) {
    const it = res.items.get(d.num);
    if (!it.onSheet && !isIgnored(idx, d.num) && !explained.has(d.num)) res.missing.push(it);
  }

  // 소팅 게이트: ② 하위 BOM 미전개 = 구성 확인 불가(노랑) / ③ 기준 보류 = 자동 검증 범위 제한(참고)
  if (res.gate && res.gate[0] === 'BOM 이슈') {
    if (res.gate[1].startsWith('②')) res.orderNotes.push({ sev: '중', rule: '소팅 게이트', msg: res.gate[1] });
    else if (res.gate[1].startsWith('③')) res.orderNotes.push({ sev: '참고', rule: '소팅 게이트', msg: res.gate[1] });
  }

  // 판정: 빨간 줄(치명·상) → 분출 보류 / 노란 표시(중·미인식) → 확인 후 분출
  const sevOf = (rs) => (rs.some((r) => r.sev === '치명' || r.sev === '상') ? 'red' : rs.some((r) => r.sev !== '참고') ? 'yellow' : 'ok');
  let red = res.orderNotes.some((r) => r.sev === '치명' || r.sev === '상');
  let yellow = res.orderNotes.some((r) => r.sev !== '참고');
  for (const it of res.items.values()) {
    it.status = sevOf(it.reasons);
    if (it.status === 'red') red = true;
    if (it.status === 'yellow') yellow = true;            // 1자리 OCR 보정(마스터에 없는 번호 → 유일 후보)은 참고 표시만
  }
  if (res.missing.length) yellow = true;
  if (res.descScore !== null && res.descScore < 0.8) yellow = true;
  res.verdict = red ? 'STOP' : yellow ? 'CHECK' : 'OK';
  return res;
}
