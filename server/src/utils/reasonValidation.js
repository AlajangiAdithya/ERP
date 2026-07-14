// ────────────────────────────────────────────────────────────────
// Meaningful-reason validation.
//
// Users were bypassing required "Reason for delay" / "Reason for not
// accepted" fields by mashing the keyboard ("dfjdlkjflsd", "asdf", "test").
// This heuristic rejects gibberish and placeholder text while allowing any
// genuine free-text reason (English or transliterated).
//
// It is intentionally lenient — it only blocks text that is obviously not a
// real reason. Kept in sync with client/src/utils/reasonValidation.js.
// ────────────────────────────────────────────────────────────────

const VOWELS = 'aeiou';
const CONSONANT_RUN = /[bcdfghjklmnpqrstvwxyz]{5,}/i; // 5+ consonants in a row
const SAME_CHAR_RUN = /(.)\1{3,}/i; // same char 4+ times (aaaa, llll)

// Exact full-string placeholders people type to skip the field (letters only,
// lowercased, spaces stripped). Genuine reasons never reduce to one of these.
const PLACEHOLDERS = new Set([
  'na', 'nil', 'none', 'no', 'nan', 'null', 'test', 'testing', 'asdf', 'asdfasdf',
  'asdfghjkl', 'qwerty', 'qwertyuiop', 'zxcvbn', 'zxcvbnm', 'abc', 'abcabc', 'abcd',
  'xxx', 'xxxx', 'xyz', 'aaa', 'sdf', 'sdfsdf', 'dfd', 'fff', 'ok', 'okay', 'done',
  'ghhg', 'hjk', 'jkl', 'lorem', 'loremipsum', 'random', 'yes', 'idk',
]);

function isGibberishWord(word) {
  const letters = word.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 4) return false; // short words (of, to, the) are fine
  const lower = letters.toLowerCase();
  const vowelCount = [...lower].filter((c) => VOWELS.includes(c)).length;
  if (vowelCount === 0) return true; // long token with zero vowels → mash
  if (letters.length >= 6 && vowelCount / letters.length < 0.15) return true;
  if (CONSONANT_RUN.test(lower)) return true;
  if (SAME_CHAR_RUN.test(lower)) return true;
  return false;
}

/**
 * @param {string} raw
 * @param {{ minLength?: number, minWords?: number, fieldLabel?: string }} [opts]
 * @returns {{ ok: boolean, error?: string, cleaned?: string }}
 */
function validateReason(raw, opts = {}) {
  const { minLength = 12, minWords = 2, fieldLabel = 'reason' } = opts;
  const text = String(raw == null ? '' : raw).trim();

  if (!text) return { ok: false, error: `Please enter a ${fieldLabel}.` };
  if (text.length < minLength) {
    return { ok: false, error: `Please enter a clearer ${fieldLabel} (at least ${minLength} characters).` };
  }

  const letters = text.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 8) {
    return { ok: false, error: `Please describe the ${fieldLabel} in words.` };
  }

  const collapsed = letters.toLowerCase();
  if (PLACEHOLDERS.has(collapsed)) {
    return { ok: false, error: `Please enter a genuine ${fieldLabel}, not placeholder text.` };
  }

  const words = text.split(/\s+/).filter(Boolean);
  const alphaWords = words.filter((w) => /[a-zA-Z]/.test(w));
  if (alphaWords.length < minWords) {
    return { ok: false, error: `Please enter a proper ${fieldLabel} in at least ${minWords} words.` };
  }

  // All words identical ("test test test") → not a real reason.
  const distinctWords = new Set(alphaWords.map((w) => w.toLowerCase().replace(/[^a-z]/g, '')));
  if (alphaWords.length >= 2 && distinctWords.size === 1) {
    return { ok: false, error: `Please enter a meaningful ${fieldLabel}.` };
  }

  // Per-word gibberish: if most of the substantial words look like mash, reject.
  const longWords = alphaWords.filter((w) => w.replace(/[^a-zA-Z]/g, '').length >= 4);
  const badWords = longWords.filter(isGibberishWord);
  if (longWords.length > 0 && badWords.length / longWords.length > 0.5) {
    return { ok: false, error: `This doesn't look like a real ${fieldLabel}. Please describe the actual reason.` };
  }

  // Whole-string vowel ratio — keyboard mashing is vowel-starved.
  const vowelTotal = [...collapsed].filter((c) => VOWELS.includes(c)).length;
  if (letters.length >= 10 && vowelTotal / letters.length < 0.18) {
    return { ok: false, error: `This doesn't look like a real ${fieldLabel}. Please describe the actual reason.` };
  }

  // Extremely low character variety ("asdfasdfasdf", "aaaaaaaa aaaa").
  const uniqueChars = new Set(collapsed).size;
  if (letters.length >= 12 && uniqueChars <= 4) {
    return { ok: false, error: `This doesn't look like a real ${fieldLabel}. Please describe the actual reason.` };
  }

  return { ok: true, cleaned: text };
}

module.exports = { validateReason, isGibberishWord };
