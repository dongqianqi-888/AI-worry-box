'use strict';

/* =========================================================================
 * 烦恼寄存箱 · 核心逻辑
 * 三个对外函数严格对应设计稿的 MCP 接口：
 *   deposit(text)        —— 寄存一条念头（自动分类）
 *   acknowledge(entry)   —— 返回"收到了，明早会提醒你"的承诺
 *   morningDigest(force) —— 次日汇总（按优先级排待办，担忧仅被看见）
 * 之后可直接把这三者包成 MCP server 的 deposit / acknowledge / morning_digest。
 * ========================================================================= */

const KEY = 'worrybox.v1';
const state = load() || {
  deposits: [],
  settings: { remindHour: 9, remindMin: 0, tone: 'gentle' },
  reliability: { delivered: 0, missed: 0 }
};
function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

/* ---------- 分类引擎：待办 / 担忧 / 念头 ---------- */
const LEX = {
  worry: [
    ['怕',3],['担心',4],['焦虑',4],['万一',3],['会不会',3],['如果',2],['怎么办',3],
    ['糟',2],['完蛋',3],['后悔',3],['对不起',2],['说错',3],['做错',3],['失败',2],
    ['搞砸',3],['但愿',2],['不知道',2],['不敢',3],['紧张',3],['不安',2],['害怕',3],
    ['睡不着',2],['压力',2],['撑不住',3],['崩溃',3],['完不成',3],['没把握',3],
    ['是不是',2],['错了吗',3],['遗憾',2],['糟了',3],['完了',3]
  ],
  todo: [
    ['明天',2],['后天',2],['下周',2],['早上',2],['上午',2],['下午',2],['晚上',1],
    ['交',2],['提交',2],['发',1],['回复',2],['回邮件',3],['回信',3],['打电话',3],
    ['预约',3],['准备',2],['面试',3],['答辩',3],['交付',3],['会议',2],['截止',3],
    ['买',1],['做',1],['写',1],['改',1],['寄',2],['取',1],['记得',2],['别忘',3],
    ['必须',2],['报告',2],['邮件',2],['作业',2],['ppt',2],['pptx',2],['汇报',2],
    ['赶',2],['收拾',1],['订',2],['确认',2],['提醒',2],['漏',2]
  ]
};

function classify(text) {
  const t = (text || '').toLowerCase();
  let wScore = 0, tScore = 0;
  const wHit = [], tHit = [];
  for (const [k, s] of LEX.worry) if (t.includes(k.toLowerCase())) { wScore += s; wHit.push(k); }
  for (const [k, s] of LEX.todo)  if (t.includes(k.toLowerCase())) { tScore += s; tHit.push(k); }
  // 时间线索提升"待办"判定
  const timeCue = /\d+\s*点|点钟|[0-9]{1,2}:[0-9]{2}|am|pm|周一|周二|周三|周四|周五|周六|周日/.test(t);
  if (timeCue) tScore += 2;

  let category, reasons;
  if (wScore >= 4 && wScore >= tScore) { category = 'worry';   reasons = wHit; }
  else if (tScore >= 3)               { category = 'todo';     reasons = tHit; }
  else                                { category = 'thought';  reasons = wHit.length ? wHit : tHit; }
  return { category, worryScore: wScore, todoScore: tScore, reasons };
}

/* ---------- 时间工具 ---------- */
function nextRemindAt(fromTs, h, m) {
  const d = new Date(fromTs);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= fromTs) d.setDate(d.getDate() + 1); // 已过今天该时刻 → 明天
  return d;
}
function fmtTime(ts) {
  const d = new Date(ts);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ====================== 三个核心函数 ====================== */

/** 寄存一条念头 */
function deposit(text, overrideCat) {
  text = (text || '').trim();
  if (!text) return null;
  const c = classify(text);
  const entry = {
    id: 'd' + Date.now() + Math.random().toString(36).slice(2, 6),
    text,
    category: overrideCat || c.category,
    autoCategory: c.category,
    reasons: c.reasons,
    createdAt: Date.now(),
    remindAt: nextRemindAt(Date.now(), state.settings.remindHour, state.settings.remindMin).getTime(),
    status: 'deposited'
  };
  state.deposits.push(entry);
  save();
  return entry;
}

/** 生成承诺文案（按分类差异化；担忧不当任务） */
function acknowledge(entry) {
  const time = fmtTime(entry.remindAt);
  const t = state.settings.tone;
  if (entry.category === 'worry') {
    return t === 'plain'
      ? `已记录这条担忧。它不需要今晚解决，明早 ${time} 我们再看一眼。`
      : `这担忧我收下了。它不需要今晚解决——明早 ${time} 我们再看一眼就好。现在，可以放下它了。`;
  }
  if (entry.category === 'todo') {
    return t === 'plain'
      ? `已记录这件待办，明早 ${time} 会放进当天清单。今晚不用再想。`
      : `收到了，这是一件要办的事。我已替你记着，明早 ${time} 会把它放进当天的清单。今晚不用再想。`;
  }
  return t === 'plain'
    ? `已留下这个念头，明早 ${time} 若还想得起，它会在这儿。`
    : `这个念头我留着了。明早 ${time} 你若还想得起，它会在这儿。安心睡。`;
}

/** 次日汇总：待办按优先级，担忧仅"被看见"，念头轻列 */
function morningDigest(force) {
  const now = Date.now();
  const entries = state.deposits.filter(e => e.status === 'deposited' && (force || e.remindAt <= now));
  if (!entries.length) return null;
  const todo    = entries.filter(e => e.category === 'todo').sort(sortTodo);
  const worry   = entries.filter(e => e.category === 'worry');
  const thought = entries.filter(e => e.category === 'thought');
  // 一旦送达，标记已读（信用 +1，绝不漏发）
  entries.forEach(e => (e.status = 'digested'));
  state.reliability.delivered += 1;
  save();
  return { todo, worry, thought, total: entries.length };
}

/* 待办排序：高利害(截止/必须/面试/答辩/交付)优先，再按时间先后 */
function hourOf(e) {
  const t = e.text;
  const m = t.match(/(\d{1,2})\s*点/);
  if (m) return parseInt(m[1], 10);
  if (/早上|上午/.test(t)) return 9;
  if (/中午/.test(t)) return 12;
  if (/下午/.test(t)) return 14;
  if (/晚上/.test(t)) return 20;
  if (/凌晨/.test(t)) return 5;
  return 99;
}
function sortTodo(a, b) {
  const pri = x => (/截止|必须|面试|答辩|交付|汇报|赶/.test(x.text) ? 0 : 1);
  const pa = pri(a), pb = pri(b);
  if (pa !== pb) return pa - pb;
  return hourOf(a) - hourOf(b);
}

/* ====================== UI ====================== */
const $ = sel => document.querySelector(sel);
const screens = {
  deposit: $('#screen-deposit'),
  ack: $('#screen-ack'),
  night: $('#screen-night'),
  digest: $('#screen-digest')
};
function show(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function catLabel(c) {
  return c === 'todo' ? '待办' : c === 'worry' ? '担忧' : '念头';
}
function updateBadge() {
  $('#reliability').textContent = `已送达 ${state.reliability.delivered} · 漏发 ${state.reliability.missed}`;
}

/* 寄存屏 */
const input = $('#input');
input.addEventListener('input', () => { $('#charCount').textContent = input.value.length; });
$('#depositBtn').addEventListener('click', doDeposit);
input.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') doDeposit(); });

let lastEntry = null;
function doDeposit() {
  const text = input.value.trim();
  if (!text) return;
  lastEntry = deposit(text);
  input.value = '';
  $('#charCount').textContent = '0';
  renderAck(lastEntry);
  show('ack');
}

function renderAck(entry) {
  $('#ackText').textContent = entry.text;
  const cat = entry.category;
  const el = $('#ackCat');
  el.className = 'ack__cat cat-' + cat;
  el.textContent = catLabel(cat) + (entry.autoCategory !== cat ? '（已手动调整）' : '');
  $('#ackPromise').textContent = acknowledge(entry);
  lastEntry = entry;
}

/* 承诺屏：手动改分类 */
document.querySelectorAll('.chip').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!lastEntry) return;
    lastEntry.category = btn.dataset.cat;
    save();
    renderAck(lastEntry); // 重渲染承诺
  });
});

$('#againBtn').addEventListener('click', () => { show('deposit'); input.focus(); });
$('#sleepBtn').addEventListener('click', () => {
  const n = state.deposits.filter(e => e.status === 'deposited').length;
  $('#nightSub').textContent = `今晚你寄存了 ${n} 件。它们已被锁进箱子。`;
  show('night');
});

/* 晚安屏：箱子已锁（🔒 仅为象征，提示"允许自己忘"）。
   抽卡 / 冥想入口已移到首页；返回首页用左下角常驻「🏠 首页」按钮。 */

/* 明早汇总 */
function renderDigest(d) {
  if (!d) { alert('还没有可汇总的寄存。'); return; }
  $('#digestSub').textContent =
    `昨晚你寄存了 ${d.total} 件 —— ${d.todo.length} 件要行动，${d.worry.length} 件是担忧，${d.thought.length} 件是念头。今天慢慢来。`;
  fillList('#groupTodo', '#listTodo', d.todo, e => timeHint(e));
  fillList('#groupWorry', '#listWorry', d.worry, () => '被看见');
  fillList('#groupThought', '#listThought', d.thought, () => '飘过');
  show('digest');
}
function timeHint(e) {
  const h = hourOf(e);
  if (h < 99) return `${h}:00 前后`;
  if (/截止|必须/.test(e.text)) return '有期限';
  return '当天';
}
function fillList(groupSel, listSel, arr, tagFn) {
  const g = $(groupSel), ul = $(listSel);
  if (!arr.length) { g.hidden = true; return; }
  g.hidden = false;
  ul.innerHTML = arr.map(e =>
    `<li><span class="tag">${tagFn(e)}</span><span>${escapeHtml(e.text)}</span></li>`
  ).join('');
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

$('#openDigest').addEventListener('click', () => {
  const d = morningDigest(false) || morningDigest(true); // 没到时间也允许查看(预览)
  renderDigest(d);
});
$('#closeDigest').addEventListener('click', () => {
  alert('箱子已清空。今天慢慢来。');
  refreshPending();
  show('deposit');
});

/* 启动：若有已到提醒时间却未读的寄存 → 提示送达（绝不漏发） */
function refreshPending() {
  const due = state.deposits.filter(e => e.status === 'deposited' && e.remindAt <= Date.now());
  const wrap = $('#pendingWrap');
  if (due.length) {
    $('#pendingText').textContent = `你有 ${due.length} 件寄存的明早汇总已送达。`;
    wrap.hidden = false;
  } else {
    wrap.hidden = true;
  }
}

/* ====================== 语音输入 ====================== */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const mic = $('#mic');
if (SR) {
  const rec = new SR();
  rec.lang = 'zh-CN';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  let listening = false;
  rec.onresult = e => { input.value = e.results[0][0].transcript; $('#charCount').textContent = input.value.length; };
  rec.onerror = () => { stopMic(); $('#voiceHint').textContent = '语音识别出错或被拒绝，请直接打字。'; };
  rec.onend = () => stopMic();
  function stopMic() { listening = false; mic.classList.remove('listening'); $('#micLabel').textContent = '说'; }
  mic.addEventListener('click', () => {
    if (listening) { rec.stop(); return; }
    try { rec.start(); listening = true; mic.classList.add('listening'); $('#micLabel').textContent = '听…'; }
    catch (e) { /* 重复 start 忽略 */ }
  });
} else {
  mic.style.display = 'none';
  $('#voiceHint').textContent = '当前浏览器不支持语音，请用 Chrome / Edge，或直接打字。';
}

/* ====================== 设置 / 关于 ====================== */
$('#openSettings').addEventListener('click', () => {
  $('#remindTime').value = `${String(state.settings.remindHour).padStart(2,'0')}:${String(state.settings.remindMin).padStart(2,'0')}`;
  $('#tone').value = state.settings.tone;
  $('#settingsModal').hidden = false;
});
$('#closeSettings').addEventListener('click', () => $('#settingsModal').hidden = true);
$('#remindTime').addEventListener('change', e => {
  const [h, m] = e.target.value.split(':').map(Number);
  state.settings.remindHour = h; state.settings.remindMin = m; save();
});
$('#tone').addEventListener('change', e => { state.settings.tone = e.target.value; save(); });
$('#previewDigest').addEventListener('click', () => {
  $('#settingsModal').hidden = true;
  renderDigest(morningDigest(true)); // 强制生成（演示）
});
$('#resetAll').addEventListener('click', () => {
  if (confirm('确定清空全部寄存与统计？此操作不可恢复。')) {
    state.deposits = []; state.reliability = { delivered: 0, missed: 0 }; save();
    $('#settingsModal').hidden = true; refreshPending(); updateBadge();
    alert('已清空。');
  }
});

$('#openAbout').addEventListener('click', () => $('#aboutModal').hidden = false);
$('#closeAbout').addEventListener('click', () => $('#aboutModal').hidden = true);

/* =========================================================================
 * 环境音乐（Web Audio 实时合成：有能量的·静谧冥想曲，零音频文件、离线可用）
 * 设计：低频根基(能量) + 温暖铺底和弦(静谧) + 轻柔律动脉冲(生命感) + 五声钟琴(飘动)
 * ========================================================================= */
let actx = null, masterGain = null, ambientNodes = [], ambientOn = false;
let ambientBaseVol = 0.4, ambientArpTimer = null;
function ensureAudio() {
  if (actx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  actx = new AC();
  masterGain = actx.createGain();
  masterGain.gain.value = 0;
  masterGain.connect(actx.destination);
}
function fadeMaster(target, sec) {
  if (!masterGain) return;
  const now = actx.currentTime;
  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setValueAtTime(masterGain.gain.value, now);
  masterGain.gain.linearRampToValueAtTime(target, now + sec);
}
/* 语音时压低背景乐，说完恢复，让引导语更清晰 */
function duckForSpeech() {
  if (!actx || !ambientNodes.length || !masterGain) return;
  const n = actx.currentTime;
  masterGain.gain.cancelScheduledValues(n);
  masterGain.gain.setValueAtTime(masterGain.gain.value, n);
  masterGain.gain.linearRampToValueAtTime(ambientBaseVol * 0.38, n + 0.25);
}
function duckRestore() {
  if (!actx || !ambientNodes.length || !masterGain) return;
  const n = actx.currentTime;
  masterGain.gain.cancelScheduledValues(n);
  masterGain.gain.setValueAtTime(masterGain.gain.value, n);
  masterGain.gain.linearRampToValueAtTime(ambientBaseVol, n + 0.9);
}
function startAmbient(vol = 0.45) {
  ensureAudio();
  if (actx.state === 'suspended') actx.resume();
  ambientBaseVol = vol;
  if (ambientNodes.length) { fadeMaster(vol, 1.5); return; }
  const now = actx.currentTime;

  // 1) 低频根基（能量感的地基）
  const root = actx.createOscillator(); root.type = 'sine'; root.frequency.value = 55;
  const rootG = actx.createGain(); rootG.gain.value = 0.16;
  root.connect(rootG); rootG.connect(masterGain); root.start();
  ambientNodes.push(root);

  // 2) 温暖铺底和弦 A add9 / sus（开阔、静谧）
  const freqs = [220, 277.18, 329.63, 440];
  freqs.forEach((f, i) => {
    const o = actx.createOscillator();
    o.type = i % 2 ? 'triangle' : 'sine'; o.frequency.value = f;
    const g = actx.createGain(); g.gain.value = 0.07 / (i * 0.5 + 1);
    const lfo = actx.createOscillator(); lfo.frequency.value = 0.05 + 0.03 * i;
    const lfoG = actx.createGain(); lfoG.gain.value = 0.03;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    o.connect(g); g.connect(masterGain); o.start(); lfo.start();
    ambientNodes.push(o, lfo);
  });

  // 3) 轻柔律动脉冲（"有能量"的呼吸/心跳，不喧宾夺主）
  const pulse = actx.createOscillator(); pulse.type = 'sine'; pulse.frequency.value = 110;
  const pulseG = actx.createGain(); pulseG.gain.value = 0.0;
  const pulseLfo = actx.createOscillator(); pulseLfo.type = 'sine'; pulseLfo.frequency.value = 0.42;
  const pulseLfoG = actx.createGain(); pulseLfoG.gain.value = 0.05;
  const pulseBias = actx.createConstantSource(); pulseBias.offset.value = 0.05;
  pulseLfo.connect(pulseLfoG); pulseLfoG.connect(pulseG.gain);
  pulseBias.connect(pulseG.gain);
  pulse.connect(pulseG); pulseG.connect(masterGain);
  pulse.start(); pulseLfo.start(); pulseBias.start();
  ambientNodes.push(pulse, pulseLfo, pulseBias);

  // 4) 缓慢五声钟琴（飘动的能量）
  const arp = [440, 523.25, 587.33, 659.25, 783.99, 587.33, 523.25];
  let ai = 0;
  ambientArpTimer = setInterval(() => {
    if (!ambientNodes.length) return;
    const f = arp[ai % arp.length]; ai++;
    const o = actx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const g = actx.createGain(); const t = actx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.045, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    o.connect(g); g.connect(masterGain); o.start(t); o.stop(t + 2.8);
  }, 3400);

  // 5) 极轻空气噪声（"静谧"的空间感）
  const bufSize = 2 * actx.sampleRate;
  const buf = actx.createBuffer(1, bufSize, actx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
  const noise = actx.createBufferSource();
  noise.buffer = buf; noise.loop = true;
  const nf = actx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 420;
  const ng = actx.createGain(); ng.gain.value = 0.03;
  noise.connect(nf); nf.connect(ng); ng.connect(masterGain);
  noise.start();
  ambientNodes.push(noise);

  fadeMaster(vol, 2);
}
function stopAmbient() {
  if (!ambientNodes.length) return;
  fadeMaster(0, 1.2);
  if (ambientArpTimer) { clearInterval(ambientArpTimer); ambientArpTimer = null; }
  const nodes = ambientNodes; ambientNodes = [];
  setTimeout(() => { nodes.forEach(n => { try { n.stop(); } catch (e) {} }); }, 1400);
}
function setMasterVol(v) { if (masterGain) masterGain.gain.value = v; }
// 顶栏开关
$('#musicToggle').addEventListener('click', () => {
  ambientOn = !ambientOn;
  $('#musicToggle').classList.toggle('on', ambientOn);
  if (ambientOn) startAmbient(0.4); else stopAmbient();
});
// 抽卡时的轻柔钟声
function chime() {
  ensureAudio();
  if (actx.state === 'suspended') actx.resume();
  const osc = actx.createOscillator();
  const g = actx.createGain();
  osc.type = 'sine'; osc.frequency.value = 880;
  g.gain.setValueAtTime(0.0001, actx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.18, actx.currentTime + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 1.6);
  osc.connect(g); g.connect(actx.destination);
  osc.start(); osc.stop(actx.currentTime + 1.7);
}
// 冥想起止的柔和钟（更低更沉）
function medBell() {
  ensureAudio();
  if (actx.state === 'suspended') actx.resume();
  [523.25, 392].forEach((f, i) => {
    const osc = actx.createOscillator(); const g = actx.createGain();
    osc.type = 'sine'; osc.frequency.value = f;
    const t = actx.currentTime + i * 0.18;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    osc.connect(g); g.connect(actx.destination); osc.start(t); osc.stop(t + 2.6);
  });
}

/* =========================================================================
 * 心灵卡牌
 * ========================================================================= */
/* 心灵卡牌：权威能量/静谧语录（带出处与一句解读，体现"被接住的安慰"）
 * 来源：一行禅师、玛丽·奥利弗、鲁米、老子、王维、苏轼、里尔克、弗兰克尔、
 *       佩玛·丘卓、马可·奥勒留、布芮尼·布朗、纪伯伦、卡巴金、庄子 等 */
const CARDS = [
  { tag:'放下', t:'你可以放下，不是丢弃。放下是让事物如其所是，来去自如。', who:'杰克·康菲尔德（Jack Kornfield）', x:'担忧像握紧的拳头——松开，反而更有力。' },
  { tag:'静', t:'致虚极，守静笃。', who:'老子《道德经·第十六章》', x:'把脑子里的杂音调到最低，你本来的清明会浮现。' },
  { tag:'自我慈悲', t:'你不必是好的。你只需让身体里那只柔软的动物，爱它所爱。', who:'玛丽·奥利弗（Mary Oliver）《野鹅》', x:'今晚不需要表现得完美，存在本身已经足够。' },
  { tag:'韧性', t:'在刺激与反应之间，有一片空间。在那片空间里，是我们的力量去选择回应。', who:'维克多·弗兰克尔（Viktor Frankl）', x:'你不是被念头推着走的人，你是那个能停顿的人。' },
  { tag:'夜', t:'行到水穷处，坐看云起时。', who:'王维《终南别业》', x:'走到尽头也别慌，坐下来，云会自己升起来。' },
  { tag:'放下', t:'担忧什么也成就不了。你多担一百倍心，世界也不会因此改变——只会让你更累。', who:'一行禅师（Thich Nhat Hanh）', x:'焦虑是假的工作。停下的那刻，它才真正失去力气。' },
  { tag:'静', t:'你只需让思绪入睡，别让它们投下影子，遮住你心里的月亮。', who:'鲁米（Rumi）', x:'念头是云，心是明月；云会散。' },
  { tag:'自我慈悲', t:'接纳自己、爱着自己走过这一切，是我们做过最勇敢的事。', who:'布芮尼·布朗（Brené Brown）', x:'承认"我今天有点撑不住"，本身就是一种力量。' },
  { tag:'韧性', t:'你是天空，其余一切——只是天气。', who:'佩玛·丘卓（Pema Chödrön）', x:'风暴会过。你比任何一次坏情绪都大。' },
  { tag:'静', t:'大自然从不匆忙，然而一切都被完成。', who:'老子（Lao Tzu）', x:'你也不必赶。该发生的总会发生，在你自己的节奏里。' },
  { tag:'放下', t:'上善若水。水善利万物而不争。', who:'老子《道德经·第八章》', x:'最柔软的，往往最持久。你不必硬扛。' },
  { tag:'夜', t:'回首向来萧瑟处，归去，也无风雨也无晴。', who:'苏轼《定风波》', x:'明早醒来，今天的慌张多半已是无风无雨。' },
  { tag:'韧性', t:'我的使命不只是活下去，而是蓬勃地活——带着热情、悲悯，与一点幽默。', who:'玛雅·安吉罗（Maya Angelou）', x:'你值得不只是"熬过"，而是"活得漂亮"。' },
  { tag:'自我慈悲', t:'你对自我思绪的掌控，胜过对外物的掌控。明白这点，就找到了力量。', who:'马可·奥勒留（Marcus Aurelius）《沉思录》', x:'真正能管的，是自己的心；其余的，先放下。' },
  { tag:'静', t:'你无法阻止海浪，但你可以学会冲浪。', who:'乔·卡巴金（Jon Kabat-Zinn）', x:'情绪来了不必压，顺着它，呼吸就是你的浪板。' },
  { tag:'放下', t:'对未解之事保持耐心，试着去爱那些问题本身……活在问题里，也许某天会不知不觉活进答案。', who:'里尔克（Rainer Maria Rilke）《给青年诗人的信》', x:'不必现在就有答案。带着疑问睡去，也是一种成熟。' },
  { tag:'韧性', t:'你的痛苦，是包裹你领悟的壳正在裂开。', who:'纪伯伦（Kahlil Gibran）《先知》', x:'难受不一定在变糟，也可能在"长大"。' },
  { tag:'夜', t:'幸福没有通往的路——幸福本身就是路。', who:'一行禅师（Thich Nhat Hanh）', x:'别把"开心"押在"明天解决后"。此刻就能是路。' },
  { tag:'静', t:'当心灵静止，整个宇宙都会向你臣服。', who:'老子（Lao Tzu）', x:'安静不是空白，是接收万物的天线。' },
  { tag:'自我慈悲', t:'我们的焦虑，许多时候是我们自己给自己的。最难熬的时段，常是自己制造的。', who:'佩玛·丘卓（Pema Chödrön）', x:'有时松开"我必须扛住"的念头，天并不会塌。' },
  { tag:'韧性', t:'千里之行，始于足下。', who:'老子（Lao Tzu）', x:'明天的难事，从明天的第一步开始就好。今晚先停。' },
  { tag:'放下', t:'放下你的担忧，让心像一面不沾影像的镜子，清澈见底。', who:'鲁米（Rumi）', x:'镜子空了，才能照见真实的自己。' },
  { tag:'夜', t:'深呼吸，把心带回身体。然后看向那个让你起情绪的人——他也在受苦。', who:'一行禅师（Thich Nhat Hanh）', x:'连紧绷都可以被呼吸温柔地接住。' },
  { tag:'自我慈悲', t:'至人无己，神人无功，圣人无名。', who:'庄子《逍遥游》', x:'放下"我必须被看见"，反而最接近自由。' }
];
const TAG_COLOR = {
  '放下':'#8fb4ff', '静':'#c2a9e6', '自我慈悲':'#f6c977', '韧性':'#7fd1c4', '夜':'#9aa7e8'
};
let lastCardIdx = -1;
function drawCard() {
  let i;
  do { i = Math.floor(Math.random() * CARDS.length); } while (i === lastCardIdx && CARDS.length > 1);
  lastCardIdx = i;
  const c = CARDS[i];
  const tag = $('#cardTag');
  tag.textContent = c.tag;
  tag.style.color = TAG_COLOR[c.tag] || 'var(--muted)';
  tag.style.borderColor = TAG_COLOR[c.tag] || 'var(--card-b)';
  $('#cardTitle').textContent = '“' + c.t + '”';
  $('#cardWho').textContent = '— ' + c.who;
  $('#cardText').textContent = c.x;
  const card = $('#soulCard');
  card.classList.remove('is-flipped');
  void card.offsetWidth; // 强制重排，保证每次翻牌都有动画
  requestAnimationFrame(() => card.classList.add('is-flipped'));
  chime();
}
$('#homeCardBtn').addEventListener('click', () => { $('#cardOverlay').hidden = false; drawCard(); });
$('#cardAgain').addEventListener('click', drawCard);
$('#cardClose').addEventListener('click', () => { $('#cardOverlay').hidden = true; show('deposit'); });
$('#homeMedBtn').addEventListener('click', () => { $('#medOverlay').hidden = false; });

/* =========================================================================
 * 10 分钟冥想：使用 UCLA 正念研究中心现成引导音频（CC 授权，Diana Winston）
 * 播放时合成背景乐静音，结束后恢复；计时跟随音频真实时长
 * ========================================================================= */
const MED_SRC = 'https://d1cy5zxxhbcbkk.cloudfront.net/guided-meditations/05_Loving_Kindness_Meditation.mp3';
const medAudio = $('#medAudio');
medAudio.src = MED_SRC;
let medWasAmbientOn = false;
function medPauseAmbientForGuide() {
  medWasAmbientOn = ambientOn;
  if (ambientNodes.length) stopAmbient();
}
function medResumeAmbientAfter() {
  if (medWasAmbientOn && !ambientNodes.length) startAmbient(0.4);
}
function fmtMMSS(s) { const t = Math.max(0, Math.floor(s || 0)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }
medAudio.addEventListener('loadedmetadata', () => { $('#medTimer').textContent = fmtMMSS(medAudio.duration); });
medAudio.addEventListener('timeupdate', () => {
  if (!medAudio.duration || isNaN(medAudio.duration)) return;
  $('#medTimer').textContent = fmtMMSS(medAudio.duration - medAudio.currentTime);
  $('#medCue').textContent = medAudio.currentTime < medAudio.duration / 2 ? '跟随呼吸' : '安住此刻';
});
medAudio.addEventListener('ended', medFinish);
$('#medPlay').addEventListener('click', () => {
  if (medAudio.paused) {
    if (medAudio.ended || medAudio.currentTime >= (medAudio.duration || 0) - 0.5) medAudio.currentTime = 0;
    medPauseAmbientForGuide(); medBell();
    medAudio.play().catch(() => { $('#medCaption').textContent = '音频加载失败，请检查网络后重试。'; });
    $('#medPlay').textContent = '⏸ 暂停';
    $('#medCaption').textContent = '跟随引导，慢慢来。你被允许休息。';
  } else {
    medAudio.pause(); $('#medPlay').textContent = '▶ 播放';
  }
});
$('#medRestart').addEventListener('click', () => {
  medPauseAmbientForGuide(); medAudio.currentTime = 0;
  medAudio.play().catch(() => {}); $('#medPlay').textContent = '⏸ 暂停';
});
$('#medVol').addEventListener('input', e => { medAudio.volume = e.target.value / 100; });
medAudio.volume = 0.85;
function medFinish() {
  $('#medPlay').textContent = '▶ 播放';
  $('#medCue').textContent = '晚安';
  $('#medCaption').textContent = '这一次，你为自己留了一段安静。愿你好梦。';
  medAudio.currentTime = 0;
  medResumeAmbientAfter();
  setTimeout(() => { $('#medOverlay').hidden = true; }, 4200);
}

/* ====================== 返回首页（每个页面常驻） ====================== */
function goHome() {
  if (medAudio && !medAudio.paused) { medAudio.pause(); medResumeAmbientAfter(); }
  $('#cardOverlay').hidden = true;
  $('#medOverlay').hidden = true;
  $('#medPlay').textContent = '▶ 播放';
  show('deposit');
}
$('#homeBtn').addEventListener('click', goHome);

/* ====================== 背景音乐一开始就出来 ====================== */
function tryStartAmbient() {
  if (ambientOn && !ambientNodes.length) startAmbient(0.4);
  if (actx && actx.state === 'suspended') actx.resume();
}
ambientOn = true;
$('#musicToggle').classList.add('on');
window.addEventListener('load', tryStartAmbient);
// 浏览器策略：自动播放需用户首次交互后才真正发声，首次交互即补启动
['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
  document.addEventListener(ev, tryStartAmbient, { once: true, capture: true })
);

/* ====================== 启动 ====================== */
updateBadge();
refreshPending();
