const { app, BrowserWindow, session } = require('electron')
const path = require('path')

let mainWindow = null

function createWindow() {
  const streamData = process.env.NEKOSTREAM_CLI_STREAM
  if (!streamData) {
    console.error('No stream data provided.')
    app.quit()
    return
  }

  const streamInfo = JSON.parse(Buffer.from(streamData, 'base64').toString('utf-8'))

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false, // Required for some streams (CORS bypass)
      webviewTag: true,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })

  // Set up interceptors if needed
  if (streamInfo.headers && streamInfo.type !== 'iframe') {
    const filter = { urls: ['*://*/*'] }
    session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
      const headers = { ...details.requestHeaders }
      // Only apply headers for direct video streams (HLS/MP4).
      // Applying them globally for iframes breaks the internal APIs of video hosts.
      if (streamInfo.headers.Referer) headers['Referer'] = streamInfo.headers.Referer
      if (streamInfo.headers.Origin) headers['Origin'] = streamInfo.headers.Origin
      callback({ requestHeaders: headers })
    })
  }

  // Pass streamInfo to the renderer process via a global variable injected into the page
  mainWindow.loadFile(path.join(__dirname, 'player.html'))

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.executeJavaScript(`
      window.initPlayer(${JSON.stringify(streamInfo)});
    `)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
