import { spawn, execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'
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

function electronExecutablePath(rootDir: string): string {
  if (process.platform === 'win32') return path.join(rootDir, 'electron.exe')
  if (process.platform === 'darwin') return path.join(rootDir, 'Electron.app', 'Contents', 'MacOS', 'Electron')
  return path.join(rootDir, 'electron')
}

function resolveElectronPackageDir(basePath: string): string {
  try {
    return path.dirname(require.resolve('electron/package.json', { paths: [basePath, __dirname] }))
  } catch {
    return path.join(basePath, 'node_modules', 'electron')
  }
}

function resolveInstalledElectron(basePath: string): string {
  const electronBinary = require('electron') as unknown as string
  if (typeof electronBinary === 'string' && fs.existsSync(electronBinary)) {
    return electronBinary
  }

  const electronPkgDir = resolveElectronPackageDir(basePath)
  const directBinary = electronExecutablePath(path.join(electronPkgDir, 'dist'))
  if (fs.existsSync(directBinary)) {
    return directBinary
  }

  throw new Error('Electron binary executable file not found')
}

function getElectronVersion(basePath: string): string {
  const electronPkgPath = path.join(resolveElectronPackageDir(basePath), 'package.json')
  if (!fs.existsSync(electronPkgPath)) {
    throw new Error('electron package.json not found')
  }

  const pkg = JSON.parse(fs.readFileSync(electronPkgPath, 'utf8'))
  return pkg.version
}

async function resolveCachedElectron(basePath: string): Promise<string> {
  const version = getElectronVersion(basePath)
  const platform = process.platform
  const arch = process.arch
  const cacheDir = path.join(os.homedir(), '.nekostream-cli', 'electron', version, `${platform}-${arch}`)
  const cachedBinary = electronExecutablePath(cacheDir)

  if (fs.existsSync(cachedBinary)) {
    return cachedBinary
  }

  console.log(`[download] Downloading Electron v${version} for ${platform}-${arch}...`)
  
  const { downloadArtifact } = require('@electron/get')
  const zipPath = await downloadArtifact({
    version,
    artifactName: 'electron',
    platform,
    arch
  })
  
  console.log('[extract] Extracting Electron zip to local cache...')
  fs.mkdirSync(path.dirname(cacheDir), { recursive: true })
  const tempDir = `${cacheDir}.tmp-${process.pid}`
  fs.rmSync(tempDir, { recursive: true, force: true })
  fs.mkdirSync(tempDir, { recursive: true })

  try {
    // Try extract-zip with a 10s timeout to avoid deadlocking on Node v24+
    await runWithTimeout(async () => {
      const extract = require('extract-zip')
      await extract(zipPath, { dir: tempDir })
    }, 10000)
    console.log('[ok] Extraction via extract-zip complete.')
  } catch (extractErr) {
    console.log('[warn] extract-zip timed out or failed. Falling back to native system extraction...')
    if (process.platform === 'win32') {
      execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tempDir}' -Force"`, { stdio: 'inherit' })
    } else {
      execSync(`unzip -o "${zipPath}" -d "${tempDir}"`, { stdio: 'inherit' })
    }
    console.log('[ok] Extraction via native fallback complete.')
  }

  if (!fs.existsSync(electronExecutablePath(tempDir))) {
    fs.rmSync(tempDir, { recursive: true, force: true })
    throw new Error('Electron binary missing after cache extraction')
  }

  fs.rmSync(cacheDir, { recursive: true, force: true })
  fs.renameSync(tempDir, cacheDir)

  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(cachedBinary, 0o755)
    } catch {
      // Ignore chmod failures on filesystems that do not support it.
    }
  }

  return cachedBinary
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
    electronBinary = resolveInstalledElectron(basePath)
  } catch (e) {
    console.log('[warn] Electron binary is missing. Resolving cached player runtime...')
    try {
      electronBinary = await resolveCachedElectron(basePath)
      console.log('[ok] Electron runtime ready.')
    } catch (repairErr: any) {
      throw new Error(`Failed to resolve Electron runtime automatically. Please run "npm install electron" or reinstall NekoStream.\nDetails: ${repairErr.message}`)
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

