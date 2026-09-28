// Deterministic translation checks (Phase 13): mechanical defects a program
// can see without understanding the language — placeholders, numbers, units,
// negation, text left in English, the formal "Sie" register. Used by the
// localization suite on every key and as the offline baseline of the optional
// semantic review (tools/i18n-review.mjs). Never edits a translation.
const PH = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const NUM = (s) => [...String(s).replace(/\{\w+\}/g, ' ').matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0].replace(',', '.')).sort().join(',');
const UNITS = ['km/h', 'mph', 'km', 'mi', '%', 't', 'kg'];
const unitsOf = (s) => UNITS.filter((u) => new RegExp(`(^|[\\s\\d}])${u.replace('/', '\\/')}(?=$|[\\s.,;)])`).test(s)).join(',');
const EN_NEG = /\b(not|cannot|can't|don't|doesn't|won't|never|no|none|without|nothing|isn't|aren't)\b/i;
const DE_NEG = /(^|[^\p{L}])(nicht|kein\p{L}*|nie|niemals|ohne|nichts|weder|verboten|un\p{L}{4,})(?![\p{L}])/iu;
const EN_WORDS = /\b(the|and|with|your|you|to|of|for|this|here|build|send|train|nearest|click|tap)\b/gi;
// "Wählen Sie …", "Klicken Sie …": the formal imperative (the game says du);
// a plain "Sie"/"Ihre" is often "they"/"their" and is not flagged
const FORMAL = /(^|[.!?:]\s+)\p{Lu}\p{L}*en Sie\b/u;

// allowSame: English and German may be the same (names, loanwords)
export function lintPair(key, en, de, { allowSame = false } = {}) {
  const out = [];
  if (typeof en !== 'string' || typeof de !== 'string') return out;
  if (!de.trim() && en.trim()) out.push('empty');
  if (PH(en) !== PH(de)) out.push('placeholder');
  if (NUM(en) !== NUM(de)) out.push('number');
  if (unitsOf(en) !== unitsOf(de)) out.push('unit');
  if (EN_NEG.test(en) && !DE_NEG.test(de)) out.push('negation');
  const plain = de.replace(/\{\w+\}/g, ' ');
  if (!allowSame && en === de && /[a-z]{3,}\s+[a-z]{3,}/i.test(en)) out.push('untranslated');
  else if ((plain.match(EN_WORDS) || []).length >= 2) out.push('english_words');
  if (FORMAL.test(de)) out.push('formal_register');
  return out;
}

// precision / recall of a reviewer against the calibration pairs
export function score(pairs, flagged) {
  let tp = 0, fp = 0, fn = 0;
  for (const p of pairs) { const f = flagged.has(p.key); if (f && p.bad) tp++; else if (f) fp++; else if (p.bad) fn++; }
  return { tp, fp, fn, precision: tp + fp ? tp / (tp + fp) : 1, recall: tp + fn ? tp / (tp + fn) : 1 };
}
