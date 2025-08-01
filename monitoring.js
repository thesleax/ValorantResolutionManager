const { exec } = require('child_process');
const { promisify } = require('util');
const { join } = require('path');
const os = require('os');

const execAsync = promisify(exec);

const DEFAULT_RES_GAME = { width: 1440, height: 1080 };
const DEFAULT_RES_NORMAL = { width: 1920, height: 1080 };

let inMatch = false;
let gameStartTime = null;
let gameEndTime = null;
let resolutionChanged = false;
let monitoringInterval = null;
let currentGameRes = DEFAULT_RES_GAME;
let currentNormalRes = DEFAULT_RES_NORMAL;

function sendNotification(title, body) {
  console.log('[NOTIFICATION] Sending notification:', { title, body });
  
  try {
    if (global.mainWindow && global.mainWindow.webContents) {
      global.mainWindow.webContents.send('show-notification', { title, body });
      console.log('[NOTIFICATION] IPC notification sent successfully');
    }
    
    const { Notification } = require('electron');
    
    if (Notification.isSupported()) {
      console.log('[NOTIFICATION] Using Electron Notification API as backup');
      const notification = new Notification({
        title: title,
        body: body,
        silent: false
      });
      
      notification.show();
      console.log('[NOTIFICATION] Electron notification shown successfully');
      
      notification.on('click', () => {
        console.log('[NOTIFICATION] Notification clicked');
        if (global.mainWindow) {
          global.mainWindow.show();
          global.mainWindow.focus();
        }
      });
    } else {
      console.log('[NOTIFICATION] Electron notifications not supported');
    }
  } catch (err) {
    console.error('[NOTIFICATION] Error sending notification:', err);
  }
}

function hideMainWindow() {
  console.log('[WINDOW] Hiding main window');
  if (global.mainWindow && global.mainWindow.webContents) {
    try {
      const { ipcMain } = require('electron');
      global.mainWindow.hide();
      console.log('[WINDOW] Main window hidden successfully');
    } catch (err) {
      console.error('[WINDOW] Error hiding window:', err);
    }
  } else {
    console.log('[WINDOW] MainWindow or webContents not available');
  }
}

function showMainWindow() {
  console.log('[WINDOW] Showing main window');
  if (global.mainWindow && global.mainWindow.webContents) {
    try {
      global.mainWindow.show();
      global.mainWindow.focus();
      console.log('[WINDOW] Main window shown successfully');
    } catch (err) {
      console.error('[WINDOW] Error showing window:', err);
    }
  } else {
    console.log('[WINDOW] MainWindow or webContents not available');
  }
}

let baselineCPU = null;
let baselineCalculated = false;
let cpuReadings = [];
let isLearningBaseline = true;

let stableReadings = [];
let lastStableState = null;
let stateChangeTime = null;
const STABILITY_CHECKS = 3;
const MIN_STATE_DURATION = 15000;

const GAME_START_DELAY = 5000;
const GAME_END_DELAY = 5000;
const BASELINE_READINGS = 3;
let CPU_THRESHOLD_PERCENT = 35;

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

async function setResolution(width, height) {
  try {
    console.log(`[RESOLUTION] Starting resolution change to ${width}x${height}`);
    console.log(`[DEBUG] Current system time: ${new Date().toLocaleTimeString()}`);
    
    let nircmdPath;
    
    if (process.resourcesPath) {
      nircmdPath = join(process.resourcesPath, 'nircmd.exe');
      console.log(`[RESOLUTION] Build mode detected, trying: ${nircmdPath}`);
    } else {
      nircmdPath = join(__dirname, 'nircmd.exe');
      console.log(`[RESOLUTION] Development mode detected, trying: ${nircmdPath}`);
    }
    
    try {
      await execAsync(`dir "${nircmdPath}"`);
      console.log(`Found nircmd at: ${nircmdPath}`);
    } catch (err) {
      console.log(`nircmd not found at: ${nircmdPath}, trying alternative paths...`);
      
      const alternativePaths = [
        join(__dirname, 'nircmd.exe'),
        join(process.cwd(), 'nircmd.exe'),
        join(process.cwd(), 'resources', 'nircmd.exe'),
        'nircmd.exe'
      ];
      
      for (const altPath of alternativePaths) {
        try {
          await execAsync(`dir "${altPath}"`);
          nircmdPath = altPath;
          console.log(`Found nircmd at alternative path: ${altPath}`);
          break;
        } catch (altErr) {
          console.log(`Not found at: ${altPath}`);
        }
      }
    }
    
    console.log(`Changing resolution: ${width}x${height} using ${nircmdPath}`);
    
    if (global.mainWindow) {
      global.mainWindow.webContents.send('monitoring-status', `Changing resolution: ${width}x${height}...`);
    }
    
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`[RESOLUTION] Attempt ${attempt}: Executing command: "${nircmdPath}" setdisplay ${width} ${height} 32`);
        await execAsync(`"${nircmdPath}" setdisplay ${width} ${height} 32`);
        console.log(`Resolution successfully set to ${width}x${height} (Attempt: ${attempt})`);
        console.log(`[DEBUG] Resolution change completed at: ${new Date().toLocaleTimeString()}`);
        
        if (global.mainWindow) {
          global.mainWindow.webContents.send('monitoring-status', `RESOLUTION CHANGED: ${width}x${height} SUCCESSFUL!`);
        }
        break;
      } catch (err) {
        console.log(`[RESOLUTION] Attempt ${attempt} failed:`, err.message);
        if (attempt === 3) {
          throw err;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
  } catch (err) {
    console.error('[RESOLUTION] Resolution change error:', err);
    console.error('[RESOLUTION] Error details:', err.message);
    console.error('[RESOLUTION] Error stack:', err.stack);
    
    if (global.mainWindow) {
      global.mainWindow.webContents.send('monitoring-status', `Resolution change error: ${err.message}`);
    }
  }
}

async function checkMatch() {
  try {
    console.log('[MONITORING] checkMatch called at:', new Date().toLocaleTimeString());
    const processes = await getProcessList();
    
    if (processes.length === 0) {
      console.log('[MONITORING] No processes found - process list retrieval failed');
      return;
    }
    
    const valorantMainProcess = processes.find(p => 
      p.name.toLowerCase() === 'valorant.exe' ||
      p.name === 'VALORANT.exe'
    );
    
    const gameProcess = processes.find(p => 
      p.name.toLowerCase() === 'valorant-win64-shipping.exe' ||
      p.name === 'VALORANT-Win64-Shipping.exe' ||
      p.name === 'Valorant-Win64-Shipping.exe' ||
      p.name.toLowerCase().includes('valorant-win64-shipping')
    );
    
    const valorantProcesses = processes.filter(p => 
      p.name.toLowerCase().includes('valorant') || 
      p.name.toLowerCase().includes('riot')
    );
    
    if (valorantProcesses.length > 0) {
      console.log('[DEBUG] Found Valorant-related processes:', valorantProcesses.map(p => `${p.name} (PID: ${p.pid})`));
    } else {
      console.log('[DEBUG] No Valorant-related processes found');
    }
    
    const isGameRunning = !!gameProcess;
    const isValorantRunning = !!valorantMainProcess || valorantProcesses.length > 0;
    
    console.log('[DEBUG] Process status:', {
      isGameRunning,
      isValorantRunning,
      gameProcessName: gameProcess?.name || 'Not Found',
      mainProcessName: valorantMainProcess?.name || 'Not Found',
      totalValorantProcesses: valorantProcesses.length
    });
    
    if (!isValorantRunning) {
      console.log('[MONITORING] No Valorant processes found - Start Valorant first');
      
      if (global.mainWindow) {
        console.log('[STATUS] Sending to UI: Valorant not running - Start Valorant');
        global.mainWindow.webContents.send('monitoring-status', 'Valorant not running - Start Valorant and wait in menu');
      } else {
        console.log('[STATUS] mainWindow is null/undefined - cannot send status');
      }
      return;
    }
    
    if (!isGameRunning) {
      console.log('[MONITORING] Valorant main process found but game process not detected');
      console.log('[DEBUG] This is normal in menu - we can learn baseline from main process');
      console.log('[DEBUG] Available Valorant processes:', valorantProcesses.map(p => p.name));
    }
    
    if (isValorantRunning && global.lastUIMessage === 'wait-in-menu') {
      global.lastUIMessage = null;
    }
    
    console.log('[MONITORING] Valorant process found, proceeding with baseline learning...');

    let currentCPUPercent = 5;
    let cpuDetectionMethod = 'default';
    
    const processToMonitor = gameProcess || valorantMainProcess;
    const processName = processToMonitor ? processToMonitor.name : 'VALORANT.exe';
    
    console.log(`[CPU] Using process for baseline: ${processName} (PID: ${processToMonitor ? processToMonitor.pid : 'N/A'})`);
    
    try {
      const processPattern = processName.includes('VALORANT-Win64-Shipping') ? 'VALORANT-Win64-Shipping' : 'VALORANT';
      const { stdout } = await execAsync(`powershell "Get-Process -Name '${processPattern}' -ErrorAction SilentlyContinue | ForEach-Object { [math]::Round($_.CPU,2) }"`);
      
      if (stdout && stdout.trim()) {
        const cpuTime = parseFloat(stdout.trim());
        
        if (!isNaN(cpuTime) && cpuTime >= 0) {
          const currentTime = Date.now();
          
          if (!global.lastCpuTime || !global.lastCheckTime) {
            if (processPattern === 'VALORANT') {
              currentCPUPercent = 3;
              cpuDetectionMethod = 'main-process-cpu-first';
            } else {
              currentCPUPercent = 8;
              cpuDetectionMethod = 'game-process-cpu-first';
            }
          } else {
            const timeDiff = (currentTime - global.lastCheckTime) / 1000;
            const cpuDiff = cpuTime - global.lastCpuTime;
            
            if (timeDiff > 0 && cpuDiff >= 0) {
              const cpuCores = os.cpus().length;
              currentCPUPercent = Math.max(0, (cpuDiff / timeDiff) * 100 / cpuCores);
              
              if (processPattern === 'VALORANT') {
                cpuDetectionMethod = 'main-process-cpu';
              } else {
                cpuDetectionMethod = 'game-process-cpu';
              }
              
              if (currentCPUPercent > 100) currentCPUPercent = 100;
            } else {
              currentCPUPercent = global.lastCPUPercent || (processPattern === 'VALORANT' ? 3 : 8);
              cpuDetectionMethod = processPattern === 'VALORANT' ? 'main-process-fallback' : 'game-process-fallback';
            }
          }
          
          global.lastCpuTime = cpuTime;
          global.lastCheckTime = currentTime;
          global.lastCPUPercent = currentCPUPercent;
          
          console.log(`[CPU] Real CPU detection: ${cpuTime.toFixed(2)}s total -> ${currentCPUPercent.toFixed(1)}% (${cpuDetectionMethod})`);
        } else {
          throw new Error('Invalid CPU time value');
        }
      } else {
        throw new Error('No CPU data returned');
      }
    } catch (cpuErr) {
      console.log('[CPU] Real CPU detection failed:', cpuErr.message);
      
      if (gameProcess) {
        currentCPUPercent = 8;
        cpuDetectionMethod = 'game-process-fallback';
      } else {
        currentCPUPercent = 4;
        cpuDetectionMethod = 'main-process-fallback';
      }
      console.log(`[CPU] Using fallback method: ${currentCPUPercent}% (${cpuDetectionMethod})`);
    }
    
    console.log(`[CPU] Final CPU value: ${currentCPUPercent.toFixed(1)}% (Method: ${cpuDetectionMethod})`);
    
    if (isLearningBaseline && currentCPUPercent > 0) {
      cpuReadings.push(currentCPUPercent);
      
      console.log(`[BASELINE] Learning... (${cpuReadings.length}/${BASELINE_READINGS}) - Current: ${currentCPUPercent.toFixed(1)}% (${cpuDetectionMethod})`);
      
      const currentMessage = `Learning baseline... (${cpuReadings.length}/${BASELINE_READINGS}) - Current: ${currentCPUPercent.toFixed(1)}%`;
      if (global.mainWindow && global.lastUIMessage !== currentMessage) {
        console.log(`[STATUS] Sending baseline status to UI: (${cpuReadings.length}/${BASELINE_READINGS})`);
        global.mainWindow.webContents.send('monitoring-status', currentMessage);
        global.lastUIMessage = currentMessage;
      }
      
      if (cpuReadings.length >= BASELINE_READINGS) {
        baselineCPU = cpuReadings.reduce((a, b) => a + b, 0) / cpuReadings.length;
        
        if (cpuDetectionMethod.includes('main-process')) {
          CPU_THRESHOLD_PERCENT = Math.max(12, Math.ceil(baselineCPU * 4.0));
          console.log('[BASELINE] Using main process thresholds (menu-based)');
        } else if (cpuDetectionMethod.includes('game-process')) {
          let dynamicMultiplier;
          let minimumGap;
          
          if (baselineCPU < 10) {
            dynamicMultiplier = 2.5;
            minimumGap = 12;
          } else if (baselineCPU < 15) {
            dynamicMultiplier = 2.0;
            minimumGap = 10;
          } else if (baselineCPU < 20) {
            dynamicMultiplier = 1.7;
            minimumGap = 8;
          } else if (baselineCPU < 25) {
            dynamicMultiplier = 1.5;
            minimumGap = 7;
          } else {
            dynamicMultiplier = 1.3;
            minimumGap = 6;
          }
          
          const calculatedThreshold = Math.ceil(baselineCPU * dynamicMultiplier);
          const minimumThreshold = Math.ceil(baselineCPU + minimumGap);
          const absoluteMinimum = 25;
          
          CPU_THRESHOLD_PERCENT = Math.max(absoluteMinimum, minimumThreshold, calculatedThreshold);
          
          console.log(`[BASELINE] Hardware-adaptive threshold calculation:`);
          console.log(`[BASELINE] - Baseline: ${baselineCPU.toFixed(1)}%`);
          console.log(`[BASELINE] - Hardware category: ${baselineCPU < 10 ? 'Very Powerful' : baselineCPU < 15 ? 'Good' : baselineCPU < 20 ? 'Average' : baselineCPU < 25 ? 'Weak' : 'Very Weak'}`);
          console.log(`[BASELINE] - Multiplier: ${dynamicMultiplier}x`);
          console.log(`[BASELINE] - Calculated: ${calculatedThreshold}%`);
          console.log(`[BASELINE] - Minimum (baseline + ${minimumGap}%): ${minimumThreshold}%`);
          console.log(`[BASELINE] - Absolute minimum: ${absoluteMinimum}%`);
          console.log(`[BASELINE] - Final threshold: ${CPU_THRESHOLD_PERCENT}%`);
          console.log('[BASELINE] Using hardware-adaptive game process thresholds');
        } else {
          CPU_THRESHOLD_PERCENT = Math.max(15, Math.ceil(baselineCPU * 2.0));
          console.log('[BASELINE] Using fallback thresholds');
        }
        
        if (CPU_THRESHOLD_PERCENT < 25) CPU_THRESHOLD_PERCENT = 25;
        if (CPU_THRESHOLD_PERCENT > 60) CPU_THRESHOLD_PERCENT = 60;
        
        baselineCalculated = true;
        isLearningBaseline = false;
        
        console.log(`[BASELINE] Baseline calculated successfully!`);
        console.log(`[BASELINE] Average baseline: ${baselineCPU.toFixed(1)}%`);
        console.log(`[BASELINE] Match threshold: ${CPU_THRESHOLD_PERCENT}%`);
        console.log(`[BASELINE] Detection method: ${cpuDetectionMethod}`);
        
        const completedMessage = `Baseline completed! Threshold: ${CPU_THRESHOLD_PERCENT}% - Ready to detect matches`;
        if (global.mainWindow) {
          console.log('[STATUS] Sending baseline completed status to UI');
          global.mainWindow.webContents.send('monitoring-status', completedMessage);
          global.lastUIMessage = completedMessage;
        }
      }
      return;
    } else if (isLearningBaseline && currentCPUPercent <= 0) {
      console.log(`[BASELINE] Invalid CPU reading (${currentCPUPercent}%) - waiting for valid data...`);
      
      const waitingMessage = `Waiting for valid CPU data... (${cpuReadings.length}/${BASELINE_READINGS})`;
      if (global.mainWindow && global.lastUIMessage !== waitingMessage) {
        global.mainWindow.webContents.send('monitoring-status', waitingMessage);
        global.lastUIMessage = waitingMessage;
      }
      return;
    }
    
    let currentlyInMatch = false;
    if (baselineCalculated && currentCPUPercent > 0) {
      
      if (!isGameRunning) {
        console.log('[MATCH] Game process not running - staying in menu state');
        currentlyInMatch = false;
        
        if (global.mainWindow) {
          const menuMessage = 'Ready to detect matches - Enter a Valorant match';
          if (global.lastUIMessage !== menuMessage) {
            global.mainWindow.webContents.send('monitoring-status', menuMessage);
            global.lastUIMessage = menuMessage;
          }
        }
      } else {
        const basicMatchDetection = currentCPUPercent > CPU_THRESHOLD_PERCENT;
        
        console.log(`[MATCH] CPU: ${currentCPUPercent.toFixed(1)}% vs Threshold: ${CPU_THRESHOLD_PERCENT}% -> ${basicMatchDetection ? 'MATCH' : 'MENU'}`);
        
        stableReadings.push(basicMatchDetection);
        
        if (stableReadings.length > STABILITY_CHECKS) {
          stableReadings.shift();
        }
        
        if (stableReadings.length >= STABILITY_CHECKS) {
          const allSame = stableReadings.every(reading => reading === stableReadings[0]);
          const currentState = stableReadings[0];
          
          if (allSame) {
            if (lastStableState !== currentState) {
              console.log(`[MATCH] State change detected: ${lastStableState === null ? 'Initial' : (lastStableState ? 'Match' : 'Menu')} → ${currentState ? 'Match' : 'Menu'}`);
              
              console.log(`[MATCH] State change confirmed immediately! (${stableReadings.length}/${STABILITY_CHECKS} consecutive measurements)`);
              lastStableState = currentState;
              currentlyInMatch = currentState;
              stateChangeTime = Date.now();
            } else {
              currentlyInMatch = lastStableState || false;
            }
          } else {
            console.log(`[MATCH] Unstable state: [${stableReadings.map(r => r ? 'M' : 'X').join(', ')}] - keeping current state`);
            currentlyInMatch = lastStableState || false;
          }
        } else {
          console.log(`[MATCH] Stability check: ${stableReadings.length}/${STABILITY_CHECKS} measurements - waiting...`);
          currentlyInMatch = lastStableState || false;
        }
        
        const percentageIncrease = ((currentCPUPercent - baselineCPU) / baselineCPU * 100).toFixed(1);
        
        console.log(`CPU analysis:`);
        console.log(`   Baseline: ${baselineCPU.toFixed(1)}%`);
        console.log(`   Current: ${currentCPUPercent.toFixed(1)}%`);
        console.log(`   Increase: ${percentageIncrease}%`);
        console.log(`   Raw detection: ${basicMatchDetection ? 'IN MATCH' : 'IN MENU'}`);
        console.log(`   Stable state: ${currentlyInMatch ? 'IN MATCH' : 'IN MENU'}`);
        console.log(`   Stability: [${stableReadings.map(r => r ? 'M' : 'X').join(', ')}]`);
        
        if (global.mainWindow) {
          if (currentlyInMatch) {
            global.mainWindow.webContents.send('monitoring-status', 'In Match - Resolution settings active');
          } else if (gameEndTime && (Date.now() - gameEndTime) < GAME_END_DELAY + 2000) {
            global.mainWindow.webContents.send('monitoring-status', 'Match ended - Resolution will be restored shortly...');
          } else if (!resolutionChanged) {
            global.mainWindow.webContents.send('monitoring-status', 'In Game Menu - You can enter match');
          }
        }
      }
    }
    
    console.log('Process check:', {
      currentlyInMatch,
      inMatch,
      resolutionChanged,
      isValorantRunning,
      isGameRunning,
      baselineCalculated,
      gameStartTime: gameStartTime ? new Date(gameStartTime).toLocaleTimeString() : null,
      gameEndTime: gameEndTime ? new Date(gameEndTime).toLocaleTimeString() : null,
      gameProcessName: gameProcess?.name || 'Not Found',
      mainProcessName: valorantMainProcess?.name || 'Not Found'
    });

    if (currentlyInMatch && !inMatch) {
      console.log('Match detected! Starting resolution change process...');
      gameStartTime = Date.now();
      gameEndTime = null;
      inMatch = true;
      
      hideMainWindow();
      sendNotification(
        'Valorant Resolution Manager',
        'Match started! Resolution will be changed to match settings'
      );
      
      if (global.mainWindow) {
        global.mainWindow.webContents.send('monitoring-status', 'Match started! Resolution will change in 5 seconds...');
      }
      
      setTimeout(async () => {
        try {
          const processesAfterDelay = await getProcessList();
          const stillInGame = processesAfterDelay.some(p => 
            p.name.toLowerCase() === 'valorant-win64-shipping.exe' ||
            p.name === 'VALORANT-Win64-Shipping.exe' ||
            p.name === 'Valorant-Win64-Shipping.exe'
          );
          
          console.log('5 seconds passed, checking status:', { stillInGame, inMatch });
          
          if (stillInGame && inMatch) {
            console.log('5 seconds completed! Changing resolution...');
            await setResolution(currentGameRes.width, currentGameRes.height);
            resolutionChanged = true;
            
            sendNotification(
              'Valorant Resolution Manager',
              `Resolution set to ${currentGameRes.width}x${currentGameRes.height} - Running in background`
            );
            
            if (global.mainWindow) {
              global.mainWindow.webContents.send('monitoring-status', `In Match - Resolution changed to ${currentGameRes.width}x${currentGameRes.height}`);
            }
          } else {
            console.log('Game closed within 5 seconds, resolution not changed');
            showMainWindow();
          }
        } catch (err) {
          console.error('Post-delay check error:', err);
        }
      }, GAME_START_DELAY);
    }

    if (!currentlyInMatch && inMatch && !gameEndTime) {
      console.log('Match end detected! Starting resolution restore delay...');
      gameEndTime = Date.now();
      
      if (global.mainWindow) {
        global.mainWindow.webContents.send('monitoring-status', 'Match ended! Resolution will be restored in 5 seconds...');
      }
      
      setTimeout(async () => {
        try {
          let outOfMatchConfirmations = 0;
          const totalChecks = 3;
          
          for (let i = 0; i < totalChecks; i++) {
            try {
              const processes = await getProcessList();
              const gameProcessStillExists = processes.some(p => 
                p.name.toLowerCase() === 'valorant-win64-shipping.exe' ||
                p.name === 'VALORANT-Win64-Shipping.exe' ||
                p.name === 'Valorant-Win64-Shipping.exe'
              );
              
              if (!gameProcessStillExists) {
                console.log(`CPU check ${i+1}/${totalChecks}: Game process not found - out of match`);
                outOfMatchConfirmations++;
              } else {
                const { stdout } = await execAsync(`powershell "Get-Process -Name 'VALORANT-Win64-Shipping' -ErrorAction SilentlyContinue | ForEach-Object { $_.CPU }"`);
                
                if (stdout && stdout.trim() && baselineCalculated) {
                  const cpuTime = parseFloat(stdout.trim());
                  if (cpuTime > 0 && global.lastCpuTime) {
                    const timeDiff = (Date.now() - global.lastCheckTime) / 1000;
                    const cpuDiff = cpuTime - global.lastCpuTime;
                    const currentCPUAfterDelay = Math.max(0, (cpuDiff / timeDiff) * 100 / os.cpus().length);
                    
                    const isStillOutOfGame = currentCPUAfterDelay <= (CPU_THRESHOLD_PERCENT * 1.1);
                    
                    console.log(`CPU check ${i+1}/${totalChecks}: ${currentCPUAfterDelay.toFixed(1)}% (Threshold: ${(CPU_THRESHOLD_PERCENT * 1.1).toFixed(1)}%) - ${isStillOutOfGame ? 'OUT' : 'IN'} match`);
                    
                    if (isStillOutOfGame) {
                      outOfMatchConfirmations++;
                    }
                  } else {
                    console.log(`CPU check ${i+1}/${totalChecks}: Invalid CPU data - assuming out of match`);
                    outOfMatchConfirmations++;
                  }
                } else {
                  console.log(`CPU check ${i+1}/${totalChecks}: No CPU data - assuming out of match`);
                  outOfMatchConfirmations++;
                }
              }
              
              if (i < totalChecks - 1) {
                await new Promise(resolve => setTimeout(resolve, 2000));
              }
              
            } catch (err) {
              console.log(`CPU check ${i+1}/${totalChecks} failed:`, err.message, '- assuming out of match');
              outOfMatchConfirmations++;
            }
          }
          
          const stillOutOfGame = outOfMatchConfirmations >= Math.ceil(totalChecks / 2);
          
          console.log(`Match end confirmation: ${outOfMatchConfirmations}/${totalChecks} checks confirm out of match`);
          console.log('5 seconds passed, checking match end status:', { 
            stillOutOfGame, 
            resolutionChanged,
            inMatch,
            outOfMatchConfirmations,
            totalChecks
          });
          
          if (stillOutOfGame && resolutionChanged) {
            console.log('5 seconds completed and confirmed out of match! Restoring resolution...');
            await setResolution(currentNormalRes.width, currentNormalRes.height);
            console.log('Resolution successfully restored');
            resolutionChanged = false;
            
            showMainWindow();
            sendNotification(
              'Valorant Resolution Manager',
              `Match ended! Resolution restored to ${currentNormalRes.width}x${currentNormalRes.height}`
            );
            
            if (global.mainWindow) {
              console.log('[UI] Sending restoration success message to UI');
              global.mainWindow.webContents.send('monitoring-status', `MATCH ENDED! Resolution restored to ${currentNormalRes.width}x${currentNormalRes.height}!`);
              
              setTimeout(() => {
                global.mainWindow.webContents.send('monitoring-status', `System running - Ready for new match`);
              }, 3000);
            }
          } else if (!stillOutOfGame) {
            console.log('Still in match or re-entered match, resolution not restored');
            gameEndTime = null;
          }
          
          if (stillOutOfGame) {
            inMatch = false;
            gameStartTime = null;
            gameEndTime = null;
            console.log('Match state reset');
          }
          
        } catch (err) {
          console.error('Match end delay check error:', err);
        }
      }, GAME_END_DELAY);
    }

    if (!isValorantRunning && resolutionChanged) {
      console.log('Valorant completely closed! Immediately restoring resolution...');
      try {
        await setResolution(currentNormalRes.width, currentNormalRes.height);
        console.log('Resolution successfully restored');
        resolutionChanged = false;
        
        showMainWindow();
        sendNotification(
          'Valorant Resolution Manager',
          `Valorant closed! Resolution restored to ${currentNormalRes.width}x${currentNormalRes.height}`
        );
      } catch (err) {
        console.error('Resolution restore error:', err);
      }
      
      inMatch = false;
      gameStartTime = null;
      gameEndTime = null;
      console.log('Valorant closed, state reset');
    }
    
  } catch (error) {
    console.error('Process check error:', error);
  }
}

function startMonitoring() {
  console.log('Valorant monitoring started...');
  monitoringInterval = setInterval(checkMatch, 3000);
  
  return () => {
    if (monitoringInterval) {
      clearInterval(monitoringInterval);
      monitoringInterval = null;
      console.log('Monitoring stopped.');
    }
  };
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
  
  global.lastUIMessage = null;
  
  global.lastCpuTime = null;
  global.lastCheckTime = null;
  global.lastCPUPercent = null;
  
  console.log(`[MONITORING] Valorant monitoring started:`);
  console.log(`[MONITORING] Game Resolution: ${gameRes.width}x${gameRes.height}`);
  console.log(`[MONITORING] Normal Resolution: ${normalRes.width}x${normalRes.height}`);
  console.log(`[MONITORING] Match Start Delay: ${GAME_START_DELAY/1000} seconds`);
  console.log(`[MONITORING] Match End Delay: ${GAME_END_DELAY/1000} seconds`);
  console.log(`[MONITORING] Learning baseline... (${BASELINE_READINGS} measurements to be taken)`);
  console.log(`[MONITORING] CPU threshold: Will be automatically determined`);
  console.log(`[MONITORING] Stability control: ${STABILITY_CHECKS} consecutive measurements, min ${MIN_STATE_DURATION/1000}s wait`);
  
  if (global.mainWindow) {
    console.log('[STATUS] Sending initial status to UI: Monitoring started');
    global.mainWindow.webContents.send('monitoring-status', 'Monitoring started - Looking for Valorant...');
    global.lastUIMessage = 'Monitoring started - Looking for Valorant...';
  }
  
  monitoringInterval = setInterval(checkMatch, 3000);
  
  return () => {
    if (monitoringInterval) {
      clearInterval(monitoringInterval);
      monitoringInterval = null;
      
      global.lastUIMessage = null;
      
      if (resolutionChanged) {
        console.log('Stopping monitoring, restoring resolution to normal...');
        setResolution(currentNormalRes.width, currentNormalRes.height);
        resolutionChanged = false;
      }
      
      inMatch = false;
      gameStartTime = null;
      gameEndTime = null;
      console.log('[MONITORING] Monitoring stopped.');
    }
  };
}

function updateResolutions(gameRes, normalRes) {
  console.log(`[UPDATE] Updating resolutions during active monitoring:`);
  console.log(`[UPDATE] Old Game Resolution: ${currentGameRes.width}x${currentGameRes.height}`);
  console.log(`[UPDATE] New Game Resolution: ${gameRes.width}x${gameRes.height}`);
  console.log(`[UPDATE] Old Normal Resolution: ${currentNormalRes.width}x${currentNormalRes.height}`);
  console.log(`[UPDATE] New Normal Resolution: ${normalRes.width}x${normalRes.height}`);
  
  currentGameRes = gameRes;
  currentNormalRes = normalRes;
  
  if (global.mainWindow) {
    global.mainWindow.webContents.send('monitoring-status', `Resolution settings updated: Game ${gameRes.width}x${gameRes.height}, Desktop ${normalRes.width}x${normalRes.height}`);
  }
  
  console.log(`[UPDATE] Resolutions updated successfully`);
}

async function debugCurrentState() {
  console.log('DEBUG: Checking current state...');
  
  try {
    const processes = await getProcessList();
    
    const valorantMainProcess = processes.find(p => 
      p.name.toLowerCase() === 'valorant.exe' ||
      p.name === 'VALORANT.exe'
    );
    
    const gameProcess = processes.find(p => 
      p.name.toLowerCase() === 'valorant-win64-shipping.exe' ||
      p.name === 'VALORANT-Win64-Shipping.exe' ||
      p.name === 'Valorant-Win64-Shipping.exe'
    );
    
    console.log('Process status:', {
      valorantMain: valorantMainProcess ? `${valorantMainProcess.name} (PID: ${valorantMainProcess.pid})` : 'Not Found',
      gameProcess: gameProcess ? `${gameProcess.name} (PID: ${gameProcess.pid})` : 'Not Found'
    });
    
    if (gameProcess) {
      try {
        const { stdout } = await execAsync(`powershell "Get-Process -Name 'VALORANT-Win64-Shipping' -ErrorAction SilentlyContinue | ForEach-Object { [math]::Round(\$_.WorkingSet64/1MB,2) }"`);
        
        if (stdout && stdout.trim()) {
          const memoryMB = parseFloat(stdout.trim());
          console.log(`Current RAM usage: ${memoryMB.toFixed(0)}MB`);
          
          if (baselineCalculated) {
            const currentlyInMatch = memoryMB > CPU_THRESHOLD_PERCENT;
            const percentageIncrease = ((memoryMB - baselineCPU) / baselineCPU * 100).toFixed(1);
            
            console.log(`Memory analysis (debug):`);
            console.log(`Baseline: ${baselineCPU ? baselineCPU.toFixed(1) : 'N/A'}%`);
            console.log(`Current: ${memoryMB.toFixed(0)}MB`);
            console.log(`Increase: ${percentageIncrease}%`);
            console.log(`Status: ${currentlyInMatch ? 'IN MATCH' : 'IN MENU'}`);
          } else {
            console.log(`Baseline not calculated yet`);
          }
        }
      } catch (err) {
        console.log(`PowerShell error:`, err.message);
      }
    }
    
    console.log(`Monitoring status:`, {
      baselineCalculated,
      baselineCPU: baselineCPU ? `${baselineCPU.toFixed(1)}%` : null,
      inMatch,
      resolutionChanged,
      isLearningBaseline,
      cpuReadingsCount: cpuReadings.length
    });
    
  } catch (error) {
    console.error('Debug check error:', error);
  }
}

module.exports = {
  setResolution,
  startMonitoring,
  startMonitoringWithResolutions,
  updateResolutions,
  debugCurrentState
};
