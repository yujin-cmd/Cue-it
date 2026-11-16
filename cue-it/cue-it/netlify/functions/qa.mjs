import { typeOf, levelKey, LEVEL_GUIDE } from "../../public/presets.js";

// 연습 모드 전용. 사용자의 답변을 받아 꼬리질문을 만든다.
// 주의: 사용자를 대신해 "답변"을 생성하지 않는다. 질문만 만든다.
const MODEL = "claude-sonnet-5";

// 발표 유형에 따라 질문하는 사람이 달라진다(면접관, 상사, 교수님, 심사위원).
const system = (t) => `당신은 "${t.label}"를 듣고 있는 ${t.audience}입니다. 발표자는 ${t.speaker}입니다.
${t.audience}의 입장에서 질문만 던집니다.

절대 금지:
- 사용자를 대신해 모범답안을 만들어 주지 않습니다.
- 답변을 첨삭하거나 다시 써 주지 않습니다.

하는 일:
1. 사용자의 답변에서 가장 약한 지점 한 곳을 찾습니다.
2. 그 지점을 파고드는 꼬리질문 하나를 던집니다.
3. 한 줄짜리 짧은 코멘트로 무엇이 약했는지만 알려줍니다(답을 주지 않고).

난이도:
- 일반: ${LEVEL_GUIDE.일반}
- 검증: ${LEVEL_GUIDE.검증}
- 압박: ${LEVEL_GUIDE.압박}

반드시 아래 JSON만 출력하십시오. 마크다운 코드펜스 금지.
{"comment":"답변에서 약했던 지점 한 줄","followUp":"꼬리질문 한 문장"}`;

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

  const level = levelKey(b.level);
  const t = typeOf(b.type);
  const history = (Array.isArray(b.history) ? b.history : []).slice(-6);

  const userMsg =
    `## 난이도\n${level}\n\n` +
    `## 발표 요약\n${(b.context || "").slice(0, 4000)}\n\n` +
    `## 직전 질문\n${b.question || ""}\n\n` +
    `## 사용자의 답변\n${(b.answer || "").slice(0, 3000)}\n\n` +
    (history.length ? `## 이전 대화\n${history.map((h) => `${h.role}: ${h.text}`).join("\n")}` : "");

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        system: system(t),
        messages: [{ role: "user", content: userMsg }],
      }),
    });
    if (!r.ok) return json({ error: "질문 생성 실패" }, 502);

    const d = await r.json();
    const text = (d.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
    let p;
    try {
      p = JSON.parse(cleaned);
    } catch {
      const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}");
      p = s >= 0 && e > s ? JSON.parse(cleaned.slice(s, e + 1)) : null;
    }
    if (!p) return json({ error: "응답 해석 실패" }, 502);
    return json({ comment: p.comment || "", followUp: p.followUp || "" });
  } catch (e) {
    return json({ error: "서버 오류: " + e.message }, 500);
  }
};

function json(o, s = 200) {
  return new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
