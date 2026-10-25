// gpu: WebLLM (WebGPU). cpu: wllama (llama.cpp compiled to wasm). gb is the approximate download size.
export const MODELS = {
  fast: {
    label: "빠르게",
    note: "Qwen3.5 0.8B. 대부분의 휴대폰에서 가볍게 돌아가요.",
    gpu: { f16: "Qwen3.5-0.8B-q4f16_1-MLC", f32: "Qwen3.5-0.8B-q4f32_1-MLC", gb: 1.6 },
    cpu: { repo: "unsloth/Qwen3.5-0.8B-GGUF", file: "Qwen3.5-0.8B-Q4_K_M.gguf", gb: 0.53, qwen: true },
  },
  balanced: {
    label: "권장",
    note: "Qwen3.5 2B. 번역 품질과 속도의 균형이 가장 좋아요.",
    gpu: { f16: "Qwen3.5-2B-q4f16_1-MLC", f32: "Qwen3.5-2B-q4f32_1-MLC", gb: 2.2 },
    cpu: { repo: "unsloth/Qwen3.5-2B-GGUF", file: "Qwen3.5-2B-Q4_K_M.gguf", gb: 1.28, qwen: true },
  },
  best: {
    label: "정확하게",
    note: "메모리 8GB 이상인 폰용. GPU는 Qwen3.5 4B, CPU는 Gemma 3 4B를 써요.",
    gpu: { f16: "Qwen3.5-4B-q4f16_1-MLC", f32: "Qwen3.5-4B-q4f32_1-MLC", gb: 3.9 },
    cpu: { repo: "unsloth/gemma-3-4b-it-GGUF", file: "gemma-3-4b-it-Q3_K_M.gguf", gb: 2.1, qwen: false },
  },
};

const STORAGE_KEY = "mop-settings";

function stored() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
  } catch {
    return {};
  }
}

export const settings = {
  modelSize: navigator.deviceMemory && navigator.deviceMemory <= 4 ? "fast" : "balanced",
  engine: "auto",
  fontSize: 17,
  keepAwake: true,
  gpuFailed: false,
  ...stored(),
};

export function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}
