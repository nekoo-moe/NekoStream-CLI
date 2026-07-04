import { spawn, execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
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

    let electronBinary: string
    try {
      electronBinary = require('electron') as unknown as string
      if (!fs.existsSync(electronBinary)) {
        throw new Error('Electron binary executable file not found')
      }
    } catch (e) {
      console.log('⚠️  Electron is not installed correctly or missing. Attempting automatic download/repair...')
      try {
        const installScript = path.join(basePath, 'node_modules', 'electron', 'install.js')
        if (fs.existsSync(installScript)) {
          execSync(`node "${installScript}"`, { stdio: 'inherit', env: process.env })
          
          // Clear require cache for electron module to force reload
          delete require.cache[require.resolve('electron')]
          electronBinary = require('electron') as unknown as string
          if (!fs.existsSync(electronBinary)) {
            throw new Error('Electron binary still missing after running install.js')
          }
          console.log('✅ Electron repaired successfully!')
        } else {
          throw new Error('electron install.js script not found')
        }
      } catch (repairErr: any) {
        reject(new Error(`Failed to resolve or install Electron automatically. Please run "npm install electron" or "node node_modules/electron/install.js" manually.\nDetails: ${repairErr.message}`))
        return
      }
    }

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
