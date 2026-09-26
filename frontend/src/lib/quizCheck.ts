/** Checking a typed quiz answer: forgiving about case, accents, punctuation and small typos. */

export type Verdict = 'correct' | 'close' | 'wrong'

export function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/^(?:the|an|a) /, '')
    .trim()
}

function distance(a: string, b: string): number {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

/**
 * "correct": the same once normalized; "close": a typo or two away (counts as
 * right, with a note to check the spelling); otherwise "wrong".
 */
export function checkAnswer(typed: string, expected: string): Verdict {
  const a = normalize(typed)
  const b = normalize(expected)
  if (!a) return 'wrong'
  if (a === b) return 'correct'
  // Short answers (drug classes, numbers) must be exact; longer ones allow ~1 typo per 6 letters.
  const allowed = b.length <= 4 || /^\d/.test(b) ? 0 : Math.max(1, Math.floor(b.length / 6))
  return distance(a, b) <= allowed ? 'close' : 'wrong'
}
