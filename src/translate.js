import { ensureEngine, exclusive, generate } from "./llm/engine.js";
import { HEADING_HINT, RETRY_HINT, TRANSLATE_PREFIX, TRANSLATE_SYSTEM, lookupHeading } from "./llm/prompts.js";
import { savePaper } from "./db.js";
import { hangulRatio } from "./util.js";

export const isTranslatable = (p) => p.kind === "text" || p.kind === "h";

export function progressOf(paper) {
  let total = 0;
  let done = 0;
  for (const p of paper.paras) {
    if (!isTranslatable(p)) continue;
    total += p.src.length;
    if (p.ko) done += p.src.length;
  }
  return total ? done / total : 0;
}

function inTargetLanguage(text, dir) {
  if (dir === "ko2en") return hangulRatio(text) < 0.2;
  const han = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  return hangulRatio(text) > 0.25 && han === 0;
}

// The model context is 4k tokens, so long paragraphs go in sentence-aligned pieces.
export function splitPieces(text, max = 1100) {
  if (text.length <= max) return [text];
  const sentences = text.match(/[^.!?。]+[.!?。]+["”)\]]*\s*|[^.!?。]+$/g) ?? [text];
  const pieces = [];
  let buffer = "";
  for (const s of sentences) {
    if (buffer && (buffer + s).length > max) {
      pieces.push(buffer.trim());
      buffer = "";
    }
    buffer += s;
  }
  if (buffer.trim()) pieces.push(buffer.trim());
  return pieces;
}

class Translator {
  running = false;
  paperId = null;
  priority = null;
  #abort = null;
  #rate = { chars: 0, ms: 0 };

  async #translatePiece(paper, piece, hint, signal, onText) {
    const messages = [
      { role: "system", content: TRANSLATE_SYSTEM[paper.dir] },
      { role: "user", content: TRANSLATE_PREFIX[paper.dir] + hint + piece },
    ];
    const maxTokens = Math.min(1400, Math.round(piece.length * 1.2) + 120);
    return exclusive(() => generate(messages, { temperature: 0.2, maxTokens, signal, onText }));
  }

  async translateParagraph(paper, index, onLive) {
    const para = paper.paras[index];
    if (para.kind === "h") {
      const known = lookupHeading(para.src, paper.dir);
      if (known) return known;
    }
    let done = "";
    for (const piece of splitPieces(para.src)) {
      this.#abort = new AbortController();
      const signal = this.#abort.signal;
      const onText = (t) => onLive?.(done ? `${done} ${t}` : t);
      const started = performance.now();
      const hint = para.kind === "h" ? HEADING_HINT[paper.dir] : "";

      let out = await this.#translatePiece(paper, piece, hint, signal, onText);
      // Small models sometimes echo the source or drift into Chinese; give them one more try.
      if (out != null && !inTargetLanguage(out, paper.dir) && piece.length > 20) {
        out = await this.#translatePiece(paper, piece, RETRY_HINT[paper.dir], signal, onText);
      }
      if (out == null) return null;

      this.#rate.chars += piece.length;
      this.#rate.ms += performance.now() - started;
      done = done ? `${done} ${out}` : out;
    }
    return done;
  }

  next(paper, from) {
    const open = (i) => paper.paras[i] && isTranslatable(paper.paras[i]) && !paper.paras[i].ko;
    if (this.priority != null) {
      const i = this.priority;
      this.priority = null;
      if (open(i)) return i;
    }
    for (let i = Math.max(0, from - 1); i < paper.paras.length; i++) if (open(i)) return i;
    for (let i = 0; i < paper.paras.length; i++) if (open(i)) return i;
    return -1;
  }

  eta(paper) {
    const pct = Math.round(progressOf(paper) * 100);
    if (this.#rate.chars < 300) return `번역 중 ${pct}%`;
    let left = 0;
    for (const p of paper.paras) if (isTranslatable(p) && !p.ko) left += p.src.length;
    const minutes = Math.ceil((left / this.#rate.chars) * this.#rate.ms / 60000);
    const when = minutes < 60 ? `${minutes}분` : `${Math.round(minutes / 6) / 10}시간`;
    return `번역 중 ${pct}%, 남은 시간 약 ${when}`;
  }

  // hooks: cursor() -> index to start near, live(i, text), saved(i), status(text), stopped()
  async run(paper, hooks) {
    if (this.running) return;
    this.running = true;
    this.paperId = paper.id;
    try {
      await ensureEngine();
      while (this.running && this.paperId === paper.id) {
        if (document.hidden) {
          hooks.status("화면으로 돌아오면 이어서 번역해요.");
          await new Promise((resolve) => document.addEventListener("visibilitychange", resolve, { once: true }));
          continue;
        }
        const i = this.next(paper, hooks.cursor());
        if (i < 0) {
          hooks.status("번역을 모두 마쳤어요.");
          break;
        }
        hooks.status(this.eta(paper));
        const text = await this.translateParagraph(paper, i, (t) => hooks.live(i, t));
        if (text) {
          paper.paras[i].ko = text;
          await savePaper(paper);
        }
        hooks.saved(i);
      }
    } catch (err) {
      console.error(err);
      hooks.status(err.message || "번역 중 문제가 생겼어요.");
      throw err;
    } finally {
      this.running = false;
      hooks.stopped();
    }
  }

  stop() {
    this.running = false;
    this.#abort?.abort();
  }

  // Drop the paragraph in progress so a question can go first; the loop picks it up again afterwards.
  yieldTurn() {
    if (this.running) this.#abort?.abort();
  }
}

export const translator = new Translator();
