'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  seleccionarCarpeta: () => ipcRenderer.invoke('dialog:seleccionar-carpeta'),
  seleccionarCarpetas: () => ipcRenderer.invoke('dialog:seleccionar-carpetas'),
  seleccionarArchivosExcel: () => ipcRenderer.invoke('dialog:seleccionar-archivos-excel'),
  seleccionarArchivoExcel: () => ipcRenderer.invoke('dialog:seleccionar-archivo-excel'),
  guardarArchivoExcel: (nombreSugerido) => ipcRenderer.invoke('dialog:guardar-archivo-excel', nombreSugerido),
});
