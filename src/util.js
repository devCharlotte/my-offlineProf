export const $ = (id) => document.getElementById(id);

let toastTimer;
export function toast(message, ms = 2800) {
  const el = $("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

export function hangulRatio(text) {
  const letters = text.match(/[A-Za-z가-힣]/g)?.length ?? 0;
  const hangul = text.match(/[가-힣]/g)?.length ?? 0;
  return letters ? hangul / letters : 0;
}

export const formatGB = (gb) => String(+gb.toFixed(1));

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export async function shareOrDownload(file) {
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: file.name });
      return;
    }
  } catch (err) {
    if (err.name === "AbortError") return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
