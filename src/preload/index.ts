import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type RendererApi } from '../shared/ipc'

const api: RendererApi = {
  getContent: () => ipcRenderer.invoke(IPC.getContent),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (update) => ipcRenderer.invoke(IPC.saveSettings, update),
  listModels: (request) => ipcRenderer.invoke(IPC.listModels, request),
  testConnection: (profileId) => ipcRenderer.invoke(IPC.testConnection, profileId)
}

contextBridge.exposeInMainWorld('api', api)
