// Lexical search (BM25) over paragraphs. Korean is split into character bigrams.

const STOPWORDS = new Set(
  ("the a an of to in and or for on with by is are was were be been being this that these those we our us it its as at from " +
   "which can could using use used than into also has have had not but such each their they there between more most may might " +
   "will would should do does did via based both however thus while where when what how why who all any other one two").split(" ")
);

const stem = (word) => (word.length > 4 ? word.replace(/(ings?|ed|es|s)$/, "") : word);

export function tokenize(text) {
  const tokens = [];
  for (const w of text.toLowerCase().match(/[a-z][a-z0-9-]+/g) ?? []) {
    if (!STOPWORDS.has(w)) tokens.push(stem(w));
  }
  for (const run of text.match(/[가-힣]+/g) ?? []) {
    if (run.length === 1) tokens.push(run);
    for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2));
  }
  return tokens;
}

export function search(paper, query, { budget = 3000, include = [] } = {}) {
  const docs = paper.paras.map((p) => (p.kind === "text" || p.kind === "h" ? tokenize(`${p.src} ${p.ko ?? ""}`) : null));
  const n = docs.filter(Boolean).length || 1;
  const avgLength = docs.reduce((sum, d) => sum + (d?.length ?? 0), 0) / n;
  const docFreq = new Map();
  for (const d of docs) if (d) for (const t of new Set(d)) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);

  const terms = [...new Set(tokenize(query))];
  const scored = [];
  docs.forEach((d, i) => {
    if (!d || paper.paras[i].kind !== "text") return;
    const tf = new Map();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const t of terms) {
      const f = tf.get(t);
      if (!f) continue;
      const df = docFreq.get(t) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      score += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * d.length / avgLength));
    }
    if (score > 0) scored.push([score, i]);
  });

  const picked = new Set(include);
  let used = include.reduce((sum, i) => sum + paper.paras[i].src.length, 0);
  for (const [, i] of scored.sort((a, b) => b[0] - a[0])) {
    if (used > budget) break;
    if (picked.has(i)) continue;
    picked.add(i);
    used += Math.min(paper.paras[i].src.length, 1400);
  }
  return [...picked].sort((a, b) => a - b);
}

// Opening paragraphs plus the start of the conclusion: enough for a summary.
export function summaryParagraphs(paper) {
  const body = (from) => paper.paras.slice(from).filter((p) => p.kind === "text").map((p) => p.i);
  const opening = body(0).slice(0, 3);
  const conclusion = paper.paras.findIndex((p) => p.kind === "h" && /conclu|discussion|결론|맺음/i.test(p.src));
  return [...opening, ...(conclusion >= 0 ? body(conclusion + 1).slice(0, 2) : [])];
}
