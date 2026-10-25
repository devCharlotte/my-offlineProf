export const TRANSLATE_SYSTEM = {
  en2ko:
    "You are an expert academic translator. Translate the English text from a research paper into natural, fluent Korean for a graduate student. " +
    "Keep math, symbols, variable names, citation markers like [12], numbers and code exactly as they are. " +
    "For important technical terms, write the Korean term followed by the original English in parentheses, e.g. 주의 메커니즘(attention mechanism). " +
    "Never use Chinese or Japanese characters. Output only the Korean translation.",
  ko2en:
    "You are an expert academic translator. Translate the Korean text from a research paper into clear, natural academic English. " +
    "Keep math, symbols, variable names, citation markers like [12], numbers and code exactly as they are. Output only the English translation.",
};

// Small models follow an instruction in the user turn far better than one in the system prompt alone.
export const TRANSLATE_PREFIX = {
  en2ko: "다음 영어 논문 내용을 자연스러운 한국어로 번역하세요. 번역문만 출력하세요.\n\n",
  ko2en: "Translate the following Korean text from a research paper into English. Output only the translation.\n\n",
};

export const HEADING_HINT = {
  en2ko: "(논문의 장 제목이에요. 제목만 짧게 옮기세요.)\n",
  ko2en: "(This is a section heading. Translate only the heading.)\n",
};

export const RETRY_HINT = {
  en2ko: "반드시 한국어로만 쓰세요. 한자나 중국어는 쓰지 마세요.\n",
  ko2en: "Write in English only.\n",
};

export const KEYWORDS_SYSTEM =
  "Convert the student's Korean question about an English research paper into 4 to 8 English search keywords. " +
  "Output only the keywords separated by commas.";

export const ANSWER_SYSTEM =
  "You are a kind, sharp professor helping a student read a research paper on their phone during a commute. " +
  "Answer in Korean, clearly and concisely (at most about 8 sentences unless the student asks for more). " +
  "Base your answer only on the excerpts given. Cite page numbers like (p.3) after the claims they support. " +
  "If the excerpts do not contain the answer, say that you could not find it in this part of the paper and suggest which section to read.";

// Common section titles are looked up directly; small models tend to invent titles from one word.
const HEADINGS = {
  abstract: "초록", introduction: "서론", background: "배경", "related work": "관련 연구", "related works": "관련 연구",
  method: "방법", methods: "방법", methodology: "방법론", approach: "접근 방법", model: "모델", "model architecture": "모델 구조",
  experiment: "실험", experiments: "실험", "experimental setup": "실험 설정", results: "결과", evaluation: "평가",
  discussion: "논의", conclusion: "결론", conclusions: "결론", limitations: "한계", "future work": "향후 연구",
  acknowledgments: "감사의 글", acknowledgements: "감사의 글", references: "참고문헌", appendix: "부록", training: "학습",
};
const HEADINGS_KO = Object.fromEntries(
  Object.entries(HEADINGS).map(([en, ko]) => [ko, en[0].toUpperCase() + en.slice(1)])
);

export function lookupHeading(text, dir) {
  const [, number = "", title = text] = text.match(/^((?:\d+(?:\.\d+)*\.?|[IVX]+\.|[A-Z]\.)\s+)?(.+)$/) ?? [];
  const found = dir === "en2ko" ? HEADINGS[title.trim().toLowerCase()] : HEADINGS_KO[title.trim()];
  return found ? number + found : null;
}
