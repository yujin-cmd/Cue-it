import { evaluateSlide, currentLineIndex, normalize } from "./match.js";
import { savePdf, loadPdf, saveDeck, loadDeck, saveReport, loadReports, saveType, loadType } from "./store.js";
import { TYPES, TYPE_KEYS, typeOf, typeKey, levelKey, levelLabel } from "./presets.js";
import { DEMO_DECK, DEMO_PDF, DEMO_SCRIPT } from "./demo/demo.js";

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
    $("#savedText").textContent = "아직 자료가 없습니다";
  }
}

/* ══ 화면 전환 ══════════════════════════ */
function go(id) {
  if (!running) document.body.classList.remove("stage");
  curStep = id;
  if (id !== "practice") {
    document.body.classList.remove("mood-일반", "mood-검증", "mood-압박");
    clearInterval(cdTimer);
    const cd = document.getElementById("countdown");
    if (cd) cd.hidden = true;
  }
  $$(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
  renderStepper();
  renderBlank(id);
  window.scrollTo(0, 0);
}

// 자료가 없을 때 빈 화면 대신 안내를 보여준다
const BLANK = {
  review: ["검토할 항목이 아직 없습니다", "1단계에서 슬라이드와 대본을 넣으면, AI가 뽑은 핵심 항목을 여기서 직접 고칠 수 있습니다."],
  practice: ["연습할 자료가 없습니다", "발표 내용을 알아야 청중처럼 질문할 수 있습니다. 먼저 자료를 넣어주십시오."],
  present: ["발표할 자료가 없습니다", "슬라이드와 핵심 항목이 준비되면 실전 화면이 열립니다."],
  qna: ["찾을 자료가 없습니다", "미리 준비한 근거가 있어야 질문에 맞는 슬라이드를 찾아드릴 수 있습니다."],
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
    <button class="primary">1단계로 가기</button>`;
  d.querySelector("button").onclick = () => go("upload");
  sec.appendChild(d);
}

// 분석 결과 저장. 체험용 샘플은 저장하지 않는다(사용자의 자료를 덮어쓰지 않도록).
function persist() {
  if (!deck?.demo) saveDeck(deck);
}

/* ══ 체험하기 ═══════════════════════════
   미리 분석해 둔 가상의 발표로 큐잇을 바로 써 본다. AI를 부르지 않는다.
   · 자동 시연: 말하기 → 빠뜨림 큐 → 큐 주세요 → 시간 큐 → 리포트를 40초 안에 보여준다
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
  demoToken++;
  if (running) endRun();
  hideCaption();
  deck = userDeck || loadDeck();
  userDeck = null;
  previewKey = "";
  applyType();
  $("#qResult").innerHTML = "";
  if (deck) {
    renderReview();
    renderPractice();
  }
  if (ptype) $("#goalMin").value = typeOf(ptype).minutes;
  renderReports();
  go("upload");
}

function tryDemo() {
  enterDemo();
  go("review");
}

function autoDemo() {
  enterDemo();
  go("present");
  beginRun(true);
  playDemo();
}

$("#demoAuto").onclick = autoDemo;
$("#demoTry").onclick = tryDemo;

let demoToken = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function playDemo() {
  const my = ++demoToken;
  const alive = () => my === demoToken && running;
  for (const st of DEMO_SCRIPT) {
    if (!alive()) return;
    if (st.cap) caption(st.cap);
    if (st.say) await speak(st.say, alive);
    if (!alive()) return;
    if (st.act === "next") move(1);
    else if (st.act === "stuck") showStuck();
    else if (st.act === "close") {
      $("#stuckPanel").classList.remove("on");
      paint();
    } else if (st.act === "late") {
      startTs = Date.now() - (goalSec - st.left) * 1000;   // 시간을 앞당긴다
    } else if (st.act === "end") {
      endRun();
      return;
    }
    await sleep(st.wait ?? 1200);
  }
}

// 음성 인식 대신, 발표자가 말하는 문장을 낱말 단위로 흘려 넣는다
async function speak(text, alive) {
  let said = "";
  for (const w of text.split(" ")) {
    if (!alive()) return;
    said += (said ? " " : "") + w;
    buffers[cur] = (buffers[cur] + " " + w).slice(-4000);
    $("#sttMsg").textContent = "🎙 " + said;
    paint();
    await sleep(190);
  }
}

function caption(t) {
  $("#demoCapText").textContent = t;
  $("#demoCap").hidden = false;
}
function hideCaption() {
  $("#demoCap").hidden = true;
}
$("#demoStop").onclick = () => {
  demoToken++;
  hideCaption();
  if (running) endRun();
};

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
    info.textContent = "유형을 고르면 기본 시간, 꼭 전달할 내용, 질문하는 사람이 그 상황에 맞게 바뀝니다.";
  } else {
    const t = typeOf(ptype);
    info.innerHTML =
      `질문하는 사람 <b>${esc(t.audience)}</b> · 목표 시간 <b>${t.minutes}분</b><br>` +
      (t.must.length
        ? `이 유형에서 꼭 전달할 내용 ${t.must.map((m) => `<em>${esc(m)}</em>`).join("")}`
        : "정해진 틀이 없습니다. AI가 자료에서 핵심을 찾습니다.");
  }
  applyType();
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
  if (hasPdf && !ptype) $("#analyzeMsg").textContent = "위에서 발표 유형을 골라주십시오.";
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
    $("#pdfInfo").textContent = "PDF 파일만 넣을 수 있습니다. PowerPoint에서 PDF로 저장해 주십시오.";
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
    $("#pdfInfo").textContent = "슬라이드를 모두 읽었습니다. 대본을 넣고 분석을 시작하십시오.";
    updateAnalyzeBtn();
    await savePdf(f);
  } catch (err) {
    $("#pdfInfo").textContent = "PDF를 읽지 못했습니다: " + err.message;
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
    throw new Error("서버가 예상과 다른 응답을 보냈습니다. 배포 상태를 확인하십시오.");
  }
  if (d.errorMessage || d.errorType) {
    throw new Error("함수 실행 시간이 초과되었습니다. 잠시 후 다시 시도해 주십시오.");
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
      if (!Array.isArray(s.items)) throw new Error("분석 결과 형식이 올바르지 않습니다.");
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
      msg.textContent = "예상 질문 생성은 실패했지만 핵심 항목은 정상입니다.";
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
    msg.textContent = "분석에 실패했습니다: " + e.message;
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
    box.innerHTML = `${tag}<div class="gaps ok"><h3>이 유형에서 꼭 전달할 내용이 자료에 모두 있습니다</h3>
      <div class="gnote">${t.must.map(esc).join(" · ")}</div></div>`;
    return;
  }
  box.innerHTML = `${tag}<div class="gaps">
    <h3>${esc(iga(t.audience))} 기대하는데 자료에서 찾지 못한 내용</h3>
    <ul>${deck.gaps.map((g) => `<li><b>${esc(g.label)}</b>${g.tip ? " — " + esc(g.tip) : ""}</li>`).join("")}</ul>
    <div class="gnote">AI가 자료를 읽고 판단한 참고 의견입니다. 이미 넣은 내용이라면 넘어가셔도 됩니다.</div>
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
  일반: "편하게 답해보십시오. 이해를 확인하는 질문부터 시작합니다.",
  검증: "근거와 방법을 검증하는 질문이 이어집니다.",
  압박: "발표의 결론을 흔드는 질문이 들어옵니다. 30초 안에 답해보십시오.",
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

$("#openSlides").onclick = () => {
  window.open(deck?.demo ? "slides.html?demo=1" : "slides.html", "cueitSlides", "width=1280,height=760");
};

$("#startRun").onclick = () => beginRun(false);

// simulated: 체험 자동 시연. 마이크 대신 대본이 말한다.
function beginRun(simulated) {
  if (!deck) {
    $("#micMsg").textContent = "먼저 1단계에서 자료를 분석하십시오.";
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

async function drawPreview(page) {
  const cv = $("#slidePrev");
  const key = deck?.demo ? "demo" : "user";
  const job = ++previewJob;
  try {
    if (previewKey !== key) {
      const blob = key === "demo" ? await (await fetch(DEMO_PDF)).blob() : await loadPdf();
      if (!blob) throw new Error("no pdf");
      previewDoc = await pdfjsLib.getDocument({ data: await blob.arrayBuffer() }).promise;
      previewKey = key;
    }
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
    if (!running) return;
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
  showAlert(`건너뜀 — ${deck.slides[cur].title}(으)로 이동했습니다`, "", [], 3000);
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
        "아직 전달하지 않은 내용이 있습니다 — " + missedRequired.map((m) => m.label).join(", "),
        "돌아가지 말고 한 문장으로 보완하세요",
        [],
        4500
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
    li.className = (done ? "done " : "") + (it.level === "선택" ? "opt-item" : "");
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
    : "모두 전달했습니다";
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
    $("#sttMsg").textContent = "이 브라우저는 음성 인식을 지원하지 않습니다. Chrome을 사용하십시오.";
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
    if (e.error === "not-allowed") $("#sttMsg").textContent = "마이크 권한이 거부되었습니다.";
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
  hideCaption();

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
    saveReport(rep);
    renderReports();
  }
  go("report");
}

// 체험 결과는 저장하지 않고 이번 한 번만 보여준다
function renderDemoReport(rep) {
  $("#reportBody").innerHTML =
    `<div class="compare">체험 결과입니다. 저장되지 않으며, 시연을 위해 발표 시간을 앞당겼습니다.
       직접 발표하면 회차마다 기록이 쌓여 첫 연습과 비교할 수 있습니다.</div>` +
    reportCard(rep, 0, 1) +
    `<div class="row"><button class="primary" id="demoDone">체험 끝내고 내 자료로 시작하기</button>
       <button class="ghost" id="demoAgain">시연 다시 보기</button></div>`;
  $("#demoDone").onclick = exitDemo;
  $("#demoAgain").onclick = autoDemo;
}

function renderReports() {
  const all = loadReports();
  const box = $("#reportBody");
  if (!all.length) {
    box.innerHTML = `<p class="lead">아직 리포트가 없습니다. 발표를 한 번 진행하면 생성됩니다.</p>`;
    return;
  }

  let html = "";

  // 회차 비교 — 가장 최근과 가장 오래된 기록
  if (all.length >= 2) {
    const now = all[0], first = all[all.length - 1];
    const dm = first.missed.length - now.missed.length;
    const ds = first.stuckCount - now.stuckCount;
    const parts = [];
    if (dm > 0) parts.push(`놓친 핵심이 <b>${dm}개 줄었습니다</b>`);
    else if (dm < 0) parts.push(`놓친 핵심이 ${-dm}개 늘었습니다`);
    if (ds > 0) parts.push(`큐를 요청한 횟수가 <b>${ds}회 줄었습니다</b>`);
    html += `<div class="compare">첫 연습(${all.length}회 전)과 비교해 ${
      parts.length ? parts.join(", ") : "큰 변화가 없습니다"
    }.</div>`;
  }

  html += all.map((r, i) => reportCard(r, i, all.length)).join("");
  box.innerHTML = html;
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
        <div class="ts">${r.missed.length ? "아래 목록 확인" : "모두 전달했습니다"}</div>
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
          : `<div class="okline">없습니다. 필수 항목을 모두 전달했습니다.</div>`
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
    box.innerHTML = `<div class="empty">먼저 1단계에서 발표 자료를 분석하십시오.</div>`;
    return;
  }
  const hits = findRelated(question);
  if (!hits.length) {
    box.innerHTML = `<div class="empty">관련 슬라이드를 찾지 못했습니다. 질문의 핵심 단어를 넣어 다시 시도하십시오.</div>`;
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
      b.textContent = "띄웠습니다";
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
    $("#qMicMsg").textContent = "이 브라우저는 음성 인식을 지원하지 않습니다.";
    return;
  }
  const rec = new SR();
  rec.lang = "ko-KR";
  rec.continuous = false;
  rec.interimResults = false;
  $("#qMicMsg").textContent = "듣고 있습니다. 질문을 말씀하십시오.";
  rec.onresult = (e) => {
    const t = e.results[0][0].transcript;
    $("#qInput").value = t;
    $("#qMicMsg").textContent = "";
    renderQna(t);
  };
  rec.onerror = () => ($("#qMicMsg").textContent = "인식하지 못했습니다. 다시 시도하십시오.");
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
    $("#analyzeMsg").textContent = "이전에 분석한 자료가 있습니다. 2단계부터 이어서 진행할 수 있습니다.";
  }
  renderReports();
  const blob = await loadPdf().catch(() => null);
  if (blob) $("#pdfInfo").textContent = "저장된 PDF가 있습니다. 새 파일을 넣으면 교체됩니다.";

  // 주소 끝에 ?demo=auto 를 붙이면 자동 시연이, ?demo=try 를 붙이면 샘플 자료가 바로 열린다.
  // 공모전에 제출하는 링크 하나로 심사위원이 곧바로 시연을 볼 수 있게 한다.
  const mode = new URLSearchParams(location.search).get("demo");
  if (mode === "auto") autoDemo();
  else if (mode === "try") tryDemo();
})();
