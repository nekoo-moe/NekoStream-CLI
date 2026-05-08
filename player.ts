import { spawn } from 'child_process'
import path from 'path'
import type { StreamInfo } from './scrapers/base'

export async function launchPlayer(streamInfo: StreamInfo) {
  return new Promise<void>((resolve, reject) => {
    const mainScript = path.join(__dirname, 'player-main.js')
    
    // Pass the streamInfo as a base64 encoded JSON environment variable
    const env = {
      ...process.env,
      NEKOSTREAM_CLI_STREAM: Buffer.from(JSON.stringify(streamInfo)).toString('base64')
    }

    // Use the local electron binary directly to avoid npx wrapper warnings
    const electronBinary = require('electron') as unknown as string

    const electronProcess = spawn(electronBinary, [mainScript], {
      env,
      stdio: 'inherit',
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
