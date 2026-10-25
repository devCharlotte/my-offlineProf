import { MODELS, settings, saveSettings } from "../config.js";
import { formatGB, toast } from "../util.js";

const VENDOR = new URL("../../vendor/", import.meta.url);

export const gpuReady = (async () => {
  if (!navigator.gpu) return null;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter ? { f16: adapter.features.has("shader-f16") } : null;
  } catch {
    return null;
  }
})();
let gpu = null;
gpuReady.then((g) => (gpu = g));

export function backend() {
  if (!gpu || settings.engine === "cpu") return "cpu";
  if (settings.engine === "auto" && settings.gpuFailed) return "cpu";
  return "gpu";
}

const model = () => MODELS[settings.modelSize];
const gpuModelId = () => (gpu?.f16 ? model().gpu.f16 : model().gpu.f32);
const cpuModelUrl = () => `https://huggingface.co/${model().cpu.repo}/resolve/main/${model().cpu.file}`;
export const downloadSize = () => model()[backend()].gb;

let webllm = null;
const loadWebllm = async () => (webllm ??= await import(new URL("web-llm/index.js", VENDOR).href));

let Wllama = null;
let wasmUrl = null;
async function loadWllama() {
  if (!Wllama) {
    Wllama = (await import(new URL("wllama/index.js", VENDOR).href)).Wllama;
    // Hand the worker a blob URL so the wasm loads even when the worker isn't controlled by the service worker.
    const wasm = await (await fetch(new URL("wllama/wllama.wasm", VENDOR))).blob();
    wasmUrl = URL.createObjectURL(new Blob([wasm], { type: "application/wasm" }));
  }
  return new Wllama({ default: wasmUrl });
}

export async function isModelCached() {
  await gpuReady;
  try {
    if (backend() === "gpu") return await (await loadWebllm()).hasModelInCache(gpuModelId());
    const models = await (await loadWllama()).modelManager.getModels();
    return models.some((m) => m.url === cpuModelUrl());
  } catch {
    return false;
  }
}

const listeners = new Set();
export function onProgress(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const report = (ratio, text) => listeners.forEach((fn) => fn(ratio, text));

let engine = null;
let pending = null;
const engineKey = () => `${settings.modelSize}:${backend()}`;

export async function ensureEngine() {
  await gpuReady;
  if (engine?.key === engineKey()) return engine;
  if (pending) {
    await pending.catch(() => {});
    if (engine?.key === engineKey()) return engine;
  }
  pending = start();
  try {
    return await pending;
  } finally {
    pending = null;
  }
}

async function start() {
  if (!(await isModelCached())) {
    if (!navigator.onLine) {
      throw new Error("AI 모델이 아직 없어요. Wi-Fi에서 준비 탭의 모델 받기를 먼저 해 주세요.");
    }
    const ok = confirm(`AI 모델(약 ${formatGB(downloadSize())}GB)을 한 번 내려받아야 해요. Wi-Fi에 연결돼 있나요? 지금 받을까요?`);
    if (!ok) throw new Error("모델 받기를 취소했어요.");
    navigator.storage?.persist?.().catch(() => {});
  }
  await unloadEngine();
  try {
    engine = backend() === "gpu" ? await startGpu() : await startCpu();
  } catch (err) {
    if (backend() !== "gpu" || settings.engine !== "auto") throw err;
    console.warn("GPU engine failed, falling back to CPU", err);
    settings.gpuFailed = true;
    saveSettings();
    toast("이 폰의 GPU로는 열지 못해서 CPU로 바꿔요.", 4000);
    engine = await startCpu();
  }
  engine.key = engineKey();
  return engine;
}

export async function unloadEngine() {
  if (!engine) return;
  await engine.unload().catch(() => {});
  engine = null;
}

async function startGpu() {
  const lib = await loadWebllm();
  const mlc = await lib.CreateMLCEngine(gpuModelId(), {
    initProgressCallback: (p) => report(p.progress, p.progress >= 1 ? "모델 여는 중..." : `모델 준비 중 ${Math.round(p.progress * 100)}%`),
  });
  report(1, "준비 완료");
  return {
    async *stream(messages, opts) {
      const request = {
        messages,
        stream: true,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 768,
        extra_body: { enable_thinking: false },
      };
      for await (const chunk of await mlc.chat.completions.create(request)) {
        if (opts.signal?.aborted) {
          mlc.interruptGenerate();
          break;
        }
        yield chunk.choices[0]?.delta?.content ?? "";
      }
    },
    unload: () => mlc.unload(),
  };
}

async function startCpu() {
  const w = await loadWllama();
  const spec = model().cpu;
  const url = cpuModelUrl();
  const params = { n_ctx: 4096, n_gpu_layers: 0 };
  const progress = (loaded, total) => {
    if (total) report(loaded / total, `모델 받는 중 ${Math.round((loaded / total) * 100)}% (${(loaded / 1e9).toFixed(2)} / ${(total / 1e9).toFixed(2)}GB)`);
  };

  const cached = (await w.modelManager.getModels()).some((m) => m.url === url);
  let roomToCache = true;
  try {
    const { quota = 0, usage = 0 } = await navigator.storage.estimate();
    roomToCache = quota - usage > spec.gb * 1.3e9;
  } catch {}

  if (cached || roomToCache) {
    await w.loadModelFromUrl(url, { ...params, progressCallback: ({ loaded, total }) => progress(loaded, total) });
  } else {
    // Not enough storage quota: keep the model in memory for this session only.
    const res = await fetch(url);
    if (!res.ok) throw new Error(`모델 파일을 받지 못했어요 (${res.status})`);
    const total = Number(res.headers.get("content-length")) || spec.gb * 1e9;
    const reader = res.body.getReader();
    const parts = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      loaded += value.length;
      progress(loaded, total);
    }
    await w.loadModel([new Blob(parts)], params);
    toast("저장 공간이 부족해서 모델을 저장하지 못했어요. 다음엔 다시 받아야 해요.", 5000);
  }
  report(1, w.isMultithread() ? "준비 완료 (여러 코어 사용)" : "준비 완료");

  return {
    async *stream(messages, opts) {
      const request = {
        messages,
        stream: true,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 768,
        abortSignal: opts.signal,
      };
      if (spec.qwen) request.chat_template_kwargs = { enable_thinking: false };
      for await (const chunk of await w.createChatCompletion(request)) yield chunk.choices?.[0]?.delta?.content ?? "";
    },
    unload: () => w.exit(),
  };
}

export async function deleteModels() {
  await unloadEngine();
  if (gpu) {
    const lib = await loadWebllm();
    for (const m of Object.values(MODELS)) {
      for (const id of [m.gpu.f16, m.gpu.f32]) await lib.deleteModelAllInfoInCache(id).catch(() => {});
    }
  }
  await (await loadWllama()).cacheManager.clear().catch(() => {});
}

// One generation at a time; translation and Q&A take turns through this queue.
let queue = Promise.resolve();
export function exclusive(task) {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
}

const tidy = (text) => text
  .replace(/<think>[\s\S]*?(<\/think>|$)/g, "")
  .replace(/^\s*(번역|Translation)\s*[:：]\s*/i, "")
  .trim();

// Resolves to null when aborted.
export async function generate(messages, opts = {}) {
  const e = await ensureEngine();
  let raw = "";
  try {
    for await (const piece of e.stream(messages, opts)) {
      raw += piece;
      opts.onText?.(tidy(raw));
      if (opts.signal?.aborted) break;
    }
  } catch (err) {
    if (!opts.signal?.aborted) throw err;
  }
  return opts.signal?.aborted ? null : tidy(raw);
}
