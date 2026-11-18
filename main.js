'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const crearApp = require('./server/app');

const PUERTO = 4123;
let mainWindow;

function iniciarServidor() {
  // Carpeta donde se guardan clientes y regímenes (persiste entre sesiones y actualizaciones)
  process.env.CFDI_DATA_DIR = app.getPath('userData');
  const expressApp = crearApp();
  expressApp.listen(PUERTO, () => {
    console.log(`Servidor interno escuchando en http://localhost:${PUERTO}`);
  });
}

function crearVentana() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://localhost:${PUERTO}`);
  // Descomentar para depurar:
  // mainWindow.webContents.openDevTools();
}

// Expone el diálogo nativo de selección de carpeta al renderer (vía preload.js)
ipcMain.handle('dialog:seleccionar-carpeta', async () => {
  const resultado = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Selecciona la carpeta con los CFDIs y los Excel',
  });

  if (resultado.canceled || resultado.filePaths.length === 0) return null;
  return resultado.filePaths[0];
});

// Diálogo para seleccionar VARIAS carpetas a la vez (una por cada mes),
// usado en "Buscar pagos de diferentes meses".
ipcMain.handle('dialog:seleccionar-carpetas', async () => {
  const resultado = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'multiSelections'],
    title: 'Selecciona las carpetas de los meses a analizar',
  });

  if (resultado.canceled || resultado.filePaths.length === 0) return [];
  return resultado.filePaths;
});

// Diálogo para seleccionar UNO O VARIOS archivos Excel (los "Emitidos" de cada mes),
// usado en "Llenar Excel de Ingresos".
ipcMain.handle('dialog:seleccionar-archivos-excel', async () => {
  const resultado = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
    title: 'Selecciona uno o varios Excel de Emitidos (nombrados por mes)',
  });

  if (resultado.canceled || resultado.filePaths.length === 0) return [];
  return resultado.filePaths;
});

// Diálogo para seleccionar UN SOLO archivo Excel (el maestro de 12 pestañas),
// usado en "Llenar Excel de Ingresos".
ipcMain.handle('dialog:seleccionar-archivo-excel', async () => {
  const resultado = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
    title: 'Selecciona el Excel de Ingresos (con las 12 pestañas)',
  });

  if (resultado.canceled || resultado.filePaths.length === 0) return null;
  return resultado.filePaths[0];
});

// Diálogo para elegir dónde guardar el Excel de Ingresos ya rellenado.
ipcMain.handle('dialog:guardar-archivo-excel', async (event, nombreSugerido) => {
  const resultado = await dialog.showSaveDialog(mainWindow, {
    title: 'Guardar Excel de Ingresos rellenado',
    defaultPath: nombreSugerido || 'Ingresos.xlsx',
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  });

  if (resultado.canceled || !resultado.filePath) return null;
  return resultado.filePath;
});

app.whenReady().then(() => {
  iniciarServidor();
  crearVentana();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) crearVentana();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
