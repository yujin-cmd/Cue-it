/* 큐잇 — 발표 유형
   유형을 고르면 기본 시간, 꼭 전달할 내용, 질문하는 사람이 함께 바뀐다.
   화면(app.js)과 서버 함수(netlify/functions)가 같은 파일을 쓴다. */

export const TYPES = {
  interview: {
    label: "면접 발표",
    icon: "💼",
    minutes: 5,
    audience: "면접관",
    speaker: "취업·이직 면접에서 발표하는 지원자",
    must: ["지원 동기", "핵심 강점", "경험 사례", "입사 후 포부"],
    firstQuestion: "수많은 지원자 중에서 왜 본인이어야 합니까?",
    qExample: "그 경험에서 본인이 맡은 역할은 무엇이었습니까?",
  },
  report: {
    label: "업무 보고",
    icon: "📊",
    minutes: 10,
    audience: "상사",
    speaker: "회의에서 업무 내용을 보고하는 직장인",
    must: ["결론", "근거", "필요한 결정", "일정"],
    firstQuestion: "그래서 지금 무엇을 결정하면 됩니까?",
    qExample: "이 수치는 어디에서 나온 것입니까?",
  },
  class: {
    label: "수업·과제 발표",
    icon: "🎓",
    minutes: 7,
    audience: "교수님",
    speaker: "수업이나 과제 결과를 발표하는 학생",
    must: ["주제", "방법", "결과", "한계"],
    firstQuestion: "이 주제를 고른 이유가 무엇입니까?",
    qExample: "이 결과를 일반화할 수 있습니까?",
  },
  pitch: {
    label: "공모전·투자 발표",
    icon: "🚀",
    minutes: 5,
    audience: "심사위원",
    speaker: "공모전이나 투자 심사에서 아이디어를 발표하는 참가자",
    must: ["문제", "해결책", "차별점", "실현 계획"],
    firstQuestion: "비슷한 서비스가 이미 있는데 무엇이 다릅니까?",
    qExample: "실제로 누가 이 서비스를 쓰게 됩니까?",
  },
  free: {
    label: "자유 형식",
    icon: "✏️",
    minutes: 7,
    audience: "청중",
    speaker: "여러 사람 앞에서 발표하는 사람",
    must: [],
    firstQuestion: "이 발표에서 가장 전하고 싶은 한 가지는 무엇입니까?",
    qExample: "방금 말씀하신 내용의 근거는 무엇입니까?",
  },
};

export const TYPE_KEYS = Object.keys(TYPES);

// 질문 난이도. 가운데 단계의 화면 이름은 유형의 청중 이름을 쓴다.
export const LEVELS = ["일반", "검증", "압박"];

export const LEVEL_GUIDE = {
  일반: "이해를 확인하는 수준.",
  검증: "근거와 방법의 타당성을 검증하는 수준.",
  압박: "발표의 존재 이유와 결론의 정당성을 흔드는 수준. 예의는 지키되 물러서지 않습니다.",
};

export function typeOf(key) {
  return TYPES[key] || TYPES.free;
}

export function typeKey(key) {
  return TYPES[key] ? key : "free";
}

// 예전 자료는 가운데 단계를 "교수님"으로 저장했다.
export function levelKey(level) {
  if (level === "교수님") return "검증";
  return LEVELS.includes(level) ? level : "검증";
}

export function levelLabel(level, key) {
  return levelKey(level) === "검증" ? typeOf(key).audience : levelKey(level);
}
