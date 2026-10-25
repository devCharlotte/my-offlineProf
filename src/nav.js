import { state } from "./state.js";
import { $ } from "./util.js";

const views = new Map();

export function registerView(name, render) {
  views.set(name, render);
}

export function showTab(name) {
  state.tab = name;
  for (const button of document.querySelectorAll("nav.tabs button")) {
    button.setAttribute("aria-current", button.dataset.tab === name ? "page" : "false");
  }
  for (const view of document.querySelectorAll(".view")) view.hidden = view.id !== `view-${name}`;
  $("main").scrollTop = 0;
  views.get(name)?.();
}
