/**
 * Electron 预加载脚本
 * 安全地暴露必要的 API 到渲染进程
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  openPDFDialog: () => ipcRenderer.invoke('dialog:openPDF'),
});
