// Every assigned, visible character in Unicode's Basic and Supplementary
// Multilingual planes: letters, numbers, punctuation and symbols. Left out:
// combining marks (they only decorate a base letter), spaces, controls, private
// use, and planes 2-3 (rare CJK ideographs most systems draw as placeholder boxes).
let cache: string | null = null;

export function unicodeChars(): string {
  if (cache) return cache;
  const visible = /[\p{L}\p{N}\p{P}\p{S}]/u;
  const out = [" "];
  for (let cp = 0x21; cp < 0x20000; cp++) {
    const ch = String.fromCodePoint(cp);
    if (visible.test(ch)) out.push(ch);
  }
  return (cache = out.join(""));
}
