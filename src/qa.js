import { exclusive, generate } from "./llm/engine.js";
import { ANSWER_SYSTEM, KEYWORDS_SYSTEM } from "./llm/prompts.js";
import { search, summaryParagraphs } from "./search.js";

export async function answer(paper, question, { kind, pinned, onText } = {}) {
  return exclusive(async () => {
    let query = question;
    // Korean question, English paper: search with English keywords too.
    if (paper.dir === "en2ko" && /[가-힣]/.test(question) && kind !== "summary") {
      const keywords = await generate(
        [{ role: "system", content: KEYWORDS_SYSTEM }, { role: "user", content: question }],
        { temperature: 0, maxTokens: 48 }
      );
      query += ` ${keywords ?? ""}`;
    }

    let include = [];
    if (kind === "summary") {
      include = summaryParagraphs(paper);
      query += " propose contribution result show achieve";
    }
    if (pinned != null) include = [pinned, pinned + 1].filter((i) => paper.paras[i]?.kind === "text");

    const ids = search(paper, query, { budget: pinned != null ? 1800 : 3000, include });
    const excerpts = ids.map((i) => `[p.${paper.paras[i].page}] ${paper.paras[i].src.slice(0, 1400)}`).join("\n\n");
    const previous = (paper.chat ?? []).slice(-1).flatMap((c) => [
      { role: "user", content: c.q },
      { role: "assistant", content: c.a.slice(0, 500) },
    ]);
    const prompt = `논문 제목: ${paper.title}\n\n발췌:\n${excerpts || "(관련 부분을 찾지 못했어요)"}\n\n질문: ${question}`;

    const text = await generate(
      [{ role: "system", content: ANSWER_SYSTEM }, ...previous, { role: "user", content: prompt }],
      { temperature: 0.4, maxTokens: 700, onText }
    );
    return { text, pages: [...new Set(ids.map((i) => paper.paras[i].page))] };
  });
}
