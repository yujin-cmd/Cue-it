import { typeOf, LEVEL_GUIDE } from "../../public/presets.js";

// 발표 전 분석. Netlify 함수의 10초 제한 때문에 한 번에 한 슬라이드씩만 처리한다.
// mode: "slide"     → 그 슬라이드의 핵심 항목과 대본 문장
// mode: "questions" → 취약 논리와 난이도별 예상 질문
// mode: "gaps"      → 발표 유형에 꼭 있어야 하는데 자료에서 찾지 못한 내용
// mode: "coach"     → 발표가 끝난 뒤, 발표 기록을 읽고 다음 연습을 위한 코칭
// mode: "find"      → 질의응답. 받은 질문과 뜻이 가까운 슬라이드를 고른다 (답변은 쓰지 않는다)
//
// type: 발표 유형(면접 발표, 업무 보고 등). public/presets.js 의 정의를 그대로 쓴다.
// 유형 이름을 화면에서 받은 글자 그대로 프롬프트에 넣지 않고, 서버에 있는 정의에서 꺼내 쓴다.
//
// 모델 선택 주의: 10초 안에 끝나야 하므로 빠른 모델을 쓴다.
// Netlify 유료 플랜에서 함수 타임아웃을 26초로 늘렸다면 claude-sonnet-5 로 바꿔도 된다.
const MODEL = "claude-haiku-4-5-20251001";

// 유형별 안내문. 프롬프트 맨 앞에 붙는다.
function typeBrief(t) {
  return (
    `발표 유형: ${t.label}\n발표자: ${t.speaker}\n청중: ${t.audience}\n` +
    (t.must.length
      ? `이 유형에서 청중이 꼭 듣고 싶어 하는 내용: ${t.must.join(", ")}`
      : "정해진 틀이 없는 발표입니다. 자료 자체에서 핵심을 찾습니다.")
  );
}

const sysSlide = (t) => `당신은 발표를 준비시키는 분석 엔진입니다.
슬라이드 한 장의 텍스트와 발표 대본을 받아, 발표 중 실시간으로 대조할 데이터를 만듭니다.

${typeBrief(t)}

반드시 아래 JSON만 출력하십시오. 설명, 인사말, 마크다운 코드펜스 금지.

{
  "title": "슬라이드 제목(15자 이내)",
  "items": [
    {
      "label": "표본 213명",
      "level": "필수",
      "seconds": 12,
      "variants": ["213명", "이백십삼 명", "213 명", "213부", "213개"],
      "keywords": ["213", "표본"]
    }
  ],
  "lines": ["이 슬라이드에서 말할 대본 문장 1", "문장 2"]
}

규칙:
1. items는 2~3개. "반드시 입으로 말해야 전달되는 정보"만 넣습니다.
   숫자, 대상, 방법, 기간, 조건, 한계, 결론처럼 빠뜨리면 손해인 것 위주.
   슬라이드 제목이나 장식 문구는 항목이 아닙니다.
   위 "청중이 꼭 듣고 싶어 하는 내용"에 해당하는 정보가 이 슬라이드에 있으면 먼저 항목으로 삼고 "필수"로 둡니다.
   슬라이드에 없는 내용을 지어내서 항목으로 만들지 않습니다.
2. level은 "필수" 또는 "선택". 빠뜨리면 발표가 불완전해지는 것만 "필수"로 하고,
   필수는 3개를 넘지 않게 합니다.
3. seconds는 그 항목을 말하는 데 걸리는 예상 시간(초). 한국어 발표 분당 300자 기준.
4. variants는 5개. 발표자가 실제로 말할 법한 표현을 넣습니다.
   - 숫자 표기 변형: "2주", "2주간", "두 주", "14일"
   - 조사 변형: "213명을", "213명입니다"
   - 동의 표현: "온라인 설문", "인터넷 설문"
   못 잡는 것보다 틀리게 잡는 것이 훨씬 나쁘므로 변형을 넉넉히 넣습니다.
5. keywords는 핵심 단어 2개.
6. lines는 이 슬라이드에서 말할 대본 문장 6개 이내. 원문을 말하는 순서 그대로 옮깁니다.
   발표자가 말이 막혔을 때 이어서 말할 문장으로 보여주므로, 한 문장씩 나누어 넣습니다.
   대본이 없으면 슬라이드 텍스트로 발표 문장을 직접 만듭니다.
7. 모든 출력은 한국어. 매우 간결하게. 전체 응답이 길어지면 안 됩니다.`;

const sysQ = (t) => `당신은 발표를 듣는 ${t.audience}입니다.
발표 전체의 요약을 받아, ${t.audience}의 입장에서 취약한 논리와 예상 질문을 만듭니다.

${typeBrief(t)}

반드시 아래 JSON만 출력하십시오. 코드펜스 금지.

{
  "weakPoints": ["논리적으로 취약한 지점", "..."],
  "questions": {
    "일반": ["질문 4개"],
    "검증": ["질문 4개"],
    "압박": ["질문 4개"]
  }
}

난이도:
- 일반: ${LEVEL_GUIDE.일반}
- 검증: ${LEVEL_GUIDE.검증}
- 압박: ${LEVEL_GUIDE.압박}
질문은 실제 ${t.audience}이(가) 이 발표를 듣고 물을 법한 것으로, 발표 내용에 근거해 구체적으로 만듭니다.
weakPoints는 3개 이내. 모든 출력은 한국어.`;

const sysGap = (t) => `당신은 발표 자료를 점검하는 분석 엔진입니다.

${typeBrief(t)}

발표 전체의 요약을 받아, 위 "청중이 꼭 듣고 싶어 하는 내용" 각각이 자료에 들어 있는지 확인합니다.
자료에서 찾지 못한 것만 gaps에 넣습니다.

반드시 아래 JSON만 출력하십시오. 코드펜스 금지.

{
  "gaps": [
    { "label": "차별점", "tip": "기존 방법과 무엇이 다른지 한 문장을 추가해 보십시오." }
  ]
}

규칙:
1. label은 반드시 다음 중 하나를 글자 그대로 씁니다: ${t.must.join(", ")}
2. 표현이 달라도 같은 뜻의 내용이 자료에 있으면 "있는 것"으로 봅니다. 그 경우 gaps에 넣지 않습니다.
3. 있는지 없는지 확신이 서지 않으면 넣지 않습니다. 없는 것을 있다고 하는 것보다, 있는 것을 없다고 하는 것이 더 나쁩니다.
4. tip은 무엇을 보충하면 되는지 한 문장으로 씁니다. 발표 내용을 대신 써 주지 않습니다.
5. 빠진 것이 없으면 "gaps": [] 를 출력합니다. 모든 출력은 한국어.`;

const sysCoach = (t) => `당신은 발표 연습을 돕는 코치입니다.

${typeBrief(t)}

발표 한 번의 기록을 받아, 다음 연습에 바로 쓸 수 있는 코칭을 합니다.
기록에는 목표 시간과 실제 시간, 슬라이드별로 전달한 핵심과 놓친 핵심, 머문 시간, 말이 막혀 도움을 요청한 횟수, 음성 인식으로 받아 적은 말이 들어 있습니다.

반드시 아래 JSON만 출력하십시오. 코드펜스 금지.

{
  "summary": "이번 발표를 한 문장으로 정리",
  "good": ["잘한 점"],
  "fix": [{ "point": "고칠 점", "how": "어떻게 연습하면 되는지" }],
  "next": "다음 연습에서 해볼 한 가지"
}

규칙:
1. 기록에 있는 사실만 근거로 삼습니다. 기록에 없는 것을 짐작해서 말하지 않습니다.
2. 점수나 등급을 매기지 않습니다.
3. 발표 문장이나 답변을 대신 써 주지 않습니다. how에는 연습 방법만 씁니다.
4. 받아 적은 말은 음성 인식 결과라서 같은 말이 겹치거나 틀린 글자가 있을 수 있습니다. 발음, 말투, 맞춤법은 지적하지 않습니다.
5. 놓친 필수 핵심, 시간이 예상보다 크게 밀린 슬라이드, 말이 막힌 횟수를 우선으로 봅니다.
6. good은 2개 이내, fix는 3개 이내. 고칠 점이 없으면 fix는 빈 배열로 둡니다.
7. 각 항목은 한 문장. 발표자를 격려하는 따뜻한 말투의 한국어("~해요"체)로 씁니다.`;

const sysFind = (t) => `당신은 발표 질의응답을 돕는 검색 도우미입니다.

${typeBrief(t)}

발표가 끝나고 청중이 한 질문과, 발표 슬라이드 목록을 받습니다.
발표자가 답할 때 근거로 쓸 수 있는 슬라이드를 고릅니다.

반드시 아래 JSON만 출력하십시오. 코드펜스 금지.

{
  "hits": [{ "n": 3, "why": "정류장 10곳·3개월 시범 운영이 나오는 장" }],
  "none": ""
}

규칙:
1. 질문의 낱말이 슬라이드와 달라도 뜻이 같으면 찾습니다. 예: "돌려주지 않으면"과 "반납", "몇 군데에서 시험"과 "10곳에서 시범 운영".
2. hits는 관련이 큰 순서로 3개 이내. n은 목록에 있는 슬라이드 번호만 씁니다.
3. why는 그 슬라이드에 질문과 관련된 무엇이 있는지 30자 이내의 한 구절로 씁니다.
4. 답변을 대신 쓰지 않습니다. why에 "~라고 답하세요" 같은 말을 넣지 않습니다.
5. 자료에 답할 근거가 없으면 hits를 빈 배열로 두고, none에 "자료에 분실 비용에 대한 내용이 없어요"처럼 한 문장을 씁니다.
   억지로 비슷한 슬라이드를 고르지 않습니다.
6. 모든 출력은 한국어.`;

export default async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: "ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다." }, 500);

  let b;
  try {
    b = await req.json();
  } catch {
    return json({ error: "잘못된 요청 형식입니다." }, 400);
  }

  try {
    const t = typeOf(b.type);
    if (b.mode === "questions") return await questions(key, b, t);
    if (b.mode === "gaps") return await gaps(key, b, t);
    if (b.mode === "coach") return await coach(key, b, t);
    if (b.mode === "find") return await find(key, b, t);
    return await slide(key, b, t);
  } catch (e) {
    return json(
      {
        error: e.snippet
          ? `AI 응답을 해석하지 못했습니다 (${e.stopReason || "형식 오류"})`
          : "서버 오류: " + e.message,
        detail: e.snippet || "",
      },
      502
    );
  }
};

async function slide(key, b, t) {
  const n = Number(b.n) || 1;
  const text = String(b.text || "").slice(0, 1800);
  const script = String(b.script || "").slice(0, 6000);

  const user =
    `## 슬라이드 ${n} 텍스트\n${text || "(텍스트 없음)"}\n\n` +
    `## 발표 대본 전체\n${script || "(대본 없음 — 슬라이드 텍스트로 발표 문장을 직접 작성)"}\n\n` +
    `위 대본 중 슬라이드 ${n}에 해당하는 부분만 골라 lines에 넣으십시오.`;

  const p = await call(key, sysSlide(t), user, 3000);

  return json({
    n,
    title: String(p.title || `슬라이드 ${n}`).slice(0, 40),
    lines: (Array.isArray(p.lines) ? p.lines : []).map(String).slice(0, 8),
    items: (Array.isArray(p.items) ? p.items : []).slice(0, 6).map((it, k) => ({
      id: `s${n}i${k}`,
      label: String(it.label || "").slice(0, 60),
      level: it.level === "선택" ? "선택" : "필수",
      seconds: Number(it.seconds) > 0 ? Number(it.seconds) : 10,
      variants: (Array.isArray(it.variants) ? it.variants : []).map(String).slice(0, 12),
      keywords: (Array.isArray(it.keywords) ? it.keywords : []).map(String).slice(0, 6),
    })),
  });
}

async function questions(key, b, t) {
  let p;
  try {
    p = await call(key, sysQ(t), `## 발표 요약\n${String(b.summary || "").slice(0, 6000)}`, 2500);
  } catch {
    return json({ weakPoints: [], questions: { 일반: [], 검증: [], 압박: [] } });
  }
  const list = (v) => (Array.isArray(v) ? v : []).map(String).slice(0, 6);
  return json({
    weakPoints: (Array.isArray(p.weakPoints) ? p.weakPoints : []).map(String).slice(0, 5),
    questions: {
      일반: list(p.questions?.일반),
      검증: list(p.questions?.검증),
      압박: list(p.questions?.압박),
    },
  });
}

// 유형에 꼭 있어야 하는 내용 중 자료에서 찾지 못한 것.
// 유형에 정해진 내용이 없으면(자유 형식) AI를 부르지 않는다.
async function gaps(key, b, t) {
  if (!t.must.length) return json({ gaps: [] });
  const p = await call(key, sysGap(t), `## 발표 요약\n${String(b.summary || "").slice(0, 6000)}`, 800);
  const seen = new Set();
  const out = [];
  for (const g of Array.isArray(p.gaps) ? p.gaps : []) {
    const label = String(g?.label || "").trim();
    // 유형에 정의된 항목만 받는다. 모델이 다른 말을 지어내면 버린다.
    if (!t.must.includes(label) || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, tip: String(g?.tip || "").slice(0, 120) });
  }
  return json({ gaps: out });
}

// 발표 후 코칭. 화면이 만든 발표 기록(글자)을 읽는다.
async function coach(key, b, t) {
  const record = String(b.record || "").slice(0, 6000);
  if (!record.trim()) return json({ error: "발표 기록이 비어 있습니다." }, 400);
  const p = await call(key, sysCoach(t), `## 발표 기록\n${record}`, 1000);
  const str = (v, n) => String(v || "").slice(0, n);
  return json({
    coach: {
      summary: str(p.summary, 200),
      good: (Array.isArray(p.good) ? p.good : []).map((g) => str(g, 160)).filter(Boolean).slice(0, 2),
      fix: (Array.isArray(p.fix) ? p.fix : [])
        .map((f) => ({ point: str(f?.point, 120), how: str(f?.how, 200) }))
        .filter((f) => f.point)
        .slice(0, 3),
      next: str(p.next, 200),
    },
  });
}

// 질의응답 검색. 화면이 보낸 슬라이드 요약(제목·핵심·대본 문장) 안에서만 고른다.
async function find(key, b, t) {
  const question = String(b.question || "").trim().slice(0, 300);
  if (!question) return json({ error: "질문이 비어 있습니다." }, 400);
  const slides = (Array.isArray(b.slides) ? b.slides : []).slice(0, 60).map((s) => ({
    n: Number(s?.n) || 0,
    title: String(s?.title || "").slice(0, 60),
    items: (Array.isArray(s?.items) ? s.items : []).map((x) => String(x).slice(0, 80)).slice(0, 6),
    lines: (Array.isArray(s?.lines) ? s.lines : []).map((x) => String(x).slice(0, 160)).slice(0, 6),
  })).filter((s) => s.n > 0);
  if (!slides.length) return json({ error: "슬라이드 정보가 없습니다." }, 400);

  const list = slides
    .map((s) => `[${s.n}] ${s.title}\n핵심: ${s.items.join(" / ") || "없음"}\n대본: ${s.lines.join(" ") || "없음"}`)
    .join("\n\n")
    .slice(0, 9000);
  const p = await call(key, sysFind(t), `## 질문\n${question}\n\n## 슬라이드 목록\n${list}`, 400);

  // 목록에 없는 번호는 버린다. 같은 번호가 두 번 나오면 한 번만 쓴다.
  const known = new Set(slides.map((s) => s.n));
  const seen = new Set();
  const hits = [];
  for (const h of Array.isArray(p.hits) ? p.hits : []) {
    const n = Number(h?.n);
    if (!known.has(n) || seen.has(n)) continue;
    seen.add(n);
    hits.push({ n, why: String(h?.why || "").slice(0, 60) });
    if (hits.length === 3) break;
  }
  return json({ hits, none: hits.length ? "" : String(p.none || "").slice(0, 100) });
}

async function call(key, system, user, maxTokens) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [
        { role: "user", content: user },
        { role: "assistant", content: "{" }, // JSON 이외의 서두를 원천 차단
      ],
    }),
  });
  if (!r.ok) throw new Error("AI 호출 실패 (" + r.status + ")");

  const d = await r.json();
  const body = (d.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  const raw = "{" + body.replace(/```json/g, "").replace(/```/g, "");

  const parsed = tryParse(raw) || tryParse(repair(raw));
  if (!parsed) {
    const e = new Error("응답 형식 오류");
    e.snippet = raw.slice(0, 160);
    e.stopReason = d.stop_reason || "";
    throw e;
  }
  return parsed;
}

function tryParse(t) {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

// 응답이 중간에 잘렸을 때 마지막 온전한 지점까지만 남기고 괄호를 닫는다
function repair(t) {
  let s = t;
  // 열려 있는 문자열 종료
  const quotes = (s.match(/(?<!\\)"/g) || []).length;
  if (quotes % 2 === 1) s += '"';
  // 미완성 꼬리 제거
  s = s.replace(/,\s*$/, "");
  // 괄호 닫기
  const open = (s.match(/[[{]/g) || []).length;
  const close = (s.match(/[\]}]/g) || []).length;
  const stack = [];
  for (const ch of s) {
    if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
  }
  while (stack.length) {
    const ch = stack.pop();
    s += ch === "{" ? "}" : "]";
  }
  return open === close ? t : s;
}

function json(o, s = 200) {
  return new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
