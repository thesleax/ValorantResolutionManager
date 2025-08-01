const { app, Tray, Menu, BrowserWindow, ipcMain, shell, Notification, nativeImage, dialog } = require('electron');
const { join } = require('path');
const path = require('path');
const { exec } = require('child_process');

let tray = null;
let backgroundMonitor = null;
let mainWindow = null;

function isRunningAsAdmin() {
  if (process.platform !== 'win32') return true;
  
  try {
    const fs = require('fs');
    fs.accessSync('C:\\Windows\\System32\\drivers\\etc', fs.constants.W_OK);
    return true;
  } catch (err) {
    return false;
  }
}

function restartAsAdmin() {
  const { spawn } = require('child_process');
  const path = require('path');
  
  const exePath = process.execPath;
  
  console.log('[ADMIN] Attempting to restart as administrator...');
  console.log('[ADMIN] Executable path:', exePath);
  
  const psCommand = `Start-Process -FilePath "${exePath}" -Verb RunAs`;
  
  exec(`powershell -Command "${psCommand}"`, (error, stdout, stderr) => {
    if (error) {
      console.error('[ADMIN] Failed to restart as administrator:', error);
      dialog.showErrorBox(
        'Administrator Rights Required',
        'Failed to restart as administrator. Please right-click the application and select "Run as administrator".'
      );
    } else {
      console.log('[ADMIN] Successfully requested administrator restart');
    }
    
    app.quit();
  });
}

app.whenReady().then(async () => {
  if (process.platform === 'win32' && !isRunningAsAdmin()) {
    console.log('[ADMIN] Not running as administrator, requesting elevation...');
    
    const result = dialog.showMessageBoxSync(null, {
      type: 'warning',
      title: 'Administrator Rights Required',
      message: 'Valorant Resolution Manager needs administrator rights to change display settings.',
      detail: 'Click "Restart as Admin" to continue, or "Cancel" to exit.',
      buttons: ['Restart as Admin', 'Cancel'],
      defaultId: 0,
      cancelId: 1
    });
    
    if (result === 0) {
      restartAsAdmin();
      return;
    } else {
      console.log('[ADMIN] User cancelled administrator elevation');
      app.quit();
      return;
    }
  }
  
  console.log('[ADMIN] Running with sufficient privileges');
  
  createMainWindow();
});

app.on('before-quit', () => {
  app.isQuiting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 650,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: join(__dirname, 'icon.ico'),
    title: 'Valorant Resolution Manager Beta v0.1',
    resizable: false,
    autoHideMenuBar: true,
    maximizable: false,
    minimizable: true,
    fullscreenable: false
  });

  global.mainWindow = mainWindow;

  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Valorant Resolution Manager Beta v0.1</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
      <style>
        * {
          box-sizing: border-box;
        }
        
        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
          margin: 0;
          padding: 16px 16px 48px 16px;
          background: #000000;
          color: #ffffff;
          height: 100vh;
          overflow: hidden;
          position: relative;
        }
        
        .container {
          background: #000000;
          padding: 24px 24px 48px 24px;
          border-radius: 12px;
          border: 1px solid #333333;
          box-shadow: none;
          max-width: 100%;
          margin: 0 auto 24px auto;
          position: relative;
        }
        
        h1 {
          text-align: center;
          margin-bottom: 24px;
          font-size: 20px;
          font-weight: 600;
          color: #ffffff;
          text-shadow: none;
          letter-spacing: -0.025em;
          text-transform: none;
        }
        
        .resolution-group {
          margin-bottom: 24px;
          background: #000000;
          padding: 0;
          border-radius: 0;
          border: none;
          transition: none;
          box-shadow: none;
        }
        
        .resolution-group:hover {
          background: #000000;
          border-color: transparent;
          transform: none;
          box-shadow: none;
        }
        
        label {
          display: block;
          margin-bottom: 8px;
          font-size: 14px;
          font-weight: 500;
          color: #a1a1a1;
          text-transform: none;
          letter-spacing: 0;
        }
        
        select {
          width: 100%;
          padding: 12px 16px;
          border: 1px solid #333333;
          border-radius: 6px;
          background: #000000;
          color: #ffffff;
          font-size: 14px;
          font-weight: 400;
          transition: border-color 0.2s ease;
          cursor: pointer;
          appearance: none;
          box-shadow: none;
        }
        
        select:focus {
          outline: none;
          border-color: #666666;
          box-shadow: none;
          background: #000000;
        }
        
        select:hover {
          border-color: #666666;
          background: #000000;
          box-shadow: none;
        }
        
        select option {
          background: #000000;
          color: #ffffff;
          padding: 12px;
          font-size: 14px;
          font-weight: 400;
          border: none;
        }
        
        .buttons {
          margin-top: 32px;
        }
        
        button {
          padding: 10px 16px;
          border: 1px solid #333333;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          min-width: 120px;
          justify-content: center;
          background: #000000;
          color: #ffffff;
          text-transform: none;
          letter-spacing: 0;
          box-shadow: none;
        }
        
        button:hover {
          background: #1a1a1a;
          transform: none;
          border-color: #666666;
          box-shadow: none;
        }
        
        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
        }
        
        button:disabled:hover {
          background: #000000;
          border-color: #333333;
          transform: none;
          box-shadow: none;
        }
        
        .primary-btn {
          background: #ffffff;
          color: #000000;
          border-color: #ffffff;
        }
        
        .primary-btn:hover:not(:disabled) {
          background: #f0f0f0;
          border-color: #f0f0f0;
        }
        
        .danger-btn {
          background: #ff4444;
          color: #ffffff;
          border-color: #ff4444;
        }
        
        .danger-btn:hover:not(:disabled) {
          background: #ff6666;
          border-color: #ff6666;
        }
        
        .status {
          margin-top: 24px;
          text-align: center;
          font-weight: 400;
          padding: 12px 16px;
          border-radius: 6px;
          background: #000000;
          border: 1px solid #333333;
          color: #a1a1a1;
          font-size: 14px;
          box-shadow: none;
          transition: none;
        }
        
        .button-row {
          display: flex;
          gap: 12px;
          justify-content: center;
          margin-bottom: 12px;
          flex-wrap: wrap;
        }
        
        .footer {
          margin-top: 32px;
          text-align: center;
          font-size: 14px;
          color: #a1a1a1;
        }
        
        .footer a {
          color: #ffffff;
          text-decoration: none;
          font-weight: 600;
          transition: color 0.2s ease;
        }
        
        .footer a:hover {
          color: #cccccc;
        }
      </style>
    </head>
    <body>
      
      <div class="container">
        <h1>Valorant Resolution Manager Beta v0.1</h1>
        
        <div class="resolution-group">
          <label for="gameRes">In-Game Resolution:</label>
          <select id="gameRes" onchange="onResolutionChange()">
            <option value="1080x1080">1080x1080</option>
            <option value="1440x1080" selected>1440x1080 (Recommended)</option>
          </select>
        </div>
        
        <div class="resolution-group">
          <label for="normalRes">Desktop Resolution:</label>
          <select id="normalRes" onchange="onResolutionChange()">
            <option value="1920x1080" selected>1920x1080 (Full HD)</option>
            <option value="2560x1440">2560x1440 (QHD)</option>
            <option value="3840x2160">3840x2160 (4K)</option>
          </select>
        </div>
        
        <div class="buttons">
          <div class="button-row">
            <button id="startBtn" class="primary-btn" onclick="startMonitoring()">
              Start Auto Monitoring
            </button>
            <button id="stopBtn" class="danger-btn" onclick="stopMonitoring()" disabled>
              Stop Monitoring
            </button>
          </div>
          
          <div class="button-row">
            <button onclick="setGameResolution()">
              Apply Game Resolution
            </button>
            <button onclick="setNormalResolution()">
              Apply Desktop Resolution
            </button>
          </div>
        </div>
        
        <div class="status" id="status">Ready - Select your resolutions and start monitoring</div>
        
        <div class="footer">
          by <a href="#" onclick="openWebsite('https://sleax.live')">sl34x</a>
        </div>
      </div>

      <script>
        const { ipcRenderer } = require('electron');
        let isMonitoring = false;
        
        function updateButtonStates() {
          const startBtn = document.getElementById('startBtn');
          const stopBtn = document.getElementById('stopBtn');
          
          if (isMonitoring) {
            startBtn.disabled = true;
            stopBtn.disabled = false;
          } else {
            startBtn.disabled = false;
            stopBtn.disabled = true;
          }
        }
        
        function startMonitoring() {
          const gameRes = document.getElementById('gameRes').value;
          const normalRes = document.getElementById('normalRes').value;
          
          console.log('[FRONTEND] Start monitoring button clicked');
          document.getElementById('status').textContent = 'Starting monitoring system...';
          isMonitoring = true;
          updateButtonStates();
          
          ipcRenderer.send('start-monitoring', { gameRes, normalRes });
        }
        
        function stopMonitoring() {
          if (!isMonitoring) return;
          
          document.getElementById('status').textContent = 'Stopping monitoring system...';
          isMonitoring = false;
          updateButtonStates();
          
          ipcRenderer.send('stop-monitoring');
        }
        
        function setGameResolution() {
          const gameRes = document.getElementById('gameRes').value;
          document.getElementById('status').textContent = 'Applying game resolution: ' + gameRes;
          ipcRenderer.send('set-game-resolution', gameRes);
        }
        
        function setNormalResolution() {
          const normalRes = document.getElementById('normalRes').value;
          document.getElementById('status').textContent = 'Applying desktop resolution: ' + normalRes;
          ipcRenderer.send('set-normal-resolution', normalRes);
        }
        
        function openWebsite(url) {
          ipcRenderer.send('open-website', url);
        }
        
        ipcRenderer.on('monitoring-status', (event, status) => {
          console.log('[IPC] Received monitoring-status:', status);
          document.getElementById('status').textContent = status;
          
          if (status.includes('started') || status.includes('Monitoring started')) {
            isMonitoring = true;
          } else if (status.includes('stopped') || status.includes('Monitoring stopped')) {
            isMonitoring = false;
          }
          updateButtonStates();
        });
        
        function onResolutionChange() {
          if (isMonitoring) {
            console.log('[FRONTEND] Resolution changed while monitoring is active, updating...');
            const gameRes = document.getElementById('gameRes').value;
            const normalRes = document.getElementById('normalRes').value;
            
            ipcRenderer.send('update-resolutions', { gameRes, normalRes });
          }
        }
        
        document.addEventListener('DOMContentLoaded', function() {
          console.log('[FRONTEND] Page loaded, setting up button states');
          updateButtonStates();
          console.log('[FRONTEND] IPC monitoring-status listener set up');
        });
      </script>
    </body>
    </html>
  `)}`);

  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
      
      if (!tray) {
        createSystemTray();
      }
      return false;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('hide', () => {
    if (!tray) {
      createSystemTray();
    }
  });

  mainWindow.on('minimize', () => {
    console.log('[WINDOW] Window minimized to taskbar');
  });
}

function showNotification(title, body) {
  console.log('[NOTIFICATION] showNotification called:', { title, body });
  if (Notification.isSupported()) {
    console.log('[NOTIFICATION] Notifications supported, creating notification');
    new Notification({
      title: title,
      body: body,
      silent: false
    }).show();
    console.log('[NOTIFICATION] Notification shown');
  } else {
    console.log('[NOTIFICATION] Notifications NOT supported on this system');
  }
}

function createSystemTray() {
  const { nativeImage } = require('electron');
  
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(join(__dirname, 'icon.ico')).resize({ width: 16, height: 16 });
  } catch (err) {
    trayIcon = nativeImage.createEmpty();
  }
  
  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Valorant Resolution Manager',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createMainWindow();
        }
      },
    },
    {
      type: 'separator'
    },
    {
      label: 'Exit Application',
      click: () => {
        app.isQuiting = true;
        if (backgroundMonitor) {
          backgroundMonitor.stop();
        }
        app.quit();
      },
    },
  ]);

  tray.setToolTip('Valorant Resolution Manager - Running in background');
  tray.setContextMenu(contextMenu);
  
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createMainWindow();
    }
  });
}

const { promisify } = require('util');
const execAsync = promisify(require('child_process').exec);

let inMatch = false;
let gameStartTime = null;
let gameEndTime = null;
let resolutionChanged = false;
let monitoringInterval = null;
let currentGameRes = { width: 1440, height: 1080 };
let currentNormalRes = { width: 1920, height: 1080 };

let baselineCPU = null;
let baselineCalculated = false;
let cpuReadings = [];
let isLearningBaseline = true;

let stableReadings = [];
let lastStableState = null;
let stateChangeTime = null;
const STABILITY_CHECKS = 3;
const MIN_STATE_DURATION = 10000;
const GAME_START_DELAY = 5000;
const GAME_END_DELAY = 5000;
const BASELINE_READINGS = 5;
let CPU_THRESHOLD_PERCENT = 30;

async function getProcessList() {
  try {
    console.log('[PROCESS] Using Windows tasklist command...');
    const { stdout } = await execAsync('tasklist /fo csv');
    
    const lines = stdout.split('\n').slice(1);
    const processes = lines
      .filter(line => line.trim())
      .map(line => {
        const cols = line.split(',');
        if (cols.length >= 2) {
          return {
            name: cols[0].replace(/"/g, ''),
            pid: parseInt(cols[1].replace(/"/g, '')) || 0
          };
        }
        return null;
      })
      .filter(p => p !== null);
    
    console.log('[PROCESS] Windows tasklist successful, found', processes.length, 'processes');
    return processes;
  } catch (error) {
    console.error('[PROCESS] Windows tasklist failed:', error.message);
    return [];
  }
}

async function setResolutionInternal(width, height) {
  try {
    console.log(`[RESOLUTION] Starting resolution change to ${width}x${height}`);
    
    let nircmdPath;
    if (process.resourcesPath) {
      nircmdPath = path.join(process.resourcesPath, 'nircmd.exe');
    } else {
      nircmdPath = path.join(__dirname, 'nircmd.exe');
    }
    
    console.log(`[RESOLUTION] Using nircmd path: ${nircmdPath}`);
    
    const command = `"${nircmdPath}" setdisplay ${width} ${height} 32`;
    console.log(`[RESOLUTION] Executing command: ${command}`);
    
    await execAsync(command);
    console.log(`[RESOLUTION] Resolution changed successfully to ${width}x${height}`);
    
    if (mainWindow) {
      mainWindow.webContents.send('monitoring-status', `Resolution changed to ${width}x${height}`);
    }
  } catch (err) {
    console.error('[RESOLUTION] Error changing resolution:', err);
    if (mainWindow) {
      mainWindow.webContents.send('monitoring-status', `Resolution change error: ${err.message}`);
    }
  }
}

async function checkMatchInternal() {
  try {
    console.log('[MONITORING] checkMatch called at:', new Date().toLocaleTimeString());
    const processes = await getProcessList();
    
    if (processes.length === 0) {
      console.log('[MONITORING] No processes found - process list retrieval failed');
      return;
    }
    
    const valorantProcesses = processes.filter(p => 
      p.name.toLowerCase().includes('valorant')
    );
    
    const isValorantRunning = valorantProcesses.length > 0;
    const isInMatch = processes.some(p => p.name === 'Valorant-Win64-Shipping.exe');
    
    console.log('[MONITORING] Valorant running:', isValorantRunning, 'In match:', isInMatch, 'Current inMatch:', inMatch);
    
    if (valorantProcesses.length > 0) {
      console.log('[MONITORING] Found Valorant processes:', valorantProcesses.map(p => p.name));
    }
    
    if (isValorantRunning && !isInMatch && isLearningBaseline) {
      console.log('[MONITORING] Learning baseline - Valorant in menu');
      if (mainWindow) {
        mainWindow.webContents.send('monitoring-status', 'Learning baseline - Wait in Valorant menu...');
      }
      return;
    }
    
    if (isInMatch && !inMatch) {
      console.log('[MONITORING] Match started! Changing to game resolution...');
      await setResolutionInternal(currentGameRes.width, currentGameRes.height);
      inMatch = true;
      resolutionChanged = true;
      gameStartTime = Date.now();
      
      if (mainWindow) {
        mainWindow.webContents.send('monitoring-status', `Match started! Resolution: ${currentGameRes.width}x${currentGameRes.height}`);
      }
    }
    
    if (!isInMatch && inMatch) {
      console.log('[MONITORING] Match ended! Restoring normal resolution...');
      await setResolutionInternal(currentNormalRes.width, currentNormalRes.height);
      inMatch = false;
      resolutionChanged = false;
      gameEndTime = Date.now();
      
      if (mainWindow) {
        mainWindow.webContents.send('monitoring-status', `Match ended! Resolution: ${currentNormalRes.width}x${currentNormalRes.height}`);
      }
    }
    
    if (!isValorantRunning && resolutionChanged) {
      console.log('[MONITORING] Valorant completely closed! Immediately restoring resolution...');
      await setResolutionInternal(currentNormalRes.width, currentNormalRes.height);
      resolutionChanged = false;
      inMatch = false;
      gameStartTime = null;
      gameEndTime = null;
      
      if (mainWindow) {
        mainWindow.webContents.send('monitoring-status', 'Valorant closed - Resolution restored');
      }
    }
    
  } catch (error) {
    console.error('[MONITORING] Process check error:', error);
  }
}

function startMonitoringWithResolutions(gameRes, normalRes) {
  currentGameRes = gameRes;
  currentNormalRes = normalRes;
  
  baselineCPU = null;
  baselineCalculated = false;
  cpuReadings = [];
  isLearningBaseline = true;
  inMatch = false;
  gameStartTime = null;
  gameEndTime = null;
  resolutionChanged = false;
  stableReadings = [];
  lastStableState = null;
  stateChangeTime = null;
  
  console.log(`[MONITORING] Starting monitoring with Game: ${gameRes.width}x${gameRes.height}, Desktop: ${normalRes.width}x${normalRes.height}`);
  
  if (mainWindow) {
    mainWindow.webContents.send('monitoring-status', `Monitoring started! Game: ${gameRes.width}x${gameRes.height}, Desktop: ${normalRes.width}x${normalRes.height}`);
  }
  
  monitoringInterval = setInterval(checkMatchInternal, 3000);
  
  return () => {
    if (monitoringInterval) {
      clearInterval(monitoringInterval);
      monitoringInterval = null;
      console.log('[MONITORING] Monitoring stopped.');
      
      if (mainWindow) {
        mainWindow.webContents.send('monitoring-status', 'Monitoring stopped');
      }
    }
  };
}

ipcMain.on('start-monitoring', async (event, { gameRes, normalRes }) => {
  console.log('IPC: start-monitoring received', { gameRes, normalRes });
  try {
    if (backgroundMonitor) {
      backgroundMonitor.stop();
    }
    
    const [gameWidth, gameHeight] = gameRes.split('x').map(Number);
    const [normalWidth, normalHeight] = normalRes.split('x').map(Number);
    
    console.log('Parsed resolutions:', { gameWidth, gameHeight, normalWidth, normalHeight });
    
    console.log('Starting external monitoring...');
    const { startMonitoringWithResolutions } = require('./monitoring.js');
    
    const stopFunction = startMonitoringWithResolutions(
      { width: gameWidth, height: gameHeight },
      { width: normalWidth, height: normalHeight }
    );
    
    backgroundMonitor = { 
      stop: stopFunction,
      isActive: true
    };
    
    console.log('IPC: Monitoring started successfully');
    
    createSystemTray();
    
    showNotification(
      'Valorant Resolution Manager',
      'Monitoring started - Waiting for Valorant match...'
    );
    
  } catch (error) {
    console.error('Error starting monitoring:', error);
    if (mainWindow) {
      mainWindow.webContents.send('monitoring-status', 'Error starting monitoring: ' + error.message);
    }
  }
});

ipcMain.on('show-notification', (event, { title, body }) => {
  console.log('[MAIN] Received notification request:', { title, body });
  showNotification(title, body);
});

ipcMain.on('hide-window', () => {
  console.log('[MAIN] Hiding main window (match started)');
  if (mainWindow) {
    mainWindow.hide();
  }
});

ipcMain.on('show-window', () => {
  console.log('[MAIN] Showing main window (match ended)');
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

ipcMain.on('update-resolutions', async (event, { gameRes, normalRes }) => {
  console.log('IPC: update-resolutions received', { gameRes, normalRes });
  try {
    if (backgroundMonitor && backgroundMonitor.isActive) {
      const [gameWidth, gameHeight] = gameRes.split('x').map(Number);
      const [normalWidth, normalHeight] = normalRes.split('x').map(Number);
      
      console.log('Updating resolutions while monitoring is active:', { gameWidth, gameHeight, normalWidth, normalHeight });
      
      const { updateResolutions } = await import('./monitoring.js');
      updateResolutions(
        { width: gameWidth, height: gameHeight },
        { width: normalWidth, height: normalHeight }
      );
      
      if (mainWindow) {
        mainWindow.webContents.send('monitoring-status', `Resolution settings updated: Game ${gameRes}, Desktop ${normalRes}`);
      }
    } else {
      console.log('Monitoring not active, ignoring resolution update');
      if (mainWindow) {
        mainWindow.webContents.send('monitoring-status', 'Monitoring not active - start monitoring first');
      }
    }
  } catch (error) {
    console.error('Resolution update error:', error);
    if (mainWindow) {
      mainWindow.webContents.send('monitoring-status', `Resolution update error: ${error.message}`);
    }
  }
});

ipcMain.on('stop-monitoring', (event) => {
  try {
    if (backgroundMonitor) {
      backgroundMonitor.stop();
      backgroundMonitor = null;
    }
    if (mainWindow) {
      mainWindow.webContents.send('monitoring-status', 'Monitoring stopped');
    }
  } catch (error) {
    console.error('Monitoring stop error:', error);
    if (mainWindow) {
      mainWindow.webContents.send('monitoring-status', 'Error: Could not stop monitoring');
    }
  }
});

ipcMain.on('set-game-resolution', async (event, gameRes) => {
  try {
    const [width, height] = gameRes.split('x').map(Number);
    const { setResolution } = await import('./monitoring.js');
    await setResolution(width, height);
    if (mainWindow) {
      mainWindow.webContents.send('monitoring-status', `Game resolution applied: ${gameRes}`);
    }
  } catch (error) {
    console.error('Game resolution error:', error);
    if (mainWindow) {
      mainWindow.webContents.send('monitoring-status', 'Could not apply game resolution');
    }
  }
});

ipcMain.on('set-normal-resolution', async (event, normalRes) => {
  try {
    const [width, height] = normalRes.split('x').map(Number);
    const { setResolution } = await import('./monitoring.js');
    await setResolution(width, height);
    if (mainWindow) {
      mainWindow.webContents.send('monitoring-status', `Desktop resolution applied: ${normalRes}`);
    }
  } catch (error) {
    console.error('Desktop resolution error:', error);
    if (mainWindow) {
      mainWindow.webContents.send('monitoring-status', 'Could not apply desktop resolution');
    }
  }
});

ipcMain.on('open-website', (event, url) => {
  shell.openExternal(url);
});
