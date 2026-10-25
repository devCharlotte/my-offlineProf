import { deletePaper, getPaper, listPapers, savePaper, savePaperSoon } from "../db.js";
import { extractPdf } from "../pdf/extract.js";
import { showTab } from "../nav.js";
import { state } from "../state.js";
import { progressOf, translator } from "../translate.js";
import { $, el, toast } from "../util.js";

export async function renderLibrary() {
  const list = $("paperList");
  const papers = (await listPapers()).sort((a, b) => (b.opened ?? b.added) - (a.opened ?? a.added));
  list.replaceChildren();
  if (!papers.length) {
    list.append(el("li", "empty", "아직 논문이 없어요. 위에서 PDF를 올려 주세요."));
    return;
  }
  for (const paper of papers) list.append(paperRow(paper));
}

function paperRow(paper) {
  const pct = Math.round(progressOf(paper) * 100);
  const direction = paper.dir === "en2ko" ? "영어에서 한국어로" : "한국어에서 영어로";
  const questions = paper.chat?.length ? `, 질문 ${paper.chat.length}개` : "";

  const meta = el("div", "meta");
  const bar = el("div", "bar");
  const fill = el("div");
  fill.style.width = `${pct}%`;
  bar.append(fill);
  meta.append(el("div", "t", paper.title), el("div", "s", `${paper.pages}쪽, ${direction}, 번역 ${pct}%${questions}`), bar);
  meta.onclick = () => openPaper(paper.id);

  const remove = el("button", "del", "✕");
  remove.setAttribute("aria-label", "논문 지우기");
  remove.onclick = async () => {
    if (!confirm(`'${paper.title}'을(를) 지울까요? 번역과 질문 기록도 함께 지워져요.`)) return;
    if (state.paper?.id === paper.id) {
      translator.stop();
      state.paper = null;
    }
    await deletePaper(paper.id);
    renderLibrary();
  };

  const row = el("li");
  row.append(meta, remove);
  return row;
}

export async function openPaper(id) {
  if (state.paper?.id !== id) {
    translator.stop();
    state.pinned = null;
  }
  state.paper = await getPaper(id);
  if (!state.paper) return;
  state.paper.opened = Date.now();
  savePaperSoon(state.paper);
  showTab("read");
}

export async function importPdf(file) {
  if (!file) return;
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) {
    toast("PDF 파일만 열 수 있어요.");
    return;
  }
  showTab("library");
  toast("PDF 읽는 중...", 60000);
  try {
    const result = await extractPdf(file, (n, total) => toast(`PDF 읽는 중 ${n} / ${total}쪽`, 60000));
    if (!result.paras.some((p) => p.kind === "text")) {
      toast("글자를 찾지 못했어요. 스캔한 이미지 PDF는 아직 읽을 수 없어요.", 5000);
      return;
    }
    const paper = {
      id: crypto.randomUUID(),
      title: result.title,
      fileName: file.name,
      dir: result.dir,
      pages: result.pages,
      paras: result.paras,
      added: Date.now(),
      opened: Date.now(),
      pos: 0,
      chat: [],
    };
    await savePaper(paper);
    toast(`${result.pages}쪽, ${result.paras.length}개 단락을 불러왔어요.`);
    await openPaper(paper.id);
  } catch (err) {
    console.error(err);
    toast("PDF를 읽지 못했어요. 암호가 걸렸거나 손상된 파일인지 확인해 주세요.", 5000);
  }
}

// PDFs shared from other apps arrive through the service worker (Android, installed app only).
export async function importSharedPdf() {
  if (!new URLSearchParams(location.search).has("shared")) return;
  history.replaceState(null, "", "./");
  try {
    const cache = await caches.open("mop-shared");
    const res = await cache.match("./shared-pdf");
    if (!res) return;
    const name = decodeURIComponent(res.headers.get("X-Name") || "shared.pdf");
    const blob = await res.blob();
    await cache.delete("./shared-pdf");
    await importPdf(new File([blob], name, { type: "application/pdf" }));
  } catch (err) {
    console.error(err);
  }
}

export function initLibrary() {
  $("pdfInput").onchange = (e) => {
    importPdf(e.target.files[0]);
    e.target.value = "";
  };
}
