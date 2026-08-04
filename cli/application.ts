import { initDiscord } from '../discord'
import { debugLog } from '../logger'
import { resolveProviderDomains } from './domain-startup'
import { showHomeMenu } from './menus/home-menu'
import { checkUpdate } from './update-check'

/**
 * Application entry point: bring up the runtime services, then hand control to
 * the home menu loop, which owns the interactive session until exit.
 *
 * Domain resolution runs after the update check — that one already exits the
 * process when a newer version exists, so there is no point probing first.
 */
export async function runApplication(): Promise<void> {
  await checkUpdate()
  await resolveProviderDomains()
  await initDiscord()
  debugLog('NekoStream CLI started')

  await showHomeMenu()
}
