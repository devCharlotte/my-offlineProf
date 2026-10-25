import { settings } from "../config.js";
import { savePaperSoon } from "../db.js";
import { onProgress } from "../llm/engine.js";
import { state } from "../state.js";
import { progressOf, translator } from "../translate.js";
import { $, el, shareOrDownload, toast } from "../util.js";
import { pinAndAsk } from "./ask.js";

let showMode = "ko";
let visibleIndex = 0;
let observer = null;
let wakeLock = null;

const paraNode = (i) => $("paras").children[i];
const setStatus = (text) => {
  if (state.tab === "read") $("readStatus").textContent = text;
};

export function renderRead() {
  const box = $("paras");
  const paper = state.paper;
  observer?.disconnect();
  $("transBtn").disabled = $("exportBtn").disabled = !paper;

  if (!paper) {
    $("readTitle").textContent = "";
    $("readStatus").textContent = "";
    $("readBar").style.width = "0";
    box.replaceChildren(el("p", "empty", "서재에서 논문을 열면 여기서 읽을 수 있어요."));
    return;
  }

  $("readTitle").textContent = paper.title;
  observer = new IntersectionObserver(trackPosition, { root: $("main"), rootMargin: "-15% 0px -70% 0px" });

  const nodes = [];
  let lastPage = 0;
  for (const p of paper.paras) {
    const node = el("div");
    if (p.page !== lastPage) {
      node.dataset.page = p.page;
      lastPage = p.page;
    }
    observer.observe(node);
    nodes.push(node);
  }
  box.replaceChildren(...nodes);
  paper.paras.forEach((_, i) => renderPara(i));
  updateProgress();
  updateButton();

  const start = paper.pos ?? 0;
  if (start) requestAnimationFrame(() => box.children[start]?.scrollIntoView({ block: "start" }));
}

function trackPosition(entries) {
  const visible = entries.find((e) => e.isIntersecting);
  if (!visible || !state.paper) return;
  visibleIndex = Array.prototype.indexOf.call($("paras").children, visible.target);
  if (Math.abs((state.paper.pos ?? 0) - visibleIndex) > 2) {
    state.paper.pos = visibleIndex;
    savePaperSoon(state.paper);
  }
}

function renderPara(i, liveText) {
  const node = paraNode(i);
  const paper = state.paper;
  if (!node || !paper) return;
  const p = paper.paras[i];
  const translated = liveText ?? p.ko;
  const peeking = node.classList.contains("peek");

  node.className = [
    "para",
    p.kind === "h" && "h",
    (p.kind === "skip" || p.kind === "ref") && "skip",
    p.ko && "done",
    liveText != null && "working",
    peeking && "peek",
  ].filter(Boolean).join(" ");

  const parts = [];
  if (node.dataset.page) parts.push(el("div", "page", `p.${node.dataset.page}`));
  const showTranslation = translated && showMode !== "src";
  if (showTranslation) parts.push(el("div", "ko", translated));
  if (showMode !== "ko" || !translated || peeking) parts.push(el("div", showTranslation ? "src" : "", p.src));
  if (p.kind === "text") parts.push(actions(i, p, liveText != null));
  node.replaceChildren(...parts);

  node.onclick = () => {
    if (!p.ko || showMode !== "ko") return;
    node.classList.toggle("peek");
    renderPara(i);
  };
}

function actions(i, p, working) {
  const row = el("div", "acts");
  if (!p.ko && !working) {
    const first = el("button", null, "이것 먼저 번역");
    first.type = "button";
    first.onclick = (e) => {
      e.stopPropagation();
      translator.priority = i;
      if (translator.running) toast("지금 단락이 끝나면 바로 번역할게요.");
      else startTranslation();
    };
    row.append(first);
  }
  const explain = el("button", null, "설명해 줘");
  explain.type = "button";
  explain.onclick = (e) => {
    e.stopPropagation();
    pinAndAsk(i);
  };
  row.append(explain);
  return row;
}

function updateProgress() {
  if (state.paper) $("readBar").style.width = `${Math.round(progressOf(state.paper) * 100)}%`;
}

function updateButton() {
  const paper = state.paper;
  if (!paper) return;
  const progress = progressOf(paper);
  const finished = progress >= 0.999;
  const button = $("transBtn");
  button.disabled = finished && !translator.running;
  if (translator.running) {
    button.textContent = "번역 멈추기";
    return;
  }
  button.textContent = finished ? "번역 완료" : progress > 0 ? "이어서 번역" : "번역 시작";
  if (!finished) {
    $("readStatus").textContent = progress > 0
      ? `${Math.round(progress * 100)}% 번역됨. 지금 보는 곳부터 이어서 번역해요.`
      : "번역 시작을 누르면 지금 보는 곳부터 번역해요.";
  }
}

async function keepAwake() {
  if (!settings.keepAwake || !("wakeLock" in navigator) || document.hidden) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
  } catch {}
}

export function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

export function refreshWakeLock() {
  if (settings.keepAwake && translator.running) keepAwake();
  else releaseWakeLock();
}

async function startTranslation() {
  const paper = state.paper;
  if (!paper || translator.running) return;
  keepAwake();
  const stopProgress = onProgress((ratio, text) => setStatus(text));
  const onThisPaper = () => state.paper?.id === paper.id && state.tab === "read";
  const run = translator.run(paper, {
    cursor: () => visibleIndex,
    live: (i, text) => onThisPaper() && renderPara(i, text),
    saved: (i) => {
      if (!onThisPaper()) return;
      renderPara(i);
      updateProgress();
    },
    status: (text) => {
      stopProgress();
      setStatus(text);
      if (text.startsWith("번역을 모두")) toast(text);
    },
    stopped: () => {
      stopProgress();
      releaseWakeLock();
      if (state.tab === "read") updateButton();
    },
  });
  updateButton();
  run.catch((err) => toast(err.message || "번역 중 문제가 생겼어요.", 5000));
}

async function exportTranslation() {
  const paper = state.paper;
  if (!paper) return;
  let md = `# ${paper.title}\n\n`;
  for (const p of paper.paras) {
    if (p.kind === "skip") continue;
    const text = p.ko || p.src;
    md += p.kind === "h" ? `## ${text}\n\n` : `${text}\n\n`;
  }
  if (paper.chat?.length) {
    md += "---\n\n## 질문과 답\n\n";
    for (const c of paper.chat) md += `**Q. ${c.q}**\n\n${c.a}\n\n`;
  }
  const name = `${paper.title.slice(0, 60).replace(/[\\/:*?"<>|]/g, "") || "paper"} 번역.md`;
  await shareOrDownload(new File([md], name, { type: "text/markdown" }));
}

export function initRead() {
  for (const button of document.querySelectorAll(".seg button")) {
    button.onclick = () => {
      showMode = button.dataset.show;
      for (const b of document.querySelectorAll(".seg button")) b.setAttribute("aria-pressed", b === button);
      state.paper?.paras.forEach((_, i) => renderPara(i));
    };
  }
  $("transBtn").onclick = () => {
    if (translator.running) {
      translator.stop();
      updateButton();
    } else {
      startTranslation();
    }
  };
  $("exportBtn").onclick = exportTranslation;
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && translator.running) keepAwake();
  });
}

