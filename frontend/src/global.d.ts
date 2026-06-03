/* Electron API 类型声明（通过 preload.js 注入） */
interface ElectronAPI {
  platform: string
  isElectron: boolean
  openPDFDialog: () => Promise<{ canceled: boolean; paths: string[] }>
}

interface Window {
  electronAPI?: ElectronAPI
}
