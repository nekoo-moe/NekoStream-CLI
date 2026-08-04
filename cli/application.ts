import { initDiscord } from '../discord'
import { debugLog } from '../logger'
import { showHomeMenu } from './menus/home-menu'
import { checkUpdate } from './update-check'

/**
 * Application entry point: bring up the runtime services, then hand control to
 * the home menu loop, which owns the interactive session until exit.
 */
export async function runApplication(): Promise<void> {
  await checkUpdate()
  await initDiscord()
  debugLog('NekoStream CLI started')

  await showHomeMenu()
}
