const { app, BrowserWindow, Tray, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const isDev = !app.isPackaged;
const SERVER_PORT = 3001;

let mainWindow = null;
let splashWindow = null;
let tray = null;
let serverPort = SERVER_PORT;

// ── Single Instance Lock ────────────────────────────────────

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // ── Paths ──────────────────────────────────────────────────

  function getServerDir() {
    if (isDev) return path.join(__dirname, '..', 'server');
    return path.join(process.resourcesPath, 'server');
  }

  function getWritableDir() {
    const portable = process.env.PORTABLE_EXECUTABLE_FILE;
    const exeDir = portable ? path.dirname(portable) : path.dirname(app.getPath('exe'));
    const dir = path.join(exeDir, 'qr-data');
    fs.mkdirSync(dir, { recursive: true });
    try {
      const testFile = path.join(dir, '.write-test');
      fs.writeFileSync(testFile, 'ok');
      fs.unlinkSync(testFile);
      return dir;
    } catch {
      return app.getPath('userData');
    }
  }

  // ── Splash Window ───────────────────────────────────────────
  // Show immediately so user sees something while server loads

  function showSplash() {
    splashWindow = new BrowserWindow({
      width: 420,
      height: 380,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      backgroundColor: '#0f172a',
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    splashWindow.loadURL(`file://${__dirname}/splash.html`);
    // Show window frame immediately (background color shows first)
    splashWindow.show();
    // Wait for HTML to render before sending advance() messages
    return new Promise((resolve) => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        const onReady = () => {
          splashWindow.webContents.removeListener('did-finish-load', onReady);
          // Small delay for CSS animations to start
          setTimeout(resolve, 80);
        };
        splashWindow.webContents.on('did-finish-load', onReady);
      } else {
        resolve();
      }
      // Safety: don't wait forever
      setTimeout(resolve, 1000);
    });
  }

  function splashAdvance(msg) {
    if (splashWindow && !splashWindow.isDestroyed()) {
      const code = msg
        ? `advance(${JSON.stringify(msg)})`
        : 'advance()';
      splashWindow.webContents.executeJavaScript(code).catch(() => {});
    }
  }

  function closeSplash() {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
  }

  // ── System Tray ─────────────────────────────────────────────

  function createTray() {
    const iconPath = path.join(__dirname, 'tray-icon.png');
    if (!fs.existsSync(iconPath)) return;
    tray = new Tray(iconPath);
    tray.setToolTip('QR Code 管理平台 — 運行中');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '顯示主視窗', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
      { type: 'separator' },
      { label: '結束程式', click: () => app.quit() },
    ]));
    tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
  }

  function destroyTray() {
    if (tray) { tray.destroy(); tray = null; }
  }

  // ── App Menu ────────────────────────────────────────────────

  function createAppMenu() {
    const template = [
      {
        label: '檔案',
        submenu: [
          { label: '結束', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
        ],
      },
      {
        label: '檢視',
        submenu: [
          { label: '重新載入', accelerator: 'CmdOrCtrl+R', click: () => mainWindow && mainWindow.reload() },
          { type: 'separator' },
          { label: '開發者工具', accelerator: 'F12', click: () => mainWindow && mainWindow.webContents.toggleDevTools() },
        ],
      },
      {
        label: '說明',
        submenu: [
          { label: '關於', click: showAbout },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  function showAbout() {
    dialog.showMessageBox(mainWindow || undefined, {
      type: 'info',
      title: '關於 QR Code 管理平台',
      message: 'QR Code 管理平台 v1.0.0',
      detail: '一站式 QR Code 產生、管理與掃瞄追蹤平台\n\n技術組成：\nElectron + React + Express + sql.js',
    });
  }

  // ── Embedded Server ─────────────────────────────────────────

  function getServerPaths() {
    const serverDir = getServerDir();
    const serverPath = path.join(serverDir, 'dist', 'server.cjs');
    const sqlWasmPath = path.join(serverDir, 'dist', 'sql.js-dist');
    const writableDir = getWritableDir();
    const clientDist = isDev
      ? path.join(__dirname, '..', 'client', 'dist')
      : path.join(app.getAppPath(), 'client', 'dist');
    return { serverDir, serverPath, sqlWasmPath, writableDir, clientDist };
  }

  async function startEmbeddedServer() {
    const paths = getServerPaths();

    if (!fs.existsSync(paths.serverPath)) {
      throw new Error(`Server bundle not found at ${paths.serverPath}.`);
    }

    // Step 1: Load server module (can take 1-3s — blocking)
    splashAdvance('正在載入伺服器模組...');
    // Yield to event loop so splash renders before blocking require()
    await new Promise(r => setTimeout(r, 80));
    const serverModule = require(paths.serverPath);

    // Step 2: Initialize server (Express + sql.js WASM + DB)
    splashAdvance('正在初始化資料庫...');
    await new Promise(r => setTimeout(r, 50));
    const result = await serverModule.startServer({
      port: SERVER_PORT,
      clientDist: paths.clientDist,
      writableDir: paths.writableDir,
      sqlWasmPath: fs.existsSync(paths.sqlWasmPath) ? paths.sqlWasmPath : undefined,
    });
    serverPort = result.port || SERVER_PORT;
  }

  // ── Main Window ─────────────────────────────────────────────

  function createMainWindow() {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 960,
      minHeight: 600,
      title: 'QR Code 管理平台',
      icon: path.join(__dirname, 'icon.png'),
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    mainWindow.loadURL(`http://localhost:${serverPort}`);
    mainWindow.once('ready-to-show', () => {
      closeSplash();
      mainWindow.show();
    });
    mainWindow.on('closed', () => { mainWindow = null; });
    if (isDev) mainWindow.webContents.openDevTools();
  }

  // ── App Lifecycle ───────────────────────────────────────────

  app.whenReady().then(async () => {
    createAppMenu();
    await showSplash();    // Appears immediately; wait until HTML renders
    createTray();

    try {
      await startEmbeddedServer();

      splashAdvance('正在載入前端介面...');
      createMainWindow();
    } catch (err) {
      console.error('Fatal:', err);
      closeSplash();
      dialog.showErrorBox('啟動失敗', `無法啟動伺服器。\n\n${err.message}`);
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    destroyTray();
  });
}
