import { MODELS, saveSettings, settings } from "../config.js";
import { backend, deleteModels, downloadSize, ensureEngine, gpuReady, isModelCached, onProgress } from "../llm/engine.js";
import { state } from "../state.js";
import { translator } from "../translate.js";
import { $, el, formatGB } from "../util.js";
import { refreshWakeLock } from "./read.js";

let modelReady = null;

export async function updateNetChip() {
  const chip = $("netChip");
  modelReady ??= await isModelCached();
  if (modelReady) {
    chip.textContent = navigator.onLine ? "오프라인 준비됨" : "오프라인으로 사용 중";
    chip.className = "chip ok";
  } else {
    chip.textContent = navigator.onLine ? "모델 받기 전" : "오프라인 (모델 없음)";
    chip.className = "chip";
  }
}

function modelChanged() {
  modelReady = null;
  saveSettings();
  renderSetup();
  updateNetChip();
}

export async function renderSetup() {
  await gpuReady;
  const options = Object.entries(MODELS).map(([key, m]) => {
    const id = `size-${key}`;
    const radio = el("input");
    Object.assign(radio, { type: "radio", name: "size", id, checked: settings.modelSize === key });
    radio.onchange = () => {
      settings.modelSize = key;
      modelChanged();
    };
    const text = el("div");
    text.append(el("div", null, `${m.label} (약 ${formatGB(m[backend()].gb)}GB)`), el("small", null, m.note));
    const row = el("label", "opt");
    row.htmlFor = id;
    row.append(radio, text);
    return row;
  });
  $("sizeOpts").replaceChildren(...options);
  $("engineSel").value = settings.engine;
  $("fsRange").value = settings.fontSize;
  $("wakeChk").checked = settings.keepAwake;
  refreshChecks();
}

async function refreshChecks() {
  if (state.tab !== "setup") return;
  const registration = await navigator.serviceWorker?.getRegistration().catch(() => null);
  const cached = await isModelCached();
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  modelReady = cached;

  const name = MODELS[settings.modelSize].label;
  const runsOn = backend() === "gpu" ? "GPU로 실행해요"
    : window.crossOriginIsolated ? "CPU로 실행해요 (여러 코어 사용)" : "CPU로 실행해요";
  const rows = [
    [!!registration?.active, "앱 화면이 휴대폰에 저장됐어요", "앱 화면 저장 중이에요. 인터넷이 될 때 한 번 열어 두세요."],
    [cached, `AI 모델이 저장됐어요 (${name})`, `AI 모델을 아직 받지 않았어요 (${name}, 약 ${formatGB(downloadSize())}GB)`],
    [!!persisted, "저장 공간이 보호돼요", "저장 공간 보호 안 됨 (모델 받기를 누르면 요청해요)"],
    [true, runsOn, ""],
  ];
  $("checks").replaceChildren(...rows.map(([ok, yes, no]) => {
    const li = el("li", ok ? "ok" : "");
    li.append(el("span", "mark", ok ? "✓" : "○"), el("span", null, ok ? yes : no));
    return li;
  }));

  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    $("storageText").textContent = `이 앱이 쓰는 공간 ${(usage / 1e9).toFixed(2)}GB, 쓸 수 있는 공간 약 ${Math.floor(quota / 1e9)}GB`;
  } catch {}
  $("dlBtn").textContent = cached ? "모델 열어 보기" : "모델 받기";
  updateNetChip();
}

async function download() {
  const status = $("modelStatus");
  $("dlBtn").disabled = true;
  status.className = "";
  navigator.storage?.persist?.().catch(() => {});
  const stop = onProgress((ratio, text) => {
    $("dlBar").style.width = `${Math.round(Math.min(1, ratio) * 100)}%`;
    status.textContent = text;
  });
  try {
    await ensureEngine();
    status.textContent = "준비 완료. 이제 데이터 없이도 번역하고 질문할 수 있어요.";
  } catch (err) {
    status.className = "warn";
    status.textContent = err.message || "모델을 받지 못했어요.";
  } finally {
    stop();
    $("dlBtn").disabled = false;
    refreshChecks();
  }
}

async function remove() {
  if (!confirm("받아 둔 AI 모델을 모두 지울까요? 논문과 번역은 남아요.")) return;
  translator.stop();
  await deleteModels().catch(() => {});
  modelReady = false;
  $("dlBar").style.width = "0";
  $("modelStatus").textContent = "모델을 지웠어요.";
  refreshChecks();
}

export function applyFontSize() {
  document.documentElement.style.setProperty("--fs", `${settings.fontSize}px`);
}

export function initSetup() {
  $("dlBtn").onclick = download;
  $("rmBtn").onclick = remove;
  $("engineSel").onchange = (e) => {
    settings.engine = e.target.value;
    if (settings.engine === "gpu") settings.gpuFailed = false;
    modelChanged();
  };
  $("fsRange").oninput = (e) => {
    settings.fontSize = Number(e.target.value);
    saveSettings();
    applyFontSize();
  };
  $("wakeChk").onchange = (e) => {
    settings.keepAwake = e.target.checked;
    saveSettings();
    refreshWakeLock();
  };
  addEventListener("online", updateNetChip);
  addEventListener("offline", updateNetChip);
}

export function markModelReady() {
  modelReady = true;
  updateNetChip();
}
