import { onProgress } from "./llm/engine.js";
import { registerView, showTab } from "./nav.js";
import { state } from "./state.js";
import { translator } from "./translate.js";
import { initAsk, renderAsk } from "./views/ask.js";
import { importSharedPdf, initLibrary, renderLibrary } from "./views/library.js";
import { initRead, renderRead } from "./views/read.js";
import { applyFontSize, initSetup, markModelReady, renderSetup, updateNetChip } from "./views/setup.js";

registerView("library", renderLibrary);
registerView("read", renderRead);
registerView("ask", renderAsk);
registerView("setup", renderSetup);

for (const button of document.querySelectorAll("nav.tabs button")) {
  button.onclick = () => showTab(button.dataset.tab);
}

initLibrary();
initRead();
initAsk();
initSetup();
applyFontSize();

onProgress((ratio) => {
  if (ratio >= 1) markModelReady();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch((err) => console.warn("service worker", err));
  // COOP/COEP headers come from the service worker, so the first controlled load needs one reload
  // before wllama can use threads.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (window.crossOriginIsolated || sessionStorage.getItem("mop-reloaded")) return;
    if (translator.running || state.asking) return;
    sessionStorage.setItem("mop-reloaded", "1");
    location.reload();
  });
}

updateNetChip();
renderLibrary().then(importSharedPdf);
