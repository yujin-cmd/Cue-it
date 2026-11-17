import { evaluateSlide, currentLineIndex, normalize } from "./match.js";
import { savePdf, loadPdf, saveDeck, loadDeck, saveReport, loadReports, updateLatestReport, saveType, loadType } from "./store.js";
import { TYPES, TYPE_KEYS, typeOf, typeKey, levelKey, levelLabel } from "./presets.js";
import { DEMO_DECK, DEMO_PDF, DEMO_SCRIPT, DEMO_COACH, DEMO_QA, DEMO_ASK, DEMO_SCRIPT_TEXT } from "./demo/demo.js";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

let deck = loadDeck();          // 분석 결과
let pdfDoc = null;              // pdf.js 문서
let channel = null;             // 슬라이드 창 동기화
let ptype = deck ? typeKey(deck.type) : TYPES[loadType()] ? loadType() : "";  // 발표 유형. 빈 값은 아직 고르지 않음

/* ══ 화면 전환 ══════════════════════════ */
/* ══ 스테퍼 ═════════════════════════════
   지금 보고 있는 단계가 「진행 중」, 그 앞은 모두 「완료」. */
const STEPS = [
  { id: "upload", label: "준비" },
  { id: "review", label: "검토" },
  { id: "practice", label: "연습" },
  { id: "present", label: "발표" },
  { id: "report", label: "리포트" },
  { id: "qna", label: "질의응답" },
];
let curStep = "upload";

function renderStepper() {
  const box = $("#stepper");
  const locked = !deck; // 자료가 없으면 준비 외에는 들어갈 수 없다
  const curIdx = Math.max(0, STEPS.findIndex((s) => s.id === curStep));

  box.innerHTML = STEPS.map((s, i) => {
    const lock = locked && s.id !== "upload";
    const isCur = i === curIdx;
    const done = i < curIdx;

    let cls = lock ? "lock" : isCur ? "cur" : done ? "done" : "";
    if (i > 0 && i <= curIdx && !lock) cls += " linked"; // 지나온 구간만 이어진다

    const label = lock ? "" : isCur ? "진행 중" : done ? "완료" : "";
    const mark = done ? "✓" : i + 1;

    return `<button class="stp ${cls}" data-go="${s.id}" ${lock ? "disabled" : ""}>
      <span class="stp-dot">${mark}</span>
      <span class="stp-label">${s.label}</span>
      <span class="stp-state">${label}</span>
    </button>`;
  }).join("");

  box.querySelectorAll(".stp").forEach((b) => {
    if (!b.disabled) b.onclick = () => go(b.dataset.go);
  });

  const sv = $("#savedState");
  sv.classList.toggle("demo", !!deck?.demo);
  if (deck?.demo) {
    sv.classList.add("on");
    $("#savedText").innerHTML = `체험 중 · 가상의 샘플 발표 <button class="linkbtn" id="demoExit">체험 끝내기</button>`;
    $("#demoExit").onclick = exitDemo;
  } else if (deck) {
    sv.classList.add("on");
    $("#savedText").textContent = `${deck.title} · 슬라이드 ${deck.slides.length}장 저장됨`;
  } else {
    sv.classList.remove("on");
    $("#savedText").textContent = "아직 자료가 없어요";
  }
}

/* ══ 화면 전환 ══════════════════════════ */
function go(id) {
  if (demoEnded) stopDemo();
  if (!running) document.body.classList.remove("stage");
  curStep = id;
  if (id !== "practice") {
    document.body.classList.remove("mood-일반", "mood-검증", "mood-압박");
    clearInterval(cdTimer);
    const cd = document.getElementById("countdown");
    if (cd) cd.hidden = true;
  }
  $$(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
  enterMotion(id);
  renderStepper();
  renderBlank(id);
  window.scrollTo(0, 0);
}

// 화면을 열 때 내용이 차례로 올라오게 한다. 움직임이 끝나면 표시를 지워서, 이후 다시 그려도 반복되지 않는다.
let enterTimer = null;
function enterMotion(id) {
  const sc = document.getElementById(id);
  if (!sc) return;
  $$(".screen.entering").forEach((s) => s.classList.remove("entering"));
  void sc.offsetWidth;
  sc.classList.add("entering");
  clearTimeout(enterTimer);
  enterTimer = setTimeout(() => sc.classList.remove("entering"), 1200);
}

// 자료가 없을 때 빈 화면 대신 안내를 보여준다
const BLANK = {
  review: ["검토할 항목이 아직 없어요", "1단계에서 슬라이드와 대본을 넣으면, AI가 뽑은 핵심 항목을 여기서 직접 고칠 수 있어요."],
  practice: ["연습할 자료가 없어요", "발표 내용을 알아야 청중처럼 질문할 수 있어요. 먼저 자료를 넣어 주세요."],
  present: ["발표할 자료가 없어요", "슬라이드와 핵심 항목이 준비되면 실전 화면이 열려요."],
  qna: ["찾을 자료가 없어요", "미리 준비한 근거가 있어야 질문에 맞는 슬라이드를 찾아드릴 수 있어요."],
};

function renderBlank(id) {
  const sec = document.getElementById(id);
  const old = sec?.querySelector(".blank");
  if (old) old.remove();
  if (deck || !BLANK[id]) {
    sec?.querySelectorAll(".hide-when-blank").forEach((e) => (e.hidden = false));
    return;
  }
  sec.querySelectorAll(".hide-when-blank").forEach((e) => (e.hidden = true));
  const d = document.createElement("div");
  d.className = "blank";
  d.innerHTML = `<h3>${BLANK[id][0]}</h3><p>${BLANK[id][1]}</p>
    <button class="primary">1단계로 가기</button>
    <button class="ghost">샘플로 먼저 해보기</button>`;
  d.querySelector("button.primary").onclick = () => go("upload");
  d.querySelector("button.ghost").onclick = tryDemo;
  sec.appendChild(d);
}

// 분석 결과 저장. 체험용 샘플은 저장하지 않는다(사용자의 자료를 덮어쓰지 않도록).
function persist() {
  if (!deck?.demo) saveDeck(deck);
}

/* ══ 체험하기 ═══════════════════════════
   미리 분석해 둔 가상의 발표로 큐잇을 바로 써 본다. AI를 부르지 않는다.
   · 자동 시연: 준비 → 검토 → 연습 → 발표 → 리포트 → 질의응답 여섯 단계를 차례로 보여준다(약 2분).
     보는 사람이 잠깐 멈추거나 다음 단계로 넘길 수 있다.
   · 직접 해보기: 샘플 자료로 검토·연습·발표를 직접 해 본다 */
let userDeck = null;   // 체험을 시작하기 전의 내 자료. 체험이 끝나면 되돌린다.

function enterDemo() {
  if (running) endRun();
  if (!deck?.demo) userDeck = deck;
  deck = JSON.parse(JSON.stringify(DEMO_DECK));
  previewKey = "";
  qaHistory = [];
  level = "검증";
  $$(".lvl").forEach((x) => x.classList.toggle("active", x.dataset.level === "검증"));
  $("#goalMin").value = typeOf(deck.type).minutes;
  applyType();
  renderReview();
  renderPractice();
  $("#qResult").innerHTML = "";
}

function exitDemo() {
  stopDemo();
  if (running) endRun();
  deck = userDeck || loadDeck();
  userDeck = null;
  previewKey = "";
  applyType();
  $("#qResult").innerHTML = "";
  $("#qInput").value = "";
  $("#answerBox").value = "";
  if (deck) {
    renderReview();
    renderPractice();
  }
  if (ptype) $("#goalMin").value = typeOf(ptype).minutes;
  renderReports();
  go("upload");
}

function tryDemo() {
  stopDemo();
  enterDemo();
  go("review");
}

/* ── 자동 시연 ─────────────────────────── */
let demoToken = 0;       // 시연을 새로 시작하거나 멈출 때마다 바뀐다. 예전 시연이 뒤늦게 화면을 건드리지 않게 한다.
let demoOn = false;      // 자동 시연이 진행 중
let demoPaused = false;  // 잠깐 멈춤
let demoSkip = false;    // 지금 단계를 끝까지 빨리 넘기는 중
let demoEnded = false;   // 시연이 끝나고 마지막 안내가 떠 있는 상태
let pauseAt = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 안내 문구를 읽는 데 필요한 시간. 글자 수에 맞춘다.
function readMs(t) {
  return Math.min(6500, Math.max(3200, 1200 + t.length * 65));
}

// ms만큼 기다린다. 멈춤 중에는 시간이 흐르지 않고, 건너뛰기를 누르면 바로 끝난다.
async function dwait(ms, ok) {
  let left = ms;
  let last = performance.now();
  while (left > 0) {
    if (!ok() || demoSkip) return;
    await sleep(50);
    const now = performance.now();
    if (!demoPaused) left -= now - last;
    last = now;
  }
}

function caption(t, ms) {
  const cap = $("#demoCap");
  $("#demoCapText").textContent = t;
  cap.hidden = false;
  cap.classList.remove("pop");
  void cap.offsetWidth;            // 문구가 바뀔 때마다 눈에 띄게 한 번 튀게 한다
  cap.classList.add("pop");
  const bar = $("#demoBar");       // 다음 장면까지 남은 시간
  bar.style.animation = "none";
  void bar.offsetWidth;
  bar.style.animation = ms ? `capbar ${ms}ms linear forwards` : "none";
}
function hideCaption() {
  $("#demoCap").hidden = true;
}

// 안내 문구를 띄우고 읽을 시간만큼 기다린다
async function tell(t, ok, ms) {
  ms = ms ?? readMs(t);
  caption(t, ms);
  await dwait(ms, ok);
}
// 안내 문구를 띄운 채로 화면 동작(fn)을 보여준다
async function tellWhile(t, ok, fn) {
  const ms = readMs(t);
  caption(t, ms);
  const t0 = performance.now();
  await fn();
  await dwait(Math.max(900, ms - (performance.now() - t0)), ok);
}

// 지금 설명하는 곳을 테두리로 짚어 준다
function spot(target) {
  clearSpot();
  const el = typeof target === "string" ? $(target) : target;
  if (!el) return;
  el.classList.add("demo-spot");
  // 안내 문구 아래쪽 빈 곳에 들어오도록 화면을 옮긴다. 이미 다 보이면 그대로 둔다.
  const r = el.getBoundingClientRect();
  const cap = $("#demoCap");
  const top = (cap.hidden ? 0 : cap.getBoundingClientRect().bottom) + 24;
  const bottom = window.innerHeight - 24;
  if (r.top >= top && r.bottom <= bottom) return;
  const room = bottom - top;
  const dy = r.height >= room ? r.top - top : r.top - (top + (room - r.height) / 2);
  window.scrollBy({ top: dy, behavior: "smooth" });
}
function clearSpot() {
  $$(".demo-spot").forEach((e) => e.classList.remove("demo-spot"));
}

// 입력 칸에 글자가 하나씩 쳐지는 모습
async function typeInto(el, text, ok) {
  for (let i = 1; i <= text.length; i++) {
    if (!ok()) return;
    if (demoSkip) break;
    el.value = text.slice(0, i);
    await dwait(40, ok);
  }
  if (ok()) el.value = text;
}

function setPaused(on) {
  if (demoPaused === on) return;
  demoPaused = on;
  $("#demoCap").classList.toggle("paused", on);
  $("#demoPause").textContent = on ? "▶ 계속" : "⏸ 잠깐 멈춤";
  if (on) pauseAt = Date.now();
  else if (running) {
    // 멈춘 시간만큼 발표 시계를 뒤로 민다
    const d = Date.now() - pauseAt;
    startTs += d;
    if (slideEnter[cur]) slideEnter[cur] += d;
  }
}

function setCapMode(mode) {
  const end = mode === "end";
  $("#demoCap").classList.toggle("end", end);
  $("#demoPause").hidden = end;
  $("#demoNext").hidden = end;
  $("#demoStop").hidden = end;
  $("#demoEnd").hidden = !end;
}

/* 1단계 준비 장면은 화면에 가짜 입력을 보여주므로, 끝나면 사용자가 넣어 둔 것을 그대로 되돌린다 */
let upSnap = null;

function snapUpload() {
  const cv = $("#thumb");
  let thumb = null;
  if (cv.width && cv.height) {
    thumb = document.createElement("canvas");
    thumb.width = cv.width;
    thumb.height = cv.height;
    thumb.getContext("2d").drawImage(cv, 0, 0);
  }
  upSnap = {
    script: $("#scriptBox").value,
    idleHidden: $("#dzIdle").hidden,
    loadedHidden: $("#dzLoaded").hidden,
    dzLoaded: dz.classList.contains("loaded"),
    name: $("#pdfName").textContent,
    pages: $("#pdfPages").textContent,
    info: $("#pdfInfo").textContent,
    msg: $("#analyzeMsg").textContent,
    thumb,
    tw: cv.style.width,
    th: cv.style.height,
  };
}

function restoreUpload() {
  $("#analyzeBtn").classList.remove("demo-live");
  if (!upSnap) return;
  const s = upSnap;
  upSnap = null;
  $("#scriptBox").value = s.script;
  $("#dzIdle").hidden = s.idleHidden;
  $("#dzLoaded").hidden = s.loadedHidden;
  dz.classList.toggle("loaded", s.dzLoaded);
  $("#pdfName").textContent = s.name;
  $("#pdfPages").textContent = s.pages;
  $("#pdfInfo").textContent = s.info;
  $("#analyzeMsg").textContent = s.msg;
  if (s.thumb) {
    const cv = $("#thumb");
    cv.width = s.thumb.width;
    cv.height = s.thumb.height;
    cv.style.width = s.tw;
    cv.style.height = s.th;
    cv.getContext("2d").drawImage(s.thumb, 0, 0);
  }
  renderTypes();
  updateAnalyzeBtn();
}

// 샘플 PDF가 올라간 것처럼 보여준다(실제로 저장하거나 분석하지 않는다)
async function showDemoPdf(ok) {
  $("#pdfName").textContent = "동네 공유 우산.pdf";
  $("#pdfPages").textContent = `슬라이드 ${deck.slides.length}장`;
  $("#dzIdle").hidden = true;
  $("#dzLoaded").hidden = false;
  dz.classList.add("loaded");
  $("#pdfInfo").textContent = "슬라이드를 모두 읽었어요. 대본을 넣고 분석을 시작해 주세요.";
  try {
    const doc = await ensurePreviewDoc();
    const pg = await doc.getPage(1);
    const base = pg.getViewport({ scale: 1 });
    const w = 108, dpr = window.devicePixelRatio || 1;
    const vp = pg.getViewport({ scale: (w / base.width) * dpr });
    const off = document.createElement("canvas");
    off.width = vp.width;
    off.height = vp.height;
    await pg.render({ canvasContext: off.getContext("2d"), viewport: vp }).promise;
    if (!upSnap || !ok()) return;   // 그사이 시연이 멈췄으면 사용자의 화면을 건드리지 않는다
    const cv = $("#thumb");
    cv.width = off.width;
    cv.height = off.height;
    cv.style.width = w + "px";
    cv.style.height = base.height * (w / base.width) + "px";
    cv.getContext("2d").drawImage(off, 0, 0);
  } catch {}
}

async function sceneUpload(ok) {
  go("upload");
  snapUpload();
  await tell("가상의 공모전 발표 「동네 공유 우산」으로 큐잇의 여섯 단계를 차례로 보여드려요.", ok);
  if (!ok()) return false;

  // 발표 유형 고르기 (보여주기만 하고 사용자의 선택은 바꾸지 않는다)
  $$("#typeList .tp").forEach((b) => b.classList.toggle("on", b.dataset.type === deck.type));
  $("#typeInfo").innerHTML = typeInfoHtml(deck.type);
  spot(".typecard");
  await tell("1단계 준비예요. 먼저 발표 유형을 골라요. 여기서는 '공모전·투자 발표'를 골랐어요.", ok);
  if (!ok()) return false;

  // 자료 넣기
  spot("#upload .grid2");
  await tellWhile("슬라이드 PDF와 발표 대본을 넣어요. 대본이 없으면 비워 둬도 AI가 만들어 줘요.", ok, async () => {
    await showDemoPdf(ok);
    if (ok()) await typeInto($("#scriptBox"), DEMO_SCRIPT_TEXT, ok);
  });
  if (!ok()) return false;

  // 분석
  const btn = $("#analyzeBtn");
  btn.classList.add("demo-live");
  spot(btn);
  const total = deck.slides.length;
  await tellWhile("「AI 분석 시작」을 누르면 AI가 슬라이드를 한 장씩 읽어요. 실제로는 30초쯤 걸려서, 지금은 미리 분석해 둔 결과를 보여드려요.", ok, async () => {
    for (let i = 1; i <= total; i++) {
      if (!ok()) return;
      $("#analyzeMsg").textContent = `AI가 슬라이드를 읽고 있어요 (${i}/${total})`;
      await dwait(1300, ok);
    }
  });
  const done = ok();
  restoreUpload();
  return done;
}

async function sceneReview(ok) {
  go("review");
  const n = deck.slides.reduce((a, s) => a + s.items.length, 0);
  spot("#reviewList");
  await tell(`2단계 검토예요. AI가 슬라이드 ${deck.slides.length}장을 읽고, 발표에서 꼭 말해야 할 핵심 ${n}개를 뽑았어요.`, ok);
  if (!ok()) return false;
  const g = $("#gapBox .gaps");
  if (g) {
    spot(g);
    await tell("공모전 발표인데 심사위원이 기대하는 '차별점'이 자료에 없다는 것도 AI가 찾아냈어요.", ok);
    if (!ok()) return false;
  }
  spot("#reviewList .itemrow");
  await tell("AI가 틀릴 수 있어서, 발표자가 문구를 직접 고치거나 필요 없는 항목을 지울 수 있어요.", ok);
  return ok();
}

async function scenePractice(ok) {
  go("practice");
  applyMood();
  qaHistory = [];
  $("#qaLog").innerHTML = "";
  $("#answerBox").value = "";
  lastQuestion = DEMO_QA.question;
  addQ(lastQuestion);
  spot("#qaLog");
  await tell("3단계 연습이에요. AI가 심사위원이 되어 발표의 약한 곳을 물어요.", ok);
  if (!ok()) return false;

  spot("#practice .answer-wrap");
  await tellWhile("발표자가 직접 답해요. AI는 답변을 대신 써 주지 않아요.", ok, () => typeInto($("#answerBox"), DEMO_QA.answer, ok));
  if (!ok()) return false;

  $("#answerBox").value = "";
  addA(DEMO_QA.answer);
  addC(DEMO_QA.comment);
  qaHistory.push({ role: "발표자", text: DEMO_QA.answer });
  lastQuestion = DEMO_QA.followUp;
  qaHistory.push({ role: typeOf(deck.type).audience, text: lastQuestion });
  addQ(lastQuestion);
  spot("#qaLog");
  await tell("AI가 답변에서 약한 곳을 짚고 꼬리질문을 이어 가요. 이 대화는 미리 받아 둔 예시예요.", ok);
  return ok();
}

async function scenePresent(ok, base) {
  go("present");
  beginRun(true);
  const alive = () => base() && running && curStep === "present";
  for (const st of DEMO_SCRIPT) {
    if (!alive()) return false;
    const ms = st.wait ?? (st.cap ? readMs(st.cap) : 1200);
    if (st.cap) caption(st.cap, ms);
    if (st.say) await speak(st.say, alive);
    if (!alive()) return false;
    if (st.act === "next") move(1);
    else if (st.act === "stuck") showStuck();
    else if (st.act === "close") {
      $("#stuckPanel").classList.remove("on");
      paint();
    } else if (st.act === "late") {
      startTs = Date.now() - (goalSec - st.left) * 1000;   // 시간을 앞당긴다
    } else if (st.act === "end") {
      endRun();
      return true;
    }
    await dwait(ms, alive);
  }
  return true;
}

// 음성 인식 대신, 발표자가 말하는 문장을 낱말 단위로 흘려 넣는다
async function speak(text, alive) {
  let said = "";
  for (const w of text.split(" ")) {
    if (!alive()) return;
    said += (said ? " " : "") + w;
    buffers[cur] = (buffers[cur] + " " + w).slice(-4000);
    if (demoSkip) continue;
    $("#sttMsg").textContent = "🎙 " + said;
    paint();
    await dwait(280, alive);
  }
  $("#sttMsg").textContent = "🎙 " + said;
  paint();
}

async function sceneReport(ok) {
  if (curStep !== "report") go("report");
  spot("#reportBody .tiles");
  await tell("5단계 리포트예요. 걸린 시간, 놓친 핵심, 큐를 요청한 횟수가 기록으로 남아요.", ok);
  if (!ok()) return false;
  spot("#reportBody .coach");
  await tell("AI 코칭은 발표 기록을 읽고 잘한 점과 다음 연습에서 고칠 점을 알려줘요.", ok);
  return ok();
}

async function sceneQna(ok) {
  go("qna");
  $("#qInput").value = "";
  $("#qResult").innerHTML = "";
  spot("#qna .card");
  await tellWhile("6단계 질의응답이에요. 발표가 끝나고 받은 질문을 입력하거나 마이크로 받아 적어요.", ok, () => typeInto($("#qInput"), DEMO_ASK, ok));
  if (!ok()) return false;
  renderQna(DEMO_ASK);
  spot("#qResult");
  await tell("질문과 이어지는 슬라이드와 미리 준비한 핵심 단어를 찾아줘요. 답변은 발표자가 직접 해요.", ok);
  return ok();
}

const SCENES = [
  { id: "upload", run: sceneUpload },
  { id: "review", run: sceneReview },
  { id: "practice", run: scenePractice },
  { id: "present", run: scenePresent },
  { id: "report", run: sceneReport },
  { id: "qna", run: sceneQna },
];

async function autoDemo() {
  stopDemo();
  enterDemo();
  const my = ++demoToken;
  demoOn = true;
  document.body.classList.add("demo-on");
  setCapMode("play");
  const base = () => my === demoToken && !!deck?.demo;

  for (let i = 0; i < SCENES.length; i++) {
    const sc = SCENES[i];
    demoSkip = false;
    $("#demoStep").textContent = `시연 ${i + 1}/${SCENES.length} · ${STEPS[i].label}`;
    $("#demoNext").textContent = i < SCENES.length - 1 ? "다음 단계 ⏭" : "마치기 ⏭";
    const done = await sc.run(() => base() && curStep === sc.id, base);
    if (my !== demoToken) return;   // 그사이 멈췄거나 새 시연이 시작됐다
    clearSpot();
    if (!done) {
      // 보는 사람이 직접 다른 화면으로 옮겼다. 시연을 접고 그 화면을 그대로 둔다.
      stopDemo();
      return;
    }
  }

  // 끝 — 다음에 무엇을 할지 고르게 한다
  demoOn = false;
  demoSkip = false;
  demoEnded = true;
  $("#demoStep").textContent = "시연 끝";
  setCapMode("end");
  caption("시연이 끝났어요. 샘플로 직접 써 보거나, 내 자료로 바로 시작해 보세요.", 0);
}

// 시연을 접는다. 체험용 샘플 자료는 그대로 남아서 이어서 직접 써 볼 수 있다.
function stopDemo() {
  demoToken++;
  demoOn = false;
  demoSkip = false;
  demoEnded = false;
  setPaused(false);
  document.body.classList.remove("demo-on");
  hideCaption();
  clearSpot();
  restoreUpload();
}

$("#demoAuto").onclick = autoDemo;
$("#demoTry").onclick = tryDemo;
$("#demoPause").onclick = () => setPaused(!demoPaused);
$("#demoNext").onclick = () => {
  demoSkip = true;
  setPaused(false);
};
$("#demoStop").onclick = () => {
  stopDemo();
  if (running) endRun();
};
$("#demoEndTry").onclick = tryDemo;
$("#demoEndMine").onclick = exitDemo;
$("#demoEndAgain").onclick = autoDemo;

/* ══ 1. 업로드 ══════════════════════════ */
let pdfFile = null;
let slideTexts = [];

/* 발표 유형 고르기
   유형이 기본 시간, 꼭 전달할 내용, 질문하는 사람을 정한다. */
function renderTypes() {
  const box = $("#typeList");
  box.innerHTML = TYPE_KEYS.map((k) => {
    const t = TYPES[k];
    return `<button type="button" class="tp${k === ptype ? " on" : ""}" data-type="${k}">
      <span class="ic">${t.icon}</span><span class="nm">${esc(t.label)}</span>
      <span class="mn">기본 ${t.minutes}분</span>
    </button>`;
  }).join("");
  box.querySelectorAll(".tp").forEach((b) => (b.onclick = () => pickType(b.dataset.type)));

  const info = $("#typeInfo");
  if (!ptype) {
    info.textContent = "유형을 고르면 기본 시간, 꼭 전달할 내용, 질문하는 사람이 그 상황에 맞게 바뀌어요.";
  } else {
    info.innerHTML = typeInfoHtml(ptype);
  }
  applyType();
}

function typeInfoHtml(k) {
  const t = typeOf(k);
  return (
    `질문하는 사람 <b>${esc(t.audience)}</b> · 목표 시간 <b>${t.minutes}분</b><br>` +
    (t.must.length
      ? `이 유형에서 꼭 전달할 내용 ${t.must.map((m) => `<em>${esc(m)}</em>`).join("")}`
      : "정해진 틀이 없어요. AI가 자료에서 핵심을 찾아요.")
  );
}

function pickType(k) {
  ptype = typeKey(k);
  saveType(ptype);
  $("#goalMin").value = typeOf(ptype).minutes;
  renderTypes();
  updateAnalyzeBtn();
}

// 유형에 따라 바뀌는 화면 문구
function applyType() {
  const t = typeOf(deck?.type ?? ptype);   // 분석이 끝난 자료가 있으면 그 자료의 유형을 따른다
  $("#lvlAudience").textContent = t.audience;
  $("#qInput").placeholder = "예) " + t.qExample;
}

// PDF와 유형이 모두 있어야 분석을 시작할 수 있다
function updateAnalyzeBtn() {
  const hasPdf = slideTexts.length > 0;
  $("#analyzeBtn").disabled = !(hasPdf && ptype);
  if (hasPdf && !ptype) $("#analyzeMsg").textContent = "위에서 발표 유형을 골라 주세요.";
  else if ($("#analyzeMsg").textContent.startsWith("위에서")) $("#analyzeMsg").textContent = "";
}

const dz = $("#dropzone");

dz.onclick = (e) => {
  if (e.target.id === "pdfChange" || !dz.classList.contains("loaded")) $("#pdfFile").click();
};
dz.addEventListener("dragover", (e) => {
  e.preventDefault();
  dz.classList.add("over");
});
dz.addEventListener("dragleave", () => dz.classList.remove("over"));
dz.addEventListener("drop", (e) => {
  e.preventDefault();
  dz.classList.remove("over");
  const f = e.dataTransfer.files?.[0];
  if (f) handlePdf(f);
});
$("#pdfFile").onchange = (e) => {
  const f = e.target.files[0];
  if (f) handlePdf(f);
};

async function handlePdf(f) {
  if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
    $("#pdfInfo").textContent = "PDF 파일만 넣을 수 있어요. PowerPoint에서 PDF로 저장해 주세요.";
    return;
  }
  pdfFile = f;
  $("#pdfInfo").textContent = "읽는 중...";
  try {
    const buf = await f.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;

    slideTexts = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      slideTexts.push({ n: i, text: tc.items.map((t) => t.str).join(" ").trim() });
    }

    await drawThumb(doc);
    $("#pdfName").textContent = f.name;
    $("#pdfPages").textContent = `슬라이드 ${doc.numPages}장`;
    $("#dzIdle").hidden = true;
    $("#dzLoaded").hidden = false;
    dz.classList.add("loaded");
    $("#pdfInfo").textContent = "슬라이드를 모두 읽었어요. 대본을 넣고 분석을 시작해 주세요.";
    updateAnalyzeBtn();
    await savePdf(f);
  } catch (err) {
    $("#pdfInfo").textContent = "PDF를 읽지 못했어요: " + err.message;
  }
}

// 첫 장 미리보기 — 읽었다는 사실을 문장이 아니라 그림으로 보여준다
async function drawThumb(doc) {
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const cv = $("#thumb");
  const w = 108, dpr = window.devicePixelRatio || 1;
  const scale = w / base.width;
  const vp = page.getViewport({ scale: scale * dpr });
  cv.width = vp.width;
  cv.height = vp.height;
  cv.style.width = w + "px";
  cv.style.height = base.height * scale + "px";
  await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
}

// 응답 검사 — Netlify 타임아웃은 errorMessage 를 담은 JSON 으로 돌아온다
async function post(body) {
  const r = await fetch("/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await r.text();
  let d;
  try {
    d = JSON.parse(raw);
  } catch {
    throw new Error("서버가 예상과 다른 응답을 보냈어요. 배포 상태를 확인해 주세요.");
  }
  if (d.errorMessage || d.errorType) {
    throw new Error("처리 시간이 초과됐어요. 잠시 후 다시 시도해 주세요.");
  }
  if (d.error) throw new Error(d.error + (d.detail ? ` — ${d.detail.slice(0, 80)}` : ""));
  return d;
}

$("#analyzeBtn").onclick = async () => {
  const btn = $("#analyzeBtn");
  const msg = $("#analyzeMsg");
  btn.disabled = true;
  msg.textContent = "";
  const script = $("#scriptBox").value;

  try {
    const slides = [];
    for (let i = 0; i < slideTexts.length; i++) {
      btn.textContent = `슬라이드 ${i + 1}장째 읽는 중 · 전체 ${slideTexts.length}장`;
      const s = await post({
        mode: "slide",
        n: slideTexts[i].n,
        text: slideTexts[i].text,
        script,
        type: ptype,
      });
      if (!Array.isArray(s.items)) throw new Error("분석 결과 형식이 올바르지 않아요.");
      slides.push(s);
    }

    btn.textContent = "예상 질문을 만드는 중";
    const summary = slides
      .map((s) => `${s.n}. ${s.title}: ${s.items.map((i) => i.label).join(", ")}`)
      .join("\n");
    let q = { weakPoints: [], questions: { 일반: [], 검증: [], 압박: [] } };
    try {
      q = await post({ mode: "questions", summary, type: ptype });
    } catch {
      msg.textContent = "예상 질문은 만들지 못했지만 핵심 항목은 정상이에요.";
    }

    // 이 유형에 꼭 있어야 하는데 자료에서 찾지 못한 내용. 실패해도 나머지는 그대로 쓴다.
    // gaps: null 은 "확인하지 못함", [] 은 "빠진 내용 없음".
    let gaps = null;
    if (typeOf(ptype).must.length) {
      btn.textContent = "자료에 빠진 내용이 없는지 확인하는 중";
      const digest = slides
        .map((s, i) => `${s.n}. ${s.title}: ${s.items.map((it) => it.label).join(", ")} / ${slideTexts[i].text.slice(0, 220)}`)
        .join("\n");
      try {
        gaps = (await post({ mode: "gaps", summary: digest, type: ptype })).gaps || [];
      } catch {
        gaps = null;
      }
    }

    userDeck = null;
    hideCaption();
    previewKey = "";
    deck = {
      title: slides[0]?.title || "발표",
      type: ptype,
      slides,
      weakPoints: q.weakPoints || [],
      questions: q.questions || { 일반: [], 검증: [], 압박: [] },
      gaps,
    };
    persist();
    renderReview();
    go("review");
  } catch (e) {
    msg.textContent = "분석하지 못했어요: " + e.message;
  } finally {
    btn.textContent = "AI 분석 시작";
    updateAnalyzeBtn();
  }
};

/* ══ 2. 검토 ════════════════════════════ */
function renderReview() {
  if (!deck) return;
  renderGaps();
  const box = $("#reviewList");
  box.innerHTML = "";
  deck.slides.forEach((sl, si) => {
    const c = document.createElement("div");
    c.className = "slidecard";
    c.innerHTML = `<h3><span>슬라이드 ${sl.n}</span>${esc(sl.title)}</h3>`;
    sl.items.forEach((it, ii) => {
      const row = document.createElement("div");
      row.className = "itemrow";
      row.innerHTML =
        `<input type="text" value="${esc(it.label)}">
         <span class="seg">
           <button data-v="필수"${it.level === "필수" ? ' class="on"' : ""}>필수</button>
           <button data-v="선택"${it.level === "선택" ? ' class="on"' : ""}>선택</button>
         </span>
         <button class="del" title="삭제">✕</button>`;
      row.querySelector("input").oninput = (e) => {
        it.label = e.target.value;
        persist();
      };
      row.querySelectorAll(".seg button").forEach((b) => {
        b.onclick = () => {
          it.level = b.dataset.v;
          row.querySelectorAll(".seg button").forEach((x) => x.classList.remove("on"));
          b.classList.add("on");
          persist();
        };
      });
      row.querySelector(".del").onclick = () => {
        deck.slides[si].items.splice(ii, 1);
        persist();
        renderReview();
      };
      c.appendChild(row);
    });
    box.appendChild(c);
  });
}
// 자료에 빠진 내용 알림. AI 판단이 틀릴 수 있으므로 경고가 아니라 참고로 보여준다.
function renderGaps() {
  const box = $("#gapBox");
  const t = typeOf(deck.type);
  const tag = `<div class="typetag">${t.icon} ${esc(t.label)}</div>`;
  if (!t.must.length || !Array.isArray(deck.gaps)) {
    box.innerHTML = tag;
    return;
  }
  if (!deck.gaps.length) {
    box.innerHTML = `${tag}<div class="gaps ok"><h3>AI가 확인해 보니, 이 유형에서 꼭 전달할 내용이 자료에 모두 있어요</h3>
      <div class="gnote">${t.must.map(esc).join(" · ")}</div></div>`;
    return;
  }
  box.innerHTML = `${tag}<div class="gaps">
    <h3>${esc(iga(t.audience))} 기대하는데 AI가 자료에서 찾지 못한 내용</h3>
    <ul>${deck.gaps.map((g) => `<li><b>${esc(g.label)}</b>${g.tip ? " — " + esc(g.tip) : ""}</li>`).join("")}</ul>
    <div class="gnote">AI가 자료를 읽고 판단한 참고 의견이에요. 이미 넣은 내용이라면 넘어가도 돼요.</div>
  </div>`;
}

$("#toPractice").onclick = () => {
  renderPractice();
  go("practice");
};
$("#toPresent").onclick = () => go("present");

/* ══ 3. 연습 ════════════════════════════ */
let level = "검증";
let qaHistory = [];
let lastQuestion = "";
let cdTimer = null;

const MOOD = {
  일반: "편하게 답해 보세요. 이해를 확인하는 질문부터 시작해요.",
  검증: "근거와 방법을 검증하는 질문이 이어져요.",
  압박: "발표의 결론을 흔드는 질문이 들어와요. 30초 안에 답해 보세요.",
};

function applyMood() {
  document.body.classList.remove("mood-일반", "mood-검증", "mood-압박");
  if (curStep === "practice") document.body.classList.add("mood-" + level);
  $("#moodNote").textContent = MOOD[level] || "";
}

$$(".lvl").forEach(
  (b) =>
    (b.onclick = () => {
      $$(".lvl").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      level = b.dataset.level;
      qaHistory = [];
      renderPractice();
    })
);

function renderPractice() {
  if (!deck) return;
  applyMood();
  if (deck.weakPoints?.length) {
    $("#weak").style.display = "block";
    $("#weak").innerHTML =
      "<b>질문이 들어올 만한 약한 지점</b><br>" + deck.weakPoints.map((w) => "· " + esc(w)).join("<br>");
  }
  // 예전에 분석한 자료는 가운데 단계를 "교수님"으로 저장했다
  const pool = deck.questions?.[level] || (level === "검증" ? deck.questions?.["교수님"] : null) || [];
  lastQuestion = pool[Math.floor(Math.random() * pool.length)] || typeOf(deck.type).firstQuestion;
  $("#qaLog").innerHTML = "";
  addQ(lastQuestion);
}

// 한 글자씩 나타나게 — 툭 뜨는 것보다 누가 묻는 느낌이 난다
function addQ(t) {
  const d = document.createElement("div");
  d.className = "q";
  d.innerHTML = `<b>${esc(levelLabel(level, deck?.type))}</b><span class="body typing"></span>`;
  $("#qaLog").appendChild(d);
  const target = d.querySelector(".body");
  const speed = level === "압박" ? 26 : 18;
  let i = 0;
  const t2 = setInterval(() => {
    target.textContent = t.slice(0, ++i);
    d.scrollIntoView({ behavior: "smooth", block: "end" });
    if (i >= t.length) {
      clearInterval(t2);
      target.classList.remove("typing");
      startCountdown();
    }
  }, speed);
}

// 압박 모드에서만 제한 시간을 보여준다. 막지는 않는다.
function startCountdown() {
  clearInterval(cdTimer);
  const box = $("#countdown");
  if (level !== "압박") {
    box.hidden = true;
    return;
  }
  let left = 30;
  box.hidden = false;
  box.className = "countdown";
  $("#cdNum").textContent = left;
  cdTimer = setInterval(() => {
    left--;
    $("#cdNum").textContent = Math.max(left, 0);
    if (left <= 10) box.className = "countdown warn";
    if (left <= 0) {
      clearInterval(cdTimer);
      box.className = "countdown over";
      $("#cdNum").textContent = "0";
    }
  }, 1000);
}
function addA(t) {
  const d = document.createElement("div");
  d.className = "a";
  d.textContent = t;
  $("#qaLog").appendChild(d);
}
function addC(t) {
  const d = document.createElement("div");
  d.className = "c";
  d.textContent = t;
  $("#qaLog").appendChild(d);
}

$("#answerBtn").onclick = async () => {
  const a = $("#answerBox").value.trim();
  if (!a) return;
  clearInterval(cdTimer);
  $("#countdown").hidden = true;
  addA(a);
  $("#answerBox").value = "";
  qaHistory.push({ role: "발표자", text: a });
  const btn = $("#answerBtn");
  btn.disabled = true;
  btn.textContent = "생각 중";
  try {
    const ctx =
      (deck?.title || "") +
      "\n" +
      (deck?.slides || []).map((s) => `${s.n}. ${s.title}: ${s.items.map((i) => i.label).join(", ")}`).join("\n");
    const r = await fetch("/api/qa", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ level, type: typeKey(deck?.type), context: ctx, question: lastQuestion, answer: a, history: qaHistory }),
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    if (d.comment) addC(d.comment);
    lastQuestion = d.followUp || "다른 질문으로 넘어가겠습니다.";
    qaHistory.push({ role: typeOf(deck?.type).audience, text: lastQuestion });
    addQ(lastQuestion);
  } catch (e) {
    addC("질문 생성 실패: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "답변";
  }
};

/* ══ 4. 발표 ════════════════════════════ */
let cur = 0;               // 현재 슬라이드 index
let running = false;
let startTs = 0;
let goalSec = 420;
let buffers = [];          // 슬라이드별 음성 누적
let spoken = new Set();    // 전달된 항목 id
let stuckCount = 0;
let slideEnter = [];       // 슬라이드별 진입 시각
let slideSpent = [];       // 슬라이드별 소요
let recog = null;
let tick = null;
let rerouted = false;
let skipped = [];      // 건너뛴 슬라이드 번호
let checkedAt = new Map();   // 항목이 체크된 시각 (체크 표시가 톡 찍히는 움직임에 쓴다)

$("#openSlides").onclick = () => {
  window.open(deck?.demo ? "slides.html?demo=1" : "slides.html", "cueitSlides", "width=1280,height=760");
};

$("#startRun").onclick = () => beginRun(false);

// simulated: 체험 자동 시연. 마이크 대신 대본이 말한다.
function beginRun(simulated) {
  if (!deck) {
    $("#micMsg").textContent = "먼저 1단계에서 자료를 분석해 주세요.";
    return;
  }
  goalSec = Math.max(60, Number($("#goalMin").value || 7) * 60);
  cur = 0;
  running = true;
  rerouted = false;
  stuckCount = 0;
  skipped = [];
  stuckEcho = null;
  $("#skipBtn").hidden = true;
  spoken = new Set();
  checkedAt = new Map();
  buffers = deck.slides.map(() => "");
  slideSpent = deck.slides.map(() => 0);
  slideEnter = deck.slides.map(() => 0);
  startTs = Date.now();
  slideEnter[0] = startTs;

  document.body.classList.add("stage");   // 화면 전체가 어두워진다
  $("#preRun").style.display = "none";
  $("#runner").classList.add("on");
  ensureChannel();
  startConnWatch();
  sendSlide();
  paint();
  startClock();
  if (simulated) {
    $("#micDot").hidden = false;
    $("#sttMsg").textContent = "";
  } else startSTT();
}

function ensureChannel() {
  if (!channel) {
    channel = new BroadcastChannel("cueit-slides");
    channel.onmessage = (e) => {
      if (e.data?.type === "ready") {
        sendSlide();
        markConn(true);
      }
      if (e.data?.type === "pong") markConn(true);
      if (e.data?.type === "key") handleKey(e.data.key);
    };
  }
}

// 슬라이드 창이 살아 있는지 주기적으로 확인한다.
// 시연 중 창이 닫힌 걸 모르고 진행하는 사고를 막는다.
let lastPong = 0;
let connTimer = null;
function markConn(ok) {
  if (ok) lastPong = Date.now();
  const el = $("#connState");
  const on = Date.now() - lastPong < 5000;
  el.dataset.on = on ? "true" : "false";
  el.textContent = on ? "슬라이드 창 연결됨" : "슬라이드 창 없음";
}
function startConnWatch() {
  clearInterval(connTimer);
  connTimer = setInterval(() => {
    channel?.postMessage({ type: "ping" });
    markConn(false);
  }, 2500);
}
function sendSlide() {
  channel?.postMessage({ type: "goto", page: cur + 1 });
  drawPreview(cur + 1);
}

/* 발표자 화면의 현재 슬라이드 미리보기.
   슬라이드 창을 따로 열지 않아도(노트북 한 대로 연습할 때) 지금 어느 장인지 보인다. */
let previewDoc = null;
let previewKey = "";      // 어떤 자료를 불러왔는지: "demo" 또는 "user"
let previewJob = 0;

async function ensurePreviewDoc() {
  const key = deck?.demo ? "demo" : "user";
  if (previewKey !== key || !previewDoc) {
    const blob = key === "demo" ? await (await fetch(DEMO_PDF)).blob() : await loadPdf();
    if (!blob) throw new Error("no pdf");
    previewDoc = await pdfjsLib.getDocument({ data: await blob.arrayBuffer() }).promise;
    previewKey = key;
  }
  return previewDoc;
}

async function drawPreview(page) {
  const cv = $("#slidePrev");
  const job = ++previewJob;
  try {
    await ensurePreviewDoc();
    if (job !== previewJob) return;
    const pg = await previewDoc.getPage(Math.min(page, previewDoc.numPages));
    const base = pg.getViewport({ scale: 1 });
    const w = 360, dpr = window.devicePixelRatio || 1;
    const vp = pg.getViewport({ scale: (w / base.width) * dpr });
    const off = document.createElement("canvas");
    off.width = vp.width;
    off.height = vp.height;
    await pg.render({ canvasContext: off.getContext("2d"), viewport: vp }).promise;
    if (job !== previewJob) return;
    cv.width = off.width;
    cv.height = off.height;
    cv.style.width = w + "px";
    cv.getContext("2d").drawImage(off, 0, 0);
    cv.hidden = false;
  } catch {
    cv.hidden = true;
  }
}

/* 시계 + 시간 큐 판정 (남은 시간이 부족하면 꼭 말할 것만 추려 준다) */
function startClock() {
  clearInterval(tick);
  tick = setInterval(() => {
    if (!running || demoPaused) return;
    const el = Math.floor((Date.now() - startTs) / 1000);
    const left = goalSec - el;
    $("#clock").textContent = `${fmt(el)} / ${fmt(goalSec)}`;
    $("#clock").classList.toggle("over", left < 0);
    checkReroute(left);
  }, 1000);
}

function checkReroute(left) {
  // 남은 필수 항목의 예상 소요 합계
  let need = 0;
  const must = [];
  for (let i = cur; i < deck.slides.length; i++) {
    for (const it of deck.slides[i].items) {
      if (it.level !== "필수" || spoken.has(it.id)) continue;
      need += it.seconds;
      must.push(it.label);
    }
  }
  const skippable = [];
  for (let i = cur; i < deck.slides.length; i++) {
    for (const it of deck.slides[i].items) {
      if (it.level === "선택" && !spoken.has(it.id)) skippable.push(it.label);
    }
  }

  if (!rerouted && need > 0 && left < need * 1.15) {
    rerouted = true;
    showAlert(
      `⏱ ${fmt(Math.max(left, 0))} 남음 — 이것만`,
      skippable.length ? skippable.slice(0, 4).join(" · ") + " 은(는) 건너뜁니다" : "",
      must.slice(0, 3),
      0
    );
  }
  // 여유가 크면 선택 항목 복귀 안내(1회)
  if (rerouted && left > need * 2.2) {
    rerouted = false;
    $("#alertBox").innerHTML = "";
  }
  updateSkipBtn();
}

// 다음으로 가야 할 슬라이드 — 아직 말하지 않은 필수 항목이 있는 첫 슬라이드
function nextRequiredSlide() {
  for (let i = cur + 1; i < deck.slides.length; i++) {
    if (deck.slides[i].items.some((it) => it.level === "필수" && !spoken.has(it.id))) return i;
  }
  return -1;
}

function updateSkipBtn() {
  const btn = $("#skipBtn");
  const t = nextRequiredSlide();
  const gap = t - cur - 1; // 건너뛸 슬라이드 수
  if (rerouted && t > 0 && gap > 0) {
    btn.hidden = false;
    btn.textContent = `슬라이드 ${cur + 2}~${t} 건너뛰고 ${deck.slides[t].title}(으)로`;
  } else {
    btn.hidden = true;
  }
}

$("#skipBtn").onclick = () => {
  const t = nextRequiredSlide();
  if (t < 0 || t <= cur) return;
  for (let i = cur + 1; i < t; i++) skipped.push(deck.slides[i].n);
  slideSpent[cur] += Math.floor((Date.now() - (slideEnter[cur] || Date.now())) / 1000);
  cur = t;
  slideEnter[cur] = Date.now();
  sendSlide();
  paint();
  updateSkipBtn();
  showAlert(`건너뜀 — ${deck.slides[cur].title}(으)로 이동했어요`, "", [], 3000);
};

/* 슬라이드 이동 */
function move(d) {
  if (!running) return;
  const next = cur + d;
  if (next < 0 || next >= deck.slides.length) return;

  // 넘기기 직전 — 빠뜨린 필수 항목 큐
  if (d > 0) {
    const { missedRequired } = evaluateSlide(buffers[cur], deck.slides[cur], spoken);
    if (missedRequired.length) {
      showAlert(
        "아직 말하지 않은 내용이 있어요 — " + missedRequired.map((m) => m.label).join(", "),
        "돌아가지 말고 한 문장으로 보완하세요",
        [],
        demoOn ? 9000 : 4500
      );
    }
  }
  stuckEcho = null;
  slideSpent[cur] += Math.floor((Date.now() - (slideEnter[cur] || Date.now())) / 1000);
  cur = next;
  slideEnter[cur] = Date.now();
  sendSlide();
  paint();
  updateSkipBtn();
}

$("#nextBtn").onclick = () => move(1);
$("#prevBtn").onclick = () => move(-1);
$("#endBtn").onclick = () => endRun();
$("#stuckBtn").onclick = () => showStuck();
$("#spClose").onclick = () => {
  $("#stuckPanel").classList.remove("on");
  paint();
};

function handleKey(k) {
  if (!running) return;
  if (k === "ArrowRight" || k === "PageDown" || k === " ") move(1);
  else if (k === "ArrowLeft" || k === "PageUp") move(-1);
  else if (k === "b" || k === "B" || k === ".") showStuck();
  else if (k === "Escape") $("#stuckPanel").classList.remove("on");
}
document.addEventListener("keydown", (e) => {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
  if ([" ", "ArrowRight", "ArrowLeft", "PageDown", "PageUp"].includes(e.key)) e.preventDefault();
  handleKey(e.key);
});

/* 화면 갱신 */
function paint() {
  const sl = deck.slides[cur];
  $("#slideLabel").textContent = `슬라이드 ${sl.n} · ${sl.title}`;
  evaluateSlide(buffers[cur], sl, spoken);

  const ul = $("#itemList");
  ul.innerHTML = "";
  sl.items.forEach((it) => {
    const li = document.createElement("li");
    const done = spoken.has(it.id);
    // 방금 처음 체크된 항목만 한 번 톡 찍힌다. 화면을 다시 그려도 처음부터 되풀이하지 않는다.
    if (done && !checkedAt.has(it.id)) checkedAt.set(it.id, Date.now());
    const age = done ? Date.now() - checkedAt.get(it.id) : 0;
    const fresh = done && age < 1100;
    li.className = (done ? "done " : "") + (fresh ? "just " : "") + (it.level === "선택" ? "opt-item" : "");
    if (fresh) li.style.setProperty("--age", `-${age}ms`);
    li.innerHTML = `<span class="b">${done ? "✓" : "●"}</span><span>${esc(it.label)}</span>`;
    ul.appendChild(li);
  });

  const remain = sl.items.filter((i) => !spoken.has(i.id));
  const nl = $("#nextLine");

  if (stuckEcho && stuckEcho.slide === cur) {
    nl.classList.add("echo");
    nl.innerHTML = `<span class="echo-lbl">방금 확인한 문장</span>${esc(stuckEcho.line)}`;
    return;
  }
  nl.classList.remove("echo");
  nl.textContent = remain.length
    ? remain[0].label
    : cur + 1 < deck.slides.length
    ? `다음: ${deck.slides[cur + 1].title}`
    : "모두 전달했어요";
}

/* 큐 주세요 — 말이 막혔을 때 다음 문장을 보여준다 */
let stuckEcho = null;   // 큐로 본 문장 — 닫힌 뒤에도 자리에 남긴다

function showStuck() {
  if (!deck) return;
  stuckCount++;
  const sl = deck.slides[cur];
  const idx = currentLineIndex(buffers[cur], sl.lines);
  const line = sl.lines[idx + 1] || sl.lines[0] || "다음 내용을 이어서 설명하겠습니다.";
  const remain = sl.items.filter((i) => !spoken.has(i.id)).slice(0, 3);
  $("#spLine").textContent = line;
  $("#spKw").innerHTML = remain.length
    ? remain.map((r) => `<em>${esc(r.label)}</em>`).join("")
    : `<em>${esc(sl.title)}</em>`;
  stuckEcho = { slide: cur, line };
  $("#stuckPanel").classList.add("on");
}

/* 알림 */
let alertTimer = null;
function showAlert(title, sub, list, ms) {
  clearTimeout(alertTimer);
  const html =
    `<div class="al"><div class="t">${esc(title)}</div>` +
    (list?.length ? `<ol>${list.map((l) => `<li>${esc(l)}</li>`).join("")}</ol>` : "") +
    (sub ? `<div class="s">${esc(sub)}</div>` : "") +
    `</div>`;
  $("#alertBox").innerHTML = html;
  if (ms) alertTimer = setTimeout(() => ($("#alertBox").innerHTML = ""), ms);
}

/* 음성 인식 */
function startSTT() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    $("#sttMsg").textContent = "이 브라우저는 음성 인식을 지원하지 않아요. Chrome에서 열어 주세요.";
    return;
  }
  recog = new SR();
  recog.lang = "ko-KR";
  recog.continuous = true;
  recog.interimResults = true;
  recog.onstart = () => ($("#micDot").hidden = false);
  recog.onresult = (e) => {
    let add = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      add += e.results[i][0].transcript + " ";
    }
    buffers[cur] = (buffers[cur] + " " + add).slice(-4000);
    $("#sttMsg").textContent = add.trim().slice(-90);
    paint();
  };
  recog.onerror = (e) => {
    $("#micDot").hidden = true;
    if (e.error === "not-allowed") $("#sttMsg").textContent = "마이크 권한이 꺼져 있어요. 주소창 왼쪽 자물쇠에서 마이크를 허용해 주세요.";
  };
  recog.onend = () => {
    $("#micDot").hidden = true;
    if (running) {
      try {
        recog.start();
      } catch {}
    }
  };
  try {
    recog.start();
  } catch {}
}

/* 종료 + 리포트 */
function endRun() {
  running = false;
  clearInterval(tick);
  clearInterval(connTimer);
  $("#micDot").hidden = true;
  try {
    recog?.stop();
  } catch {}
  slideSpent[cur] += Math.floor((Date.now() - (slideEnter[cur] || Date.now())) / 1000);
  document.body.classList.remove("stage");
  $("#runner").classList.remove("on");
  $("#preRun").style.display = "block";
  $("#alertBox").innerHTML = "";
  $("#skipBtn").hidden = true;
  if (!demoOn) hideCaption();

  const total = Math.floor((Date.now() - startTs) / 1000);
  const missed = [];
  deck.slides.forEach((sl) => {
    sl.items.forEach((it) => {
      if (!spoken.has(it.id) && it.level === "필수") missed.push(`슬라이드 ${sl.n} — ${it.label}`);
    });
  });
  const rep = {
    at: new Date().toLocaleString("ko-KR"),
    total,
    goal: goalSec,
    missed,
    stuckCount,
    skipped: skipped.slice(),
    perSlide: deck.slides.map((s, i) => ({ n: s.n, t: slideSpent[i] || 0 })),
  };
  if (deck.demo) renderDemoReport(rep);
  else {
    lastRun = { at: rep.at, type: typeKey(deck.type), record: buildRecord(rep) };
    saveReport(rep);
    renderReports();
  }
  go("report");
}

/* ══ 발표 후 AI 코칭 ════════════════════
   발표 기록(전달한 핵심·놓친 핵심·시간·받아 적은 말)을 AI가 읽고 다음 연습을 위한 조언을 준다.
   기록이 AI로 전송되므로 자동으로 보내지 않고, 사용자가 버튼을 눌렀을 때만 보낸다. */
let lastRun = null;   // 방금 끝난 발표의 기록. 새로고침하면 사라진다.

function buildRecord(rep) {
  const L = [];
  L.push(`목표 시간 ${fmt(rep.goal)}, 실제 시간 ${fmt(rep.total)}`);
  L.push(`말이 막혀 도움(큐)을 요청한 횟수 ${rep.stuckCount}회`);
  L.push(`건너뛴 슬라이드: ${rep.skipped.length ? rep.skipped.join(", ") : "없음"}`);
  deck.slides.forEach((sl, i) => {
    const expect = sl.items.reduce((a, it) => a + (Number(it.seconds) || 0), 0);
    L.push(
      `\n슬라이드 ${sl.n} 「${sl.title}」 — 핵심을 말하는 데 예상 ${expect}초, 실제 머문 시간 ${slideSpent[i] || 0}초` +
        (rep.skipped.includes(sl.n) ? " (건너뜀)" : "")
    );
    sl.items.forEach((it) => L.push(` - [${spoken.has(it.id) ? "전달" : "놓침"}] ${it.label} (${it.level})`));
    const said = (buffers[i] || "").replace(/\s+/g, " ").trim().slice(-400);
    if (said) L.push(` 받아 적은 말: ${said}`);
  });
  return L.join("\n");
}

function coachHtml(c, note) {
  if (!c) return "";
  return `<div class="coach">
    <div class="coach-h">AI 코칭${note ? `<span>${esc(note)}</span>` : ""}</div>
    ${c.summary ? `<p class="coach-sum">${esc(c.summary)}</p>` : ""}
    <div class="coach-cols">
      <div><h4>잘한 점</h4>${
        c.good?.length ? `<ul>${c.good.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>` : `<p class="dim">기록에서 찾지 못했어요.</p>`
      }</div>
      <div><h4>다음에 고칠 점</h4>${
        c.fix?.length
          ? `<ul>${c.fix.map((f) => `<li><b>${esc(f.point)}</b>${f.how ? `<br>${esc(f.how)}` : ""}</li>`).join("")}</ul>`
          : `<p class="dim">크게 고칠 점이 없어요.</p>`
      }</div>
    </div>
    ${c.next ? `<div class="coach-next"><b>다음 연습에서 해볼 한 가지</b>${esc(c.next)}</div>` : ""}
    <div class="coach-note">AI가 발표 기록을 읽고 만든 참고 의견이에요. 점수를 매기거나 발표 문장을 대신 써 주지 않아요.</div>
  </div>`;
}

async function askCoach(btn) {
  if (!lastRun) return;
  const msg = $("#coachMsg");
  btn.disabled = true;
  btn.textContent = "AI가 발표 기록을 읽는 중";
  msg.textContent = "";
  try {
    const d = await post({ mode: "coach", type: lastRun.type, record: lastRun.record });
    updateLatestReport({ coach: d.coach });
    renderReports();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "AI 코칭 받기";
    msg.textContent = "코칭을 받지 못했어요: " + e.message;
  }
}

// 체험 결과는 저장하지 않고 이번 한 번만 보여준다
function renderDemoReport(rep) {
  $("#reportBody").innerHTML =
    `<div class="compare">체험 결과예요. 저장되지 않으며, 시연을 위해 발표 시간을 앞당겼어요.
       직접 발표하면 회차마다 기록이 쌓여 첫 연습과 비교할 수 있어요.</div>` +
    reportCard(rep, 0, 1) +
    coachHtml(DEMO_COACH, "샘플 발표로 미리 받아 둔 결과") +
    `<div class="row"><button class="primary" id="demoDone">체험 끝내고 내 자료로 시작하기</button>
       <button class="ghost" id="demoAgain">시연 다시 보기</button></div>`;
  $("#demoDone").onclick = exitDemo;
  $("#demoAgain").onclick = autoDemo;
}

function renderReports() {
  const all = loadReports();
  const box = $("#reportBody");
  if (!all.length) {
    box.innerHTML = `<p class="lead">아직 리포트가 없어요. 발표를 한 번 하면 만들어져요.</p>`;
    return;
  }

  let html = "";

  // 회차 비교 — 가장 최근과 가장 오래된 기록
  if (all.length >= 2) {
    const now = all[0], first = all[all.length - 1];
    const dm = first.missed.length - now.missed.length;
    const ds = first.stuckCount - now.stuckCount;
    const parts = [];
    if (dm > 0) parts.push(`놓친 핵심이 <b>${dm}개 줄었어요</b>`);
    else if (dm < 0) parts.push(`놓친 핵심이 ${-dm}개 늘었어요`);
    if (ds > 0) parts.push(`큐를 요청한 횟수가 <b>${ds}회 줄었어요</b>`);
    html += `<div class="compare">첫 연습(${all.length - 1}회 전)과 비교해 ${
      parts.length ? parts.join(", ") : "큰 변화가 없어요"
    }.</div>`;
  }

  html += all
    .map((r, i) => {
      let extra = "";
      if (r.coach) extra = coachHtml(r.coach, "");
      else if (i === 0 && lastRun && lastRun.at === r.at) {
        extra = `<div class="coach ask">
          <div class="coach-h">AI 코칭</div>
          <p class="coach-sum">AI가 이번 발표 기록을 읽고, 잘한 점과 다음 연습에서 고칠 점을 알려줘요.</p>
          <button class="primary" id="coachBtn">AI 코칭 받기</button>
          <div class="coach-note">누르면 전달한 핵심, 놓친 핵심, 시간, 받아 적은 말이 AI(Claude)로 전송돼요. 누르기 전에는 전송되지 않아요.</div>
          <div id="coachMsg" class="msg"></div>
        </div>`;
      }
      return reportCard(r, i, all.length) + extra;
    })
    .join("");
  box.innerHTML = html;
  const cb = $("#coachBtn");
  if (cb) cb.onclick = () => askCoach(cb);
}

function reportCard(r, i, total) {
  const over = r.total > r.goal;
  const diff = Math.abs(r.total - r.goal);
  const maxT = Math.max(1, ...r.perSlide.map((p) => p.t));
  const skippedSet = new Set(r.skipped || []);

  const bars = r.perSlide
    .map((p) => {
      const w = Math.round((p.t / maxT) * 100);
      const sk = skippedSet.has(p.n);
      return `<div class="barrow${sk ? " skip-row" : ""}">
        <span class="bn">슬라이드 ${p.n}</span>
        <span class="bt"><span class="bf" style="width:${w}%"></span></span>
        <span class="bv">${sk ? "건너뜀" : fmt(p.t)}</span>
      </div>`;
    })
    .join("");

  return `
  <div class="rep">
    <div class="rep-head">
      <h3>${i === 0 ? "가장 최근 발표" : `${i}회 전 발표`}</h3>
      <span class="when">${esc(r.at)}</span>
    </div>

    <div class="tiles">
      <div class="tile ${over ? "warn" : "good"}">
        <div class="tl">실제 시간</div>
        <div class="tv">${fmt(r.total)}</div>
        <div class="ts">목표 ${fmt(r.goal)} · ${fmt(diff)} ${over ? "초과" : "여유"}</div>
      </div>
      <div class="tile ${r.missed.length ? "warn" : "good"}">
        <div class="tl">놓친 필수 핵심</div>
        <div class="tv">${r.missed.length}<span style="font-size:1rem">건</span></div>
        <div class="ts">${r.missed.length ? "아래 목록 확인" : "모두 전달했어요"}</div>
      </div>
      <div class="tile ${r.stuckCount ? "warn" : "good"}">
        <div class="tl">큐 요청</div>
        <div class="tv">${r.stuckCount}<span style="font-size:1rem">회</span></div>
        <div class="ts">${(r.skipped || []).length ? `${r.skipped.length}개 슬라이드 건너뜀` : "건너뛴 슬라이드 없음"}</div>
      </div>
    </div>

    <div class="sec">
      <div class="sec-h">놓친 필수 핵심</div>
      ${
        r.missed.length
          ? `<ul class="misslist">${r.missed.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>`
          : `<div class="okline">없어요. 필수 항목을 모두 전달했어요.</div>`
      }
    </div>

    <div class="sec">
      <div class="sec-h">슬라이드별 소요 시간</div>
      <div class="bars">${bars}</div>
    </div>
  </div>`;
}

/* ══ 6. 질의응답 ════════════════════════ */
function qTokens(s) {
  return String(s)
    .split(/[\s.,!?"'()[\]·]+/)
    .map((w) => normalize(w))
    .filter((w) => w.length >= 2);
}

// 한국어는 조사·어미가 붙으므로 뒤를 최대 2자까지 잘라가며 대조한다.
// "213명으로" → "213명으" → "213명" 에서 일치.
function hitsIn(hay, t) {
  for (let cut = 0; cut <= 2; cut++) {
    const w = cut ? t.slice(0, -cut) : t;
    if (w.length >= 2 && hay.includes(w)) return true;
  }
  return false;
}

// 질문과 가장 관련 있는 슬라이드를 찾는다. 서버 호출 없음.
function findRelated(question) {
  if (!deck) return [];
  const qt = qTokens(question);
  if (!qt.length) return [];

  return deck.slides
    .map((sl) => {
      const hay = normalize(
        [sl.title, ...sl.items.map((i) => i.label + " " + (i.variants || []).join(" ") + " " + (i.keywords || []).join(" ")), ...(sl.lines || [])].join(" ")
      );
      let score = 0;
      for (const t of qt) if (hitsIn(hay, t)) score += t.length >= 3 ? 2 : 1;
      const lines = (sl.lines || []).filter((l) => {
        const n = normalize(l);
        return qt.some((t) => t.length >= 3 && hitsIn(n, t));
      });
      return { sl, score, lines };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function renderQna(question) {
  const box = $("#qResult");
  if (!deck) {
    box.innerHTML = `<div class="empty">먼저 1단계에서 발표 자료를 분석해 주세요.</div>`;
    return;
  }
  const hits = findRelated(question);
  if (!hits.length) {
    box.innerHTML = `<div class="empty">관련 슬라이드를 찾지 못했어요. 질문의 핵심 단어를 넣어 다시 찾아 주세요.</div>`;
    return;
  }
  box.innerHTML = hits
    .map(
      (h, i) => `
    <div class="hit${i === 0 ? " top" : ""}">
      <div class="hit-h">
        <span class="sn">슬라이드 ${h.sl.n}</span>
        <span class="st">${esc(h.sl.title)}</span>
        <button class="goto" data-n="${h.sl.n}">이 슬라이드 띄우기</button>
      </div>
      <div class="prep">${h.sl.items
        .map((it) => `<em>${esc(it.label)}</em>`)
        .join("")}</div>
      ${
        h.lines.length
          ? `<div class="quote">${h.lines.slice(0, 2).map(esc).join("<br>")}</div>`
          : ""
      }
    </div>`
    )
    .join("");

  box.querySelectorAll(".goto").forEach((b) => {
    b.onclick = () => {
      ensureChannel();
      channel.postMessage({ type: "goto", page: Number(b.dataset.n) });
      b.textContent = "띄웠어요";
      setTimeout(() => (b.textContent = "이 슬라이드 띄우기"), 1500);
    };
  });
}

$("#qFind").onclick = () => renderQna($("#qInput").value.trim());
$("#qInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") renderQna($("#qInput").value.trim());
});

$("#qMic").onclick = () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    $("#qMicMsg").textContent = "이 브라우저는 음성 인식을 지원하지 않아요.";
    return;
  }
  const rec = new SR();
  rec.lang = "ko-KR";
  rec.continuous = false;
  rec.interimResults = false;
  $("#qMicMsg").textContent = "듣고 있어요. 질문을 말해 주세요.";
  rec.onresult = (e) => {
    const t = e.results[0][0].transcript;
    $("#qInput").value = t;
    $("#qMicMsg").textContent = "";
    renderQna(t);
  };
  rec.onerror = () => ($("#qMicMsg").textContent = "알아듣지 못했어요. 다시 말해 주세요.");
  rec.onend = () => {
    if ($("#qMicMsg").textContent.startsWith("듣고")) $("#qMicMsg").textContent = "";
  };
  try {
    rec.start();
  } catch {}
};

/* ══ 유틸 ═══════════════════════════════ */
// 받침에 따라 "이/가"를 붙인다. 심사위원 → 심사위원이, 상사 → 상사가
function iga(word) {
  const c = String(word).charCodeAt(String(word).length - 1);
  const hasFinal = c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0;
  return word + (hasFinal ? "이" : "가");
}
function fmt(s) {
  s = Math.max(0, Math.floor(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/* ══ 초기화 ═════════════════════════════ */
/* ══ 초기화 ═════════════════════════════ */
// 음성 인식이 없는 브라우저에서만 주의를 보여준다.
// 크롬 사용자에게는 아무것도 뜨지 않는다.
function checkBrowser() {
  const ok = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  $("#browserWarn").hidden = ok;
}

(async function init() {
  checkBrowser();
  renderStepper();
  renderTypes();
  if (ptype) $("#goalMin").value = typeOf(ptype).minutes;
  go("upload");
  if (deck) {
    level = levelKey(level);
    renderReview();
    renderPractice();
    $("#analyzeMsg").textContent = "이전에 분석한 자료가 있어요. 2단계부터 이어서 할 수 있어요.";
  }
  renderReports();
  const blob = await loadPdf().catch(() => null);
  if (blob) $("#pdfInfo").textContent = "저장된 PDF가 있어요. 새 파일을 넣으면 바뀌어요.";

  // 주소 끝에 ?demo=auto 를 붙이면 자동 시연이, ?demo=try 를 붙이면 샘플 자료가 바로 열린다.
  // 공모전에 제출하는 링크 하나로 심사위원이 곧바로 시연을 볼 수 있게 한다.
  const mode = new URLSearchParams(location.search).get("demo");
  if (mode === "auto") autoDemo();
  else if (mode === "try") tryDemo();
})();
