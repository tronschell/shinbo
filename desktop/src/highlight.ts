
export type TokenKind = "comment" | "string" | "number" | "keyword" | "tag" | "attr";
export interface Token { text: string; kind?: TokenKind }

const KEYWORDS = new Set(`
and as async await break case catch class const constructor continue declare def default defer delete do
elif else enum export extends extern false final finally fn for from func function global go if impl implements
import in include inline interface is lambda let loop match mod module move mut new nil none not null nullptr
or override package pass private protected pub public raise readonly return self static struct super switch
template then this throw trait true try type typedef typeof undefined union unsafe use using var void when
where while with yield
`.trim().split(/\s+/));

const HASH = /^(sh|bash|zsh|shell|console|fish|py|python|rb|ruby|pl|perl|r|ya?ml|toml|ini|conf|cfg|env|make(file)?|dockerfile|nix|gitignore)$/i;

const CORE = String.raw`\/\*[\s\S]*?(?:\*\/|$)|<!--[\s\S]*?(?:-->|$)|\/\/[^\n]*)|("(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|\x60(?:\\.|[^\x60\\])*\x60?)|(<\/?[A-Za-z][\w.:-]*)|(\b\d[\w.]*)|([A-Za-z_$@#-][\w$-]*)`;

const PLAIN = new RegExp(`(${CORE}`, "g");
const HASHED = new RegExp(String.raw`(#[^\n]*|` + CORE, "g");

export function tokenize(text: string, language = ""): Token[] {
  if (text.length > 32_768) return [{ text }];
  const pattern = HASH.test(language) ? HASHED : PLAIN;
  const tokens: Token[] = [];
  let last = 0;
  const plain = (end: number) => { if (end > last) tokens.push({ text: text.slice(last, end) }); };

  for (const match of text.matchAll(pattern)) {
    const [whole, comment, string, tag, number, word] = match;
    plain(match.index);
    last = match.index + whole.length;
    if (comment) tokens.push({ text: whole, kind: "comment" });
    else if (string) tokens.push({ text: whole, kind: "string" });
    else if (tag) tokens.push({ text: whole, kind: "tag" });
    else if (number) tokens.push({ text: whole, kind: "number" });
    else if (KEYWORDS.has(word)) tokens.push({ text: whole, kind: "keyword" });
    else if (/^[:=](?!=)/.test(text.slice(last))) tokens.push({ text: whole, kind: "attr" });
    else tokens.push({ text: whole });
  }
  plain(text.length);
  return tokens;
}
