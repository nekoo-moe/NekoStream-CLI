import { spawn, execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import type { StreamInfo } from './scrapers/base'

function runWithTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timeout'))
    }, ms)
    fn().then(
      res => {
        clearTimeout(timer)
        resolve(res)
      },
      err => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

async function repairElectron(basePath: string): Promise<string> {
  const electronPkgPath = path.join(basePath, 'node_modules', 'electron', 'package.json')
  if (!fs.existsSync(electronPkgPath)) {
    throw new Error('electron package.json not found')
  }
  const pkg = JSON.parse(fs.readFileSync(electronPkgPath, 'utf8'))
  const version = pkg.version
  const platform = process.platform
  const arch = process.arch

  console.log(`📥 Downloading Electron v${version} for ${platform}-${arch}...`)
  
  const { downloadArtifact } = require('@electron/get')
  const zipPath = await downloadArtifact({
    version,
    artifactName: 'electron',
    platform,
    arch
  })
  
  console.log(`📦 Extracting Electron zip to dist...`)
  const distDir = path.join(basePath, 'node_modules', 'electron', 'dist')
  fs.mkdirSync(distDir, { recursive: true })

  try {
    // Try extract-zip with a 10s timeout to avoid deadlocking on Node v24+
    await runWithTimeout(async () => {
      const extract = require('extract-zip')
      await extract(zipPath, { dir: distDir })
    }, 10000)
    console.log('✅ Extraction via extract-zip complete!')
  } catch (extractErr) {
    console.log('⚠️ extract-zip timed out or failed. Falling back to native system extraction...')
    if (process.platform === 'win32') {
      execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${distDir}' -Force"`, { stdio: 'inherit' })
    } else {
      execSync(`unzip -o "${zipPath}" -d "${distDir}"`, { stdio: 'inherit' })
    }
    console.log('✅ Extraction via native fallback complete!')
  }

  // Move types if present
  const srcTypeDefPath = path.join(distDir, 'electron.d.ts')
  const targetTypeDefPath = path.join(basePath, 'node_modules', 'electron', 'electron.d.ts')
  if (fs.existsSync(srcTypeDefPath)) {
    try {
      fs.renameSync(srcTypeDefPath, targetTypeDefPath)
    } catch (e) {
      // Ignore
    }
  }

  // Write path.txt reference
  const platformPath = process.platform === 'win32' ? 'electron.exe' : (process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron')
  const pathTxtPath = path.join(basePath, 'node_modules', 'electron', 'path.txt')
  fs.writeFileSync(pathTxtPath, platformPath)

  // Clear require cache for electron module to force reload
  delete require.cache[require.resolve('electron')]
  const electronBinary = require('electron') as unknown as string
  if (!fs.existsSync(electronBinary)) {
    throw new Error('Electron binary still missing after fallback repair')
  }
  return electronBinary
}

export async function launchPlayer(streamInfo: StreamInfo) {
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
      electronBinary = await repairElectron(basePath)
      console.log('✅ Electron repaired successfully!')
    } catch (repairErr: any) {
      throw new Error(`Failed to resolve or install Electron automatically. Please run "npm install electron" or "node node_modules/electron/install.js" manually.\nDetails: ${repairErr.message}`)
    }
  }

  return new Promise<void>((resolve, reject) => {
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

