import chalk from 'chalk'
import ora, { type Ora } from 'ora'
import { debugLog } from '../logger'
import { resolveAllDomains, type ResolveOutcome } from '../scrapers/domain-resolver'
import { CONFIRM_DELAY_MS, sleep } from './feedback'

/**
 * The fast path — probing the domain already in use — normally answers well
 * inside this window, so no spinner is drawn at all and startup looks unchanged.
 * The spinner only appears once resolution is slow enough to mean the current
 * domain failed and the TLD fan-out is running.
 */
const SPINNER_DELAY_MS = 900

function summarize(outcomes: ResolveOutcome[]): { changed: ResolveOutcome[]; failed: ResolveOutcome[] } {
  return {
    changed: outcomes.filter((o) => o.status === 'ok' && o.changed),
    failed: outcomes.filter((o) => o.status === 'failed')
  }
}

/**
 * A spinner that only materialises if the work outlives `SPINNER_DELAY_MS`.
 *
 * The state is kept behind functions rather than a local variable because the
 * assignment happens inside a timer callback: TypeScript's control-flow analysis
 * cannot see across that boundary and narrows a plain `let` to `null` forever.
 */
function delayedSpinner(text: string): { stop: () => void; wasShown: () => boolean } {
  let spinner: Ora | undefined
  const timer = setTimeout(() => {
    spinner = ora(text).start()
  }, SPINNER_DELAY_MS)

  return {
    stop: () => {
      clearTimeout(timer)
      spinner?.stop()
    },
    wasShown: () => spinner !== undefined
  }
}

/**
 * Pick each provider's live domain before the menu opens.
 *
 * Startup resolution is what turns domain discovery from reactive into
 * proactive: previously a moved provider surfaced as three failed retries and a
 * Playwright escalation in the middle of a search, and only then fell back.
 *
 * This never rejects and never blocks entry to the app. Offline or slow hosts
 * simply mean the cached or seeded domain is used as-is.
 */
export async function resolveProviderDomains(): Promise<void> {
  const spinner = delayedSpinner('Đang dò domain provider...')

  let outcomes: ResolveOutcome[] = []
  try {
    outcomes = await resolveAllDomains()
  } finally {
    spinner.stop()
  }

  for (const outcome of outcomes) {
    debugLog(`[Domain] ${outcome.provider}: ${outcome.status} -> ${outcome.baseUrl}`)
  }

  const { changed, failed } = summarize(outcomes)

  // Only speak up when something actually moved. A silent startup is the
  // expected case and the whole point of the fast path.
  if (changed.length > 0) {
    for (const outcome of changed) {
      console.log(chalk.cyan(`  Domain ${outcome.provider} đã đổi -> ${outcome.baseUrl}`))
    }
    await sleep(CONFIRM_DELAY_MS)
    return
  }

  // Only mention a failure if the spinner had appeared. Without that guard an
  // offline user gets a warning about a domain probe they never asked for and
  // cannot act on; with it, the line only follows visible work.
  if (failed.length > 0 && spinner.wasShown()) {
    const names = failed.map((o) => o.provider).join(', ')
    console.log(chalk.yellow(`  Không dò được domain sống cho: ${names}. Dùng domain đã lưu.`))
    await sleep(CONFIRM_DELAY_MS)
  }
}
