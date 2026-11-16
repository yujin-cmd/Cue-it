/* 큐잇 — 로컬 저장
   PDF 원본은 IndexedDB, 분석 결과는 localStorage. 서버로 보내지 않는다. */

const DB = "cueit-db";
const STORE = "files";

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function savePdf(blob) {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, "pdf");
    tx.oncomplete = () => res(true);
    tx.onerror = () => rej(tx.error);
  });
}

export async function loadPdf() {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readonly");
    const q = tx.objectStore(STORE).get("pdf");
    q.onsuccess = () => res(q.result || null);
    q.onerror = () => rej(q.error);
  });
}

export function saveDeck(deck) {
  localStorage.setItem("cueit-deck", JSON.stringify(deck));
}

export function loadDeck() {
  try {
    return JSON.parse(localStorage.getItem("cueit-deck") || "null");
  } catch {
    return null;
  }
}

export function saveReport(r) {
  const all = loadReports();
  all.unshift(r);
  localStorage.setItem("cueit-reports", JSON.stringify(all.slice(0, 10)));
}

export function loadReports() {
  try {
    return JSON.parse(localStorage.getItem("cueit-reports") || "[]");
  } catch {
    return [];
  }
}

// 마지막으로 고른 발표 유형
export function saveType(key) {
  localStorage.setItem("cueit-type", key);
}

export function loadType() {
  return localStorage.getItem("cueit-type") || "";
}
