/* 큐잇 — 매칭 엔진
   음성 텍스트에서 "이 핵심을 이미 말했는가"를 판정한다. 서버 호출 없음. */

const KO_DIGIT = { 영: 0, 공: 0, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
const KO_UNIT = { 십: 10, 백: 100, 천: 1000, 만: 10000 };
const KO_NATIVE = {
  하나: 1, 한: 1, 둘: 2, 두: 2, 셋: 3, 세: 3, 넷: 4, 네: 4,
  다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10, 스물: 20, 서른: 30,
};

// 단위명사가 뒤따를 때만 변환한다.
// 무조건 변환하면 "한계"가 "1계"가 되는 식의 손상이 생기므로 범위를 좁힌다.
const COUNTER = "명|개|주|일|년|월|시간|분|초|번|가지|건|점|달|배|차|회|권|장|퍼센트|프로|곳|팀|조|부|편";

function chunkToNumber(chunk) {
  let result = 0, section = 0, cur = 0, used = false;
  for (const ch of chunk) {
    if (KO_DIGIT[ch] !== undefined) {
      cur = KO_DIGIT[ch];
      used = true;
    } else if (KO_UNIT[ch]) {
      used = true;
      const u = KO_UNIT[ch];
      if (u === 10000) {
        result += (section + cur) * u;
        section = 0;
        cur = 0;
      } else {
        section += (cur || 1) * u;
        cur = 0;
      }
    }
  }
  const val = result + section + cur;
  return used && val > 0 ? String(val) : null;
}

// "이백십삼 명" → "213명", "두 주" → "2주"
function koreanNumberToDigit(text) {
  let out = text;

  // 고유어 수사
  const nativeKeys = Object.keys(KO_NATIVE).sort((a, b) => b.length - a.length).join("|");
  out = out.replace(
    new RegExp(`(${nativeKeys})\\s*(?=(${COUNTER}))`, "g"),
    (_, w) => String(KO_NATIVE[w])
  );

  // 한자어 수사
  out = out.replace(
    new RegExp(`([일이삼사오육칠팔구십백천만]{1,8})\\s*(?=(${COUNTER}))`, "g"),
    (m, chunk) => chunkToNumber(chunk) ?? m
  );

  return out;
}

// 비교용 정규화: 공백/문장부호 제거 + 숫자 통일
export function normalize(text) {
  if (!text) return "";
  let t = String(text).toLowerCase();
  t = koreanNumberToDigit(t);
  t = t.replace(/[\s.,!?"'`~·・\-—–_()[\]{}<>:;/\\|]/g, "");
  return t;
}

// 한국어는 조사·어미가 붙는다. 뒤를 최대 2자까지 잘라가며 대조한다.
// "213명으로" → "213명으" → "213명" 에서 일치.
function loosely(hay, word) {
  for (let cut = 0; cut <= 2; cut++) {
    const w = cut ? word.slice(0, -cut) : word;
    if (w.length >= 2 && hay.includes(w)) return true;
  }
  return false;
}

// 의미를 담지 않는 조각. 이것만 맞아서는 전달로 보지 않는다.
const STOP = new Set([
  "그리고", "그래서", "하지만", "또한", "이것", "저것", "그것", "때문", "위해", "통해",
  "대해", "대한", "에서", "으로", "이다", "입니다", "습니다", "합니다", "있습", "같은",
  "경우", "정도", "매우", "가장", "이번", "저희", "우리",
]);

function meaningfulTokens(text) {
  return String(text)
    .split(/[\s.,!?"'()[\]·/]+/)
    .map((w) => normalize(w))
    .filter((w) => w.length >= 2 && !STOP.has(w));
}

// 글자 2개 단위로 잘라 겹치는 비율을 본다.
// 어순이 바뀌거나 조사가 달라도 살아남는다.
function bigrams(s) {
  const out = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

function bigramCoverage(hay, needle) {
  const bg = bigrams(needle);
  if (!bg.length) return 0;
  let hit = 0;
  for (const b of bg) if (hay.includes(b)) hit++;
  return hit / bg.length;
}

// 같은 뜻으로 바꿔 말하는 낱말들. 발표에서 실제로 섞여 쓰이는 것만 모았다.
const SYN_GROUPS = [
  ["온라인", "인터넷", "비대면", "웹", "구글폼", "모바일"],
  ["설문", "설문조사", "앙케트", "서베이"],
  ["조사", "연구", "분석", "살펴"],
  ["대상", "표본", "응답자", "참여자", "참가자"],
  ["한계", "제약", "한계점", "제한"],
  ["대표성", "일반화", "대표"],
  ["결과", "결론", "성과"],
  ["증가", "상승", "늘어", "많아", "높아"],
  ["감소", "하락", "줄어", "적어", "낮아"],
  ["이용", "사용", "활용", "쓰"],
  ["특징", "특성", "성격"],
  ["방법", "방식", "절차"],
  ["후속", "추가", "향후", "앞으로"],
  ["대학생", "학생", "대학"],
  ["중요", "핵심", "주요"],
  // 면접·업무 보고·공모전 발표에서 자주 바꿔 말하는 낱말
  ["매출", "수익", "실적"],
  ["비용", "예산", "경비"],
  ["고객", "사용자", "이용자", "소비자"],
  ["문제", "불편", "어려움"],
  ["해결", "해결책", "솔루션", "대안"],
  ["강점", "장점", "역량"],
  ["경험", "경력", "사례"],
  ["일정", "계획", "로드맵"],
  ["목표", "포부", "비전"],
  ["차별", "차이", "다른점"],
];

// 낱말 하나가 나왔는지 본다. 유의어까지 함께 살핀다.
function wordAppears(hay, word) {
  if (loosely(hay, word)) return true;
  for (const g of SYN_GROUPS) {
    if (!g.some((w) => word.includes(w))) continue;
    for (const sib of g) if (sib.length >= 2 && hay.includes(sib)) return true;
  }
  return false;
}

/* 항목 하나가 전달되었는지 판정.
   느슨하게 잡는 편이 낫다. 놓치면 없던 경고가 뜨지만,
   조금 넉넉히 잡으면 발표자가 흔들릴 일이 없다. */
export function isSpoken(buffer, item) {
  const buf = normalize(buffer);
  if (!buf) return false;

  // 1) 표현 변형 — 조사가 붙어도 잡는다
  for (const v of item.variants || []) {
    const n = normalize(v);
    if (n.length >= 2 && loosely(buf, n)) return true;
  }

  // 2) 라벨 그대로
  const label = normalize(item.label);
  if (label.length >= 2 && loosely(buf, label)) return true;

  // 3) 숫자는 그 자체로 강한 단서다.
  //    라벨에 든 숫자가 나왔고 다른 낱말 하나만 더 맞아도 전달로 본다.
  const nums = label.match(/\d+/g) || [];
  const words = meaningfulTokens(item.label);
  if (nums.length) {
    const numHit = nums.some((n) => buf.includes(n));
    if (numHit) {
      const other = words.filter((w) => !/^\d+$/.test(w));
      if (!other.length || other.some((w) => wordAppears(buf, w))) return true;
    }
  }

  // 4) 낱말 커버리지 — 절반 넘게 나왔으면 전달로 본다
  const pool = [...new Set([...words, ...(item.keywords || []).map(normalize)])].filter(
    (w) => w.length >= 2 && !STOP.has(w)
  );
  if (pool.length) {
    const hit = pool.filter((w) => wordAppears(buf, w)).length;
    if (hit / pool.length >= 0.5) return true;
  }

  // 5) 글자 겹침 — 어순이 달라도 같은 말이면 잡힌다
  if (label.length >= 4 && bigramCoverage(buf, label) >= 0.6) return true;
  for (const v of item.variants || []) {
    const n = normalize(v);
    if (n.length >= 5 && bigramCoverage(buf, n) >= 0.7) return true;
  }

  return false;
}

// 대본 문장 중 현재 어디쯤인지 (큐 주세요 / 다음 문장 안내용)
export function currentLineIndex(buffer, lines) {
  const buf = normalize(buffer);
  if (!buf || !lines?.length) return -1;
  let best = -1;
  for (let i = 0; i < lines.length; i++) {
    const toks = tokens(lines[i]);
    if (!toks.length) continue;
    const hit = toks.filter((t) => buf.includes(t)).length;
    if (hit / toks.length >= 0.5) best = i; // 뒤쪽 문장을 우선
  }
  return best;
}

function tokens(line) {
  return String(line)
    .split(/[\s.,!?"'()[\]]+/)
    .map((w) => normalize(w))
    .filter((w) => w.length >= 2)
    .slice(0, 12);
}

// 슬라이드의 전달 상태 갱신
export function evaluateSlide(buffer, slide, spokenSet) {
  for (const item of slide.items) {
    if (spokenSet.has(item.id)) continue;
    if (isSpoken(buffer, item)) spokenSet.add(item.id);
  }
  const remaining = slide.items.filter((i) => !spokenSet.has(i.id));
  return {
    remaining,
    missedRequired: remaining.filter((i) => i.level === "필수"),
  };
}
