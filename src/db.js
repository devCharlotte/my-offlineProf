import { toast } from "./util.js";

const STORE = "papers";

const opening = new Promise((resolve, reject) => {
  const req = indexedDB.open("my-offline-prof", 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function run(mode, op) {
  const db = await opening;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = op(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export const getPaper = (id) => run("readonly", (s) => s.get(id));
export const listPapers = () => run("readonly", (s) => s.getAll());
export const deletePaper = (id) => run("readwrite", (s) => s.delete(id));

export async function savePaper(paper) {
  try {
    await run("readwrite", (s) => s.put(paper));
  } catch {
    toast("저장 공간이 부족해요. 서재에서 안 읽는 논문을 지워 주세요.", 5000);
  }
}

const timers = new Map();
export function savePaperSoon(paper) {
  clearTimeout(timers.get(paper.id));
  timers.set(paper.id, setTimeout(() => {
    timers.delete(paper.id);
    savePaper(paper);
  }, 800));
}
