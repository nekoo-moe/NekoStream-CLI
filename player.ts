import { spawn } from 'child_process'
import path from 'path'
import type { StreamInfo } from './scrapers/base'

export async function launchPlayer(streamInfo: StreamInfo) {
  return new Promise<void>((resolve, reject) => {
    // If compiled, __dirname is .../dist. If dev, __dirname is root.
    const isCompiled = __dirname.endsWith('dist') || __dirname.endsWith('dist\\') || __dirname.endsWith('dist/')
    const basePath = isCompiled ? path.join(__dirname, '..') : __dirname
    const mainScript = path.join(basePath, 'player-main.js')

    const env = {
      ...process.env,
      NEKOSTREAM_CLI_STREAM: Buffer.from(JSON.stringify(streamInfo)).toString('base64')
    }

    const electronBinary = require('electron') as unknown as string

    const electronProcess = spawn(electronBinary, [mainScript], {
      env,
      stdio: 'ignore',
      shell: false
    })

    electronProcess.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Player exited with code ${code}`))
      }
    })

    electronProcess.on('error', (err) => {
      reject(err)
    })
  })
}
