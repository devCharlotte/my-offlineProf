import { savePaper } from "../db.js";
import { onProgress } from "../llm/engine.js";
import { showTab } from "../nav.js";
import { answer } from "../qa.js";
import { state } from "../state.js";
import { translator } from "../translate.js";
import { $, el } from "../util.js";

const PRESETS = [
  { label: "핵심 요약", question: "이 논문의 핵심을 다섯 줄로 요약해 줘.", kind: "summary" },
  { label: "연구 문제", question: "이 논문이 풀려는 문제는 무엇이고 왜 중요한지 설명해 줘." },
  { label: "방법", question: "제안한 방법이 어떻게 작동하는지 쉽게 설명해 줘." },
  { label: "결과", question: "주요 실험 결과와 핵심 수치를 정리해 줘." },
  { label: "한계", question: "이 논문의 한계와 앞으로 할 일은 뭐야?" },
  { label: "용어 풀이", question: "이 논문에서 꼭 알아야 할 용어 다섯 개를 쉽게 풀어 줘." },
];

const scrollToEnd = () => ($("main").scrollTop = $("main").scrollHeight);

function exchange(question, text, pages = []) {
  const q = el("div", "q", question);
  const a = el("div", "a");
  a.append(el("div", null, text));
  if (pages.length) a.append(el("div", "refs", `참고한 곳: ${pages.map((p) => `p.${p}`).join(", ")}`));
  return [q, a];
}

function setInputEnabled(on) {
  $("askInput").disabled = $("askBtn").disabled = !on;
}

export function renderAsk() {
  const paper = state.paper;
  const msgs = $("msgs");
  $("askPaper").textContent = paper?.title ?? "";
  setInputEnabled(paper && !state.asking);
  renderPin();

  if (!paper) {
    $("chips").replaceChildren();
    msgs.replaceChildren(el("p", "empty", "서재에서 논문을 열면 그 논문에 대해 물어볼 수 있어요."));
    return;
  }

  $("chips").replaceChildren(...PRESETS.map((preset) => {
    const chip = el("button", null, preset.label);
    chip.type = "button";
    chip.onclick = () => ask(preset.question, preset.kind);
    return chip;
  }));

  const history = (paper.chat ?? []).flatMap((c) => exchange(c.q, c.a, c.pages));
  msgs.replaceChildren(...(history.length
    ? history
    : [el("p", "empty", "위의 버튼을 누르거나 궁금한 걸 적어 보세요. 답은 논문 내용에서만 찾아요.")]));
  requestAnimationFrame(scrollToEnd);
}

function renderPin() {
  const paper = state.paper;
  const para = state.pinned != null ? paper?.paras[state.pinned] : null;
  $("pin").classList.toggle("on", !!para);
  $("askInput").placeholder = para ? "이 단락에 대해 물어보세요" : "이 논문에 대해 물어보세요";
  if (para) $("pinText").textContent = `p.${para.page} 단락: ${(para.ko || para.src).slice(0, 110)}...`;
}

export function pinAndAsk(index) {
  state.pinned = index;
  showTab("ask");
  ask("이 단락을 쉽게 설명해 줘.");
}

async function ask(question, kind) {
  const paper = state.paper;
  question = question.trim();
  if (!paper || state.asking || !question) return;

  state.asking = true;
  setInputEnabled(false);
  $("askInput").value = "";
  if (!paper.chat?.length) $("msgs").replaceChildren();

  const [q, a] = exchange(question, "생각하는 중...");
  const body = a.firstChild;
  body.classList.add("muted");
  $("msgs").append(q, a);
  scrollToEnd();

  const stopProgress = onProgress((ratio, text) => (body.textContent = text));
  const job = answer(paper, question, {
    kind,
    pinned: state.pinned,
    onText: (text) => {
      body.classList.remove("muted");
      body.textContent = text;
      scrollToEnd();
    },
  });
  translator.yieldTurn();

  try {
    const { text, pages } = await job;
    paper.chat = [...(paper.chat ?? []), { q: question, a: text, pages, at: Date.now() }];
    await savePaper(paper);
    a.replaceWith(exchange(question, text, pages)[1]);
  } catch (err) {
    console.error(err);
    body.textContent = err.message || "답을 만들지 못했어요.";
    body.classList.add("muted");
  } finally {
    stopProgress();
    state.asking = false;
    setInputEnabled(!!state.paper);
  }
}

export function initAsk() {
  $("askForm").onsubmit = (e) => {
    e.preventDefault();
    ask($("askInput").value);
  };
  $("askInput").addEventListener("input", (e) => {
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(140, e.target.scrollHeight)}px`;
  });
  $("unpin").onclick = () => {
    state.pinned = null;
    renderPin();
  };
}
