import chalk from 'chalk'
import ora from 'ora'
import { printError } from '../ui'

/** How long a transient message stays on screen before the menu repaints. */
export const NOTICE_DELAY_MS = 2000
export const CONFIRM_DELAY_MS = 1000

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function formatToggle(value?: boolean): string {
  return value ? chalk.green('Bật') : chalk.red('Tắt')
}

/**
 * Drain buffered keypresses so a prompt does not immediately consume input
 * typed while the previous screen was still rendering.
 */
export function flushStdin(): void {
  if (!process.stdin.isTTY) return
  process.stdin.resume()
  while (process.stdin.read() !== null) {
    // Discard whatever was buffered.
  }
}

export function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Print a failure and hold it on screen long enough to be read. */
export async function reportFailure(label: string, error?: unknown): Promise<void> {
  const detail = error === undefined ? '' : `: ${formatError(error)}`
  printError(`\n${label}${detail}`)
  await sleep(NOTICE_DELAY_MS)
}

/** Print an empty-result notice and hold it on screen. */
export async function reportEmpty(message: string): Promise<void> {
  printError(`\n${message}`)
  await sleep(NOTICE_DELAY_MS)
}

/**
 * Run an async task behind a spinner. Returns `undefined` when the task throws,
 * after showing `failure` to the user — callers treat that as "abort this step".
 */
export async function withSpinner<T>(
  message: string,
  failure: string,
  task: () => Promise<T>
): Promise<T | undefined> {
  const spinner = ora(message).start()
  try {
    const value = await task()
    spinner.stop()
    return value
  } catch (error) {
    spinner.stop()
    await reportFailure(failure, error)
    return undefined
  }
}

/**
 * Like {@link withSpinner} but keeps the spinner running on success so the
 * caller can decide the final message.
 */
export async function withSilentSpinner<T>(
  message: string,
  task: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  const spinner = ora(message).start()
  try {
    const value = await task()
    spinner.stop()
    return { ok: true, value }
  } catch (error) {
    spinner.stop()
    return { ok: false, error }
  }
}
