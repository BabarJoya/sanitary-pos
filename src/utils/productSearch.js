// ============================================================================
// Product search that forgives the way shops type: spelling mistakes
// ("mixar"), Roman-Urdu words ("tonti" → tap, "nalka"), sounds-alike spellings
// ("paip" / "pipe"), and gives a boost to items sold often on this counter.
// Pure functions — no imports — so they are unit-tested (tests/search.test.js).
// ============================================================================

// Roman-Urdu / common shop words → what the product is usually called
const SYNONYMS = {
  tonti: ['tap', 'cock'], tooti: ['tap', 'cock'], toti: ['tap', 'cock'], nalka: ['tap', 'pump'], nal: ['tap', 'pipe'],
  paip: ['pipe'], pyp: ['pipe'], pip: ['pipe'], tanki: ['tank'], tenki: ['tank'], jali: ['grating', 'drain', 'jali'],
  kamod: ['commode'], comod: ['commode'], kamode: ['commode'], sink: ['basin', 'sink'], besin: ['basin'], basen: ['basin'],
  shawar: ['shower'], showar: ['shower'], fawara: ['shower', 'fountain'], miksar: ['mixer'], mixar: ['mixer'],
  albo: ['elbow'], elbo: ['elbow'], kohni: ['elbow'], te: ['tee'], wal: ['valve'], walv: ['valve'], wolv: ['valve'],
  flash: ['flush'], flesh: ['flush'], soket: ['socket'], sokit: ['socket'], nozel: ['nozzle'], nozal: ['nozzle'],
  geezer: ['geyser'], gizer: ['geyser'], gyser: ['geyser'], tub: ['tub', 'bathtub'], sheesha: ['mirror'], shisha: ['mirror'],
  dhakkan: ['cover', 'lid', 'cap'], dhakan: ['cover', 'lid', 'cap'], dhakna: ['cover', 'lid', 'cap'],
  seat: ['seat'], pipa: ['pipe'], gola: ['ball', 'float'], botal: ['bottle', 'trap'], tapa: ['tap'],
}

const MIN_FUZZY = 4 // words shorter than this must match exactly or by prefix

export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/["'`’]/g, '')
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ')
    .trim()
}

// Sounds-alike key: drop vowels and h after the first letter, merge doubles,
// and fold letters people swap in Roman Urdu (v/w, q/k, ph/f, z/j kept apart).
export function soundKey(word) {
  let w = normalize(word).replace(/\s+/g, '')
  if (!w) return ''
  w = w.replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/q/g, 'k').replace(/v/g, 'w').replace(/x/g, 'ks').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k')
  const first = w[0]
  const rest = w.slice(1).replace(/[aeiouyh]/g, '')
  return (first + rest).replace(/(.)\1+/g, '$1')
}

// Edit distance with an early exit once it is over `max`
export function editDistance(a, b, max = 2) {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev2 = null
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (prev2 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1) // swapped letters
      cur.push(v)
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    prev2 = prev
    prev = cur
  }
  return prev[b.length]
}

// Precompute once per product list
export function buildSearchIndex(products, extraText = () => '') {
  return products.map(p => {
    const text = normalize(`${p.name || ''} ${p.brand || ''} ${p.sku || ''} ${extraText(p) || ''}`)
    const words = [...new Set(text.split(' ').filter(Boolean))]
    return { p, text, words, keys: words.map(soundKey), sku: normalize(p.sku || '').replace(/\s+/g, ''), id: String(p.id ?? '') }
  })
}

// Best score of one query word against one product (0 = no match)
function tokenScore(tok, entry) {
  const tKey = soundKey(tok)
  let best = 0
  if (entry.sku && (entry.sku === tok.replace(/\s+/g, ''))) return 100
  if (entry.id && entry.id === tok) return 90
  if (entry.text.includes(tok)) best = 40
  for (let i = 0; i < entry.words.length; i++) {
    const w = entry.words[i]
    if (w === tok) return 60
    if (w.startsWith(tok)) best = Math.max(best, 50)
    if (best >= 40) continue
    if (tok.length >= MIN_FUZZY) {
      const d = editDistance(tok, w, tok.length >= 7 ? 2 : 1)
      if (d <= (tok.length >= 7 ? 2 : 1)) best = Math.max(best, 30 - d * 5)
      else if (tKey.length >= 2 && entry.keys[i] && (entry.keys[i] === tKey || entry.keys[i].startsWith(tKey))) best = Math.max(best, 22)
    }
  }
  return best
}

/**
 * Search: every query word must match (directly, by a synonym, a typo or by
 * sound). Returns products ordered by match quality, then by how often they
 * were sold (soldCount: Map/obj product_id → count). Empty query → all
 * products, best sellers first.
 */
export function searchProducts(index, query, soldCount = {}) {
  const sold = (p) => Number((soldCount instanceof Map ? soldCount.get(String(p.id)) : soldCount[String(p.id)]) || 0)
  const q = normalize(query)
  if (!q) {
    return index.map(e => e.p).map((p, i) => [p, sold(p), i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).map(x => x[0])
  }
  const tokens = q.split(' ').filter(Boolean)
  const out = []
  for (let i = 0; i < index.length; i++) {
    const e = index[i]
    let total = 0
    let ok = true
    for (const tok of tokens) {
      let s = tokenScore(tok, e)
      if (s === 0 && SYNONYMS[tok]) for (const alt of SYNONYMS[tok]) s = Math.max(s, tokenScore(alt, e) - 5)
      if (s === 0) { ok = false; break }
      total += s
    }
    if (ok) out.push([e.p, total, sold(e.p), i])
  }
  out.sort((a, b) => b[1] - a[1] || b[2] - a[2] || a[3] - b[3])
  return out.map(x => x[0])
}
