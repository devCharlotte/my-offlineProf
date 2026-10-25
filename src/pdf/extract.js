import { hangulRatio } from "../util.js";

const VENDOR = new URL("../../vendor/pdfjs/", import.meta.url);

let loading;
function loadPdfjs() {
  loading ??= import(new URL("pdf.min.mjs", VENDOR).href).then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = new URL("pdf.worker.min.mjs", VENDOR).href;
    return lib;
  });
  return loading;
}

// The CMap files ship as one JSON bundle instead of ~170 small files.
let cmapBundle;
class BundledCMapFactory {
  async fetch({ kind, filename }) {
    if (kind !== "cMapUrl") throw new Error(`${kind} data is not bundled`);
    cmapBundle ??= fetch(new URL("cmaps.json", VENDOR)).then((r) => r.json());
    const data = (await cmapBundle)[filename.replace(/\.bcmap$/, "")];
    if (!data) throw new Error(`Unknown CMap: ${filename}`);
    return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  }
}

const SECTION_WORDS = /^(abstract|introduction|background|related work|method(s|ology)?|approach|experiments?|results?|discussion|conclusions?|limitations?|references|bibliography|acknowledg(e)?ments?|appendix|초록|서론|결론|참고\s*문헌|요약)\b/i;
const REFERENCES = /^(\d+\.?\s*)?(references|bibliography|참고\s*문헌)\s*$/i;
const APPENDIX = /^([A-Z]\.?\s+|\d+\.?\s*)?(appendix|supplementary)/i;
const NUMBERED = /^(\d+(\.\d+)*\.?|[IVX]+\.|[A-Z]\.)\s+\S/;

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

async function readLines(page) {
  const { items } = await page.getTextContent();
  const lines = [];
  let line = null;
  const close = () => {
    if (line) lines.push(line);
    line = null;
  };

  for (const item of items) {
    if (!("str" in item)) continue;
    const [a, b, , d, x, y] = item.transform;
    // Rotated text is usually an arXiv stamp or a figure label.
    if (Math.abs(b) > 0.1 || a <= 0) {
      if (item.hasEOL) close();
      continue;
    }
    const height = Math.abs(d) || item.height || 10;
    if (!item.str.trim() && !item.hasEOL) {
      if (line) line.text += " ";
      continue;
    }
    if (!line || Math.abs(y - line.y) > height * 0.6) {
      close();
      line = { x, y, h: height, text: "" };
    }
    line.text += item.str;
    line.h = Math.max(line.h, height);
    if (item.hasEOL) close();
  }
  close();

  return lines
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() }))
    .filter((l) => l.text);
}

// Running heads, footers and page numbers repeat across pages; drop them.
function dropRepeated(pages) {
  const key = (text) => text.replace(/\d+/g, "#").toLowerCase();
  const counts = new Map();
  for (const lines of pages) {
    for (const l of [...lines.slice(0, 2), ...lines.slice(-2)]) {
      counts.set(key(l.text), (counts.get(key(l.text)) ?? 0) + 1);
    }
  }
  const threshold = Math.max(2, pages.length * 0.4);
  return pages.map((lines) =>
    lines.filter((l, i) => {
      if (/^[\divxlc#\-–\s.]{1,8}$/i.test(l.text)) return false;
      const atEdge = i < 2 || i >= lines.length - 2;
      return !(atEdge && counts.get(key(l.text)) >= threshold);
    })
  );
}

async function guessTitle(doc, firstPage, fallback) {
  try {
    const title = (await doc.getMetadata())?.info?.Title?.trim();
    if (title && title.length > 8 && !/untitled|microsoft word|\.(pdf|dvi|tex|docx?)$/i.test(title)) return title;
  } catch {}
  const top = firstPage.slice(0, 15);
  if (!top.length) return fallback;
  const biggest = Math.max(...top.map((l) => l.h));
  return top.filter((l) => l.h >= biggest * 0.95).slice(0, 3).map((l) => l.text).join(" ") || fallback;
}

function groupParagraphs(pages) {
  const bodyHeight = median(pages.flat().map((l) => l.h)) || 10;
  const isHeading = (l) => {
    if (l.text.length >= 90 || /[.,;:]$/.test(l.text) || !/[A-Za-z가-힣]/.test(l.text)) return false;
    const words = l.text.split(" ").length;
    return (NUMBERED.test(l.text) && words <= 10)
      || (SECTION_WORDS.test(l.text) && words <= 6)
      || (l.h > bodyHeight * 1.18 && words <= 8);
  };

  const paragraphs = [];
  pages.forEach((lines, pageIndex) => {
    let para = null;
    let prev = null;
    for (const line of lines) {
      const heading = isHeading(line);
      const newColumn = prev && line.y - prev.y > prev.h * 2;
      const wideGap = prev && prev.y - line.y > Math.max(prev.h, line.h) * 1.75;
      const indented = prev && /[.!?:)"”]$/.test(prev.text)
        && line.x - para.left > line.h * 0.8 && line.x - prev.x > line.h * 0.8;

      if (!para || heading || prev.heading || newColumn || wideGap || indented) {
        if (para) paragraphs.push(para);
        para = { page: pageIndex + 1, text: line.text, heading, left: line.x };
      } else {
        const hyphenated = /[A-Za-z]-$/.test(para.text) && /^[a-z]/.test(line.text);
        para.text = hyphenated ? para.text.slice(0, -1) + line.text : `${para.text} ${line.text}`;
        para.left = Math.min(para.left, line.x);
      }
      prev = { ...line, heading };
    }
    if (para) paragraphs.push(para);
  });
  return paragraphs;
}

// kind: "h" heading, "text" body, "ref" reference list, "skip" footnotes and formula debris.
function classify(paragraphs) {
  const out = [];
  let inReferences = false;
  for (const p of paragraphs) {
    const text = p.text.trim();
    if (p.heading && REFERENCES.test(text)) inReferences = true;
    else if (p.heading && APPENDIX.test(text)) inReferences = false;

    const letters = text.match(/[A-Za-z가-힣]/g)?.length ?? 0;
    let kind = p.heading ? "h" : "text";
    if (inReferences && !(p.heading && REFERENCES.test(text))) kind = "ref";
    else if (kind === "text" && (text.length < 12 || letters / text.length < 0.45 || /^[∗*†‡§¶]/.test(text))) kind = "skip";

    const last = out.at(-1);
    if (kind === "text" && last?.kind === "text" && last.page === p.page && text.length < 60 && !/[.!?]$/.test(last.src)) {
      last.src += ` ${text}`;
      continue;
    }
    out.push({ i: out.length, page: p.page, kind, src: text, ko: null });
  }
  return out;
}

export async function extractPdf(file, onPage) {
  const lib = await loadPdfjs();
  const task = lib.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    BinaryDataFactory: BundledCMapFactory,
    cMapUrl: "bundled/",
    cMapPacked: true,
    useWorkerFetch: false,
    isEvalSupported: false,
  });
  const doc = await task.promise;

  let pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    pages.push(await readLines(page));
    page.cleanup();
    onPage?.(n, doc.numPages);
  }
  pages = dropRepeated(pages);

  const title = await guessTitle(doc, pages[0] ?? [], file.name.replace(/\.pdf$/i, ""));
  const paras = classify(groupParagraphs(pages));
  const sample = paras.filter((p) => p.kind === "text").slice(0, 30).map((p) => p.src).join(" ");
  await task.destroy();

  return {
    title,
    pages: pages.length,
    paras,
    dir: hangulRatio(sample) > 0.3 ? "ko2en" : "en2ko",
  };
}
