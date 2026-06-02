/**
 * Electron 主进程
 * - 启动 Python 后端作为子进程
 * - 等待后端就绪后打开窗口
 * - 支持开发模式（Vite）和生产模式（静态文件）
 */
const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

// 开发模式：使用 Vite 开发服务器
const DEV_MODE = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
const BACKEND_PORT = 8001;
const VITE_PORT = 5173;

let mainWindow = null;
let backendProcess = null;

function getBackendUrl() {
  return `http://localhost:${BACKEND_PORT}`;
}

function getFrontendUrl() {
  if (DEV_MODE) {
    return `http://localhost:${VITE_PORT}`;
  }
  return getBackendUrl();
}

/**
 * 启动 Python 后端
 */
function startBackend() {
  if (app.isPackaged) {
    // 生产模式：启动 PyInstaller 编译好的 backend.exe
    const backendExe = path.join(process.resourcesPath, 'backend', 'backend.exe');
    console.log(`启动后端 exe: ${backendExe}`);

    const proc = spawn(backendExe, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    proc.stdout.on('data', (data) => {
      console.log(`[后端] ${data.toString().trim()}`);
    });

    proc.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      console.log(`[后端] ${msg}`);
      if (msg.includes('Uvicorn running') || msg.includes('Application startup complete') || msg.includes('启动') || msg.includes('8001')) {
        onBackendReady();
      }
    });

    proc.on('error', (err) => {
      console.error(`后端 exe 启动失败: ${err.message}`);
    });

    proc.on('close', (code) => {
      console.log(`后端进程退出 (code: ${code})`);
      backendProcess = null;
    });

    backendProcess = proc;

    // 超时后备
    setTimeout(() => {
      if (mainWindow && !mainWindow.webContents.isLoading()) {
        // 窗口已加载，无需操作
      }
    }, 10000);
    return;
  }

  // 开发模式：使用 python 命令启动
  const backendDir = path.join(__dirname, '..', 'backend');

  // 尝试多个 Python 命令
  const pythonCmds = ['python3', 'python3.12', 'python3.11', 'python', 'py -3'];

  function tryStart(index) {
    if (index >= pythonCmds.length) {
      console.error('无法找到 Python，请确保已安装 Python 3');
      return;
    }

    const cmd = pythonCmds[index];
    console.log(`尝试启动 Python: ${cmd}`);

    const proc = spawn(cmd, ['-m', 'uvicorn', 'main:app', '--host', '0.0.0.0', '--port', String(BACKEND_PORT)], {
      cwd: backendDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(BACKEND_PORT) },
    });

    proc.stdout.on('data', (data) => {
      console.log(`[后端] ${data.toString().trim()}`);
    });

    proc.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      console.log(`[后端] ${msg}`);
      // uvicorn 输出在 stderr
      if (msg.includes('Uvicorn running')) {
        onBackendReady();
      }
    });

    proc.on('error', () => {
      console.log(`命令不可用: ${cmd}`);
      tryStart(index + 1);
    });

    proc.on('close', (code) => {
      console.log(`后端进程退出 (code: ${code})`);
      backendProcess = null;
    });

    backendProcess = proc;
  }

  tryStart(0);

  // 超时后备：如果 10 秒后还没就绪，仍尝试打开窗口
  setTimeout(() => {
    if (mainWindow && !mainWindow.webContents.isLoading()) {
      // 窗口已加载，无需操作
    }
  }, 10000);
}

/**
 * 后端就绪回调
 */
function onBackendReady() {
  console.log('后端已就绪');
  if (mainWindow) {
    mainWindow.loadURL(getFrontendUrl());
  }
}

/**
 * 轮询等待后端就绪
 */
function waitForBackend(retries = 30) {
  return new Promise((resolve) => {
    function check() {
      http.get(`${getBackendUrl()}/api/pdf/list`, (res) => {
        resolve(true);
      }).on('error', () => {
        if (retries > 0) {
          setTimeout(() => {
            retries--;
            check();
          }, 1000);
        } else {
          console.warn('后端启动超时，仍尝试打开窗口');
          resolve(false);
        }
      });
    }
    check();
  });
}

/**
 * 创建主窗口
 */
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'PDF 翻译阅读器',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false,
  });

  // 窗口准备好后再显示（避免白屏闪烁）
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 开发模式下打开 DevTools
  if (DEV_MODE) {
    mainWindow.webContents.openDevTools();
  }

  // 先加载一个中间页面
  mainWindow.loadURL(`data:text/html,
    <html>
    <body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#f5f5f5">
      <div style="text-align:center">
        <h2 style="color:#333">PDF 翻译阅读器</h2>
        <p style="color:#666">正在启动后端服务...</p>
      </div>
    </body>
    </html>
  `);

  // 等待后端就绪后加载真实页面
  const ready = await waitForBackend();
  if (ready) {
    mainWindow.loadURL(getFrontendUrl());
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 应用生命周期
app.whenReady().then(() => {
  createWindow();
  startBackend();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // 关闭后端进程
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
});