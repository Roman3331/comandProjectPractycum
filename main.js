const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let mainWindow;
let currentUser = null;
let userData = {};
let currentFilePath = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
  loadUserData();
});

function loadUserData() {
  try {
    if (fs.existsSync('users.json')) {
      userData = JSON.parse(fs.readFileSync('users.json'));
    }
  } catch (error) {
    console.error('Error loading user data:', error);
  }
}

function saveUserData() {
  fs.writeFileSync('users.json', JSON.stringify(userData, null, 2));
}

ipcMain.handle('login', async (event, { username, password }) => {
  const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
  
  if (!userData[username]) {
    userData[username] = {
      password: hashedPassword,
      recentFiles: [],
      recentModes: [],
      sentMessages: [],
      receivedMessages: [],
      lastSettings: null
    };
    saveUserData();
    currentUser = username;
    return { success: true, settings: null };
  } else if (userData[username].password === hashedPassword) {
    currentUser = username;
    return { success: true, settings: userData[username].lastSettings };
  }
  return { success: false, message: 'Invalid credentials' };
});

ipcMain.handle('logout', async () => {
  currentUser = null;
  return { success: true };
});

ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'BMP Files', extensions: ['bmp'] }],
    properties: ['openFile']
  });

  if (!result.canceled && result.filePaths[0]) {
    currentFilePath = result.filePaths[0];
    if (currentUser) {
      if (!userData[currentUser].recentFiles.includes(currentFilePath)) {
        userData[currentUser].recentFiles.unshift(currentFilePath);
        if (userData[currentUser].recentFiles.length > 3) {
          userData[currentUser].recentFiles.pop();
        }
        saveUserData();
      }
    }
    return currentFilePath;
  }
  return null;
});

ipcMain.handle('create-bmp', async (event, { mode, colorScheme }) => {
  if (!currentFilePath) return { success: false, message: 'No file selected' };

  const bmpData = fs.readFileSync(currentFilePath);
  const width = bmpData.readUInt32LE(18);
  const height = bmpData.readUInt32LE(22);
  
  const newBmp = Buffer.alloc(bmpData.length);
  bmpData.copy(newBmp, 0, 0, 54); // Copy header

  let pixelIndex = 54;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r, g, b;
      
      // Modes for bitmap generation
      switch (mode) {
        case 'gradient':
          r = (x / width) * 255;
          g = (y / height) * 255;
          b = ((x + y) / (width + height)) * 255;
          break;
        case 'waves':
          r = Math.sin(x / 50) * 127 + 128;
          g = Math.sin(y / 50) * 127 + 128;
          b = Math.sin((x + y) / 50) * 127 + 128;
          break;
        case 'noise':
          r = Math.random() * 255;
          g = Math.random() * 255;
          b = Math.random() * 255;
          break;
      }

      // Color schemes
      switch (colorScheme) {
        case 'rgb':
          // Keep as is
          break;
        case 'grayscale':
          const avg = (r + g + b) / 3;
          r = g = b = avg;
          break;
        case 'inverted':
          r = 255 - r;
          g = 255 - g;
          b = 255 - b;
          break;
      }

      newBmp[pixelIndex++] = Math.floor(b);
      newBmp[pixelIndex++] = Math.floor(g);
      newBmp[pixelIndex++] = Math.floor(r);
    }
  }

  const saveResult = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'BMP Files', extensions: ['bmp'] }]
  });

  if (!saveResult.canceled && saveResult.filePath) {
    fs.writeFileSync(saveResult.filePath, newBmp);
    
    if (currentUser) {
      userData[currentUser].recentModes.unshift({ mode, colorScheme });
      if (userData[currentUser].recentModes.length > 3) {
        userData[currentUser].recentModes.pop();
      }
      userData[currentUser].lastSettings = { mode, colorScheme };
      saveUserData();
    }
    
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle('hide-message', async (event, { message }) => {
  if (!currentFilePath) return { success: false, message: 'No file selected' };

  const bmpData = fs.readFileSync(currentFilePath);
  const newBmp = Buffer.from(bmpData);
  const messageBytes = Buffer.from(message, 'utf8');
  
  let bitIndex = 0;
  for (let i = 0; i < messageBytes.length && bitIndex < (bmpData.length - 54) * 8; i++) {
    for (let bit = 0; bit < 8; bit++) {
      const pixelByteIndex = 54 + Math.floor(bitIndex / 8);
      const bitValue = (messageBytes[i] >> (7 - bit)) & 1;
      newBmp[pixelByteIndex] = (newBmp[pixelByteIndex] & 0xFE) | bitValue;
      bitIndex++;
    }
  }

  const saveResult = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'BMP Files', extensions: ['bmp'] }]
  });

  if (!saveResult.canceled && saveResult.filePath) {
    fs.writeFileSync(saveResult.filePath, newBmp);
    
    if (currentUser) {
      userData[currentUser].sentMessages.unshift(message);
      if (userData[currentUser].sentMessages.length > 3) {
        userData[currentUser].sentMessages.pop();
      }
      saveUserData();
    }
    
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle('extract-message', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'BMP Files', extensions: ['bmp'] }],
    properties: ['openFile']
  });

  if (!result.canceled && result.filePaths[0]) {
    const bmpData = fs.readFileSync(result.filePaths[0]);
    let messageBytes = [];
    let currentByte = 0;
    let bitCount = 0;

    for (let i = 54; i < bmpData.length && messageBytes.length < 1000; i++) {
      currentByte = (currentByte << 1) | (bmpData[i] & 1);
      bitCount++;
      
      if (bitCount === 8) {
        messageBytes.push(currentByte);
        if (currentByte === 0) break; // End of string
        currentByte = 0;
        bitCount = 0;
      }
    }

    const message = Buffer.from(messageBytes).toString('utf8');
    
    if (currentUser) {
      userData[currentUser].receivedMessages.unshift(message);
      if (userData[currentUser].receivedMessages.length > 3) {
        userData[currentUser].receivedMessages.pop();
      }
      saveUserData();
    }
    
    return { success: true, message };
  }
  return { success: false };
});

ipcMain.handle('get-user-data', async () => {
  if (currentUser) {
    return {
      recentFiles: userData[currentUser].recentFiles,
      recentModes: userData[currentUser].recentModes,
      sentMessages: userData[currentUser].sentMessages,
      receivedMessages: userData[currentUser].receivedMessages
    };
  }
  return null;
});

ipcMain.handle('show-about', async () => {
  return {
    about: 'BMP Editor Application\nVersion 1.0.0',
    authors: 'Developed by xAI Team',
    instructions: '1. Login to access all features\n2. Select BMP file to work with\n3. Choose generation mode and color scheme\n4. Create new BMP or hide/extract messages\n5. Save results using system dialogs'
  };
});