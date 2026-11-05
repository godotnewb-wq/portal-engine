import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type RendererApi, type SceneEvent } from '../shared/ipc'

const api: RendererApi = {
  getContent: () => ipcRenderer.invoke(IPC.getContent),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (update) => ipcRenderer.invoke(IPC.saveSettings, update),
  listModels: (request) => ipcRenderer.invoke(IPC.listModels, request),
  testConnection: (profileId) => ipcRenderer.invoke(IPC.testConnection, profileId),
  sceneTurn: (request) => ipcRenderer.invoke(IPC.sceneTurn, request),
  sceneEnd: (state) => ipcRenderer.invoke(IPC.sceneEnd, state),
  onSceneEvent: (listener) => {
    const heard = (_event: unknown, sceneEvent: SceneEvent) => listener(sceneEvent)
    ipcRenderer.on(IPC.sceneEvent, heard)
    return () => ipcRenderer.removeListener(IPC.sceneEvent, heard)
  }
}

contextBridge.exposeInMainWorld('api', api)
