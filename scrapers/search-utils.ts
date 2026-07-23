export type SearchableResult = {
  id: string
  title: string
  titleAlt?: string
}

type NormalizedText = {
  accented: string
  folded: string
  tokens: string[]
}

type ScoredResult<T> = {
  item: T
  score: number
  index: number
}

const DISPLAY_LABEL = '(?:vietsub|thuyết minh|lồng tiếng|fhd|hd|full|tập\\s+\\d+)'
const BRACKETED_LABEL = new RegExp(`\\s*[\\[(]\\s*${DISPLAY_LABEL}\\s*[\\])]\\s*$`, 'iu')
const TRAILING_LABEL = new RegExp(`(?:\\s*[-–—|:]\\s*|\\s+)${DISPLAY_LABEL}\\s*$`, 'iu')

export function cleanSearchQuery(input: string): string {
  return String(input || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripDisplayLabels(input: string): string {
  let value = input
  let previous = ''
  while (value !== previous) {
    previous = value
    value = value.replace(BRACKETED_LABEL, '').replace(TRAILING_LABEL, '').trim()
  }
  return value
}

function normalizeText(input: string): NormalizedText {
  const accented = stripDisplayLabels(cleanSearchQuery(input))
    .toLocaleLowerCase('vi-VN')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const folded = accented
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
  const tokens = folded
    .split(' ')
    .filter((token) => token.length >= 3 || /^\d+$/.test(token))

  return { accented, folded, tokens }
}

function hasVietnameseMarks(text: NormalizedText): boolean {
  return text.accented !== text.folded
}

function containsWholePhrase(text: string, query: string): boolean {
  return Boolean(query) && ` ${text} `.includes(` ${query} `)
}

function startsWithWholePhrase(text: string, query: string): boolean {
  return Boolean(query) && (text === query || text.startsWith(`${query} `))
}

function scoreTitle(title: string | undefined, query: NormalizedText, isAlt: boolean): number {
  if (!title) return 0
  const candidate = normalizeText(title)
  if (!candidate.folded || !query.folded) return 0

  const offset = isAlt ? 30 : 0
  const queryHasMarks = hasVietnameseMarks(query)
  const canUseBroadMatch = query.folded.length >= 3 || /^\d+$/.test(query.folded)

  if (queryHasMarks && candidate.accented === query.accented) return 1000 - offset
  if (candidate.folded === query.folded) return 940 - offset

  if (canUseBroadMatch) {
    if (queryHasMarks && startsWithWholePhrase(candidate.accented, query.accented)) return 850 - offset
    if (startsWithWholePhrase(candidate.folded, query.folded)) return 800 - offset
    if (queryHasMarks && containsWholePhrase(candidate.accented, query.accented)) return 700 - offset
    if (containsWholePhrase(candidate.folded, query.folded)) return 650 - offset
  }

  if (query.tokens.length === 0) return 0
  const candidateTokens = new Set(candidate.tokens)
  const matchedTokens = query.tokens.filter((token) => candidateTokens.has(token)).length
  const coverage = matchedTokens / query.tokens.length
  if (coverage < 0.6) return 0

  return Math.round(400 + coverage * 100) - (isAlt ? 20 : 0)
}

export function rankSearchResults<T extends SearchableResult>(items: T[], query: string, limit: number): T[] {
  const normalizedQuery = normalizeText(query)
  if (!normalizedQuery.folded || limit <= 0) return []

  const byId = new Map<string, ScoredResult<T>>()

  items.forEach((item, index) => {
    const score = Math.max(
      scoreTitle(item.title, normalizedQuery, false),
      scoreTitle(item.titleAlt, normalizedQuery, true)
    )
    if (score === 0) return

    const id = cleanSearchQuery(item.id).toLocaleLowerCase('vi-VN')
    if (!id) return
    const current = byId.get(id)
    if (!current || score > current.score) {
      byId.set(id, { item, score, index })
    }
  })

  return [...byId.values()]
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ item }) => item)
}
