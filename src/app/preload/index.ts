import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type RendererApi, type SceneEvent } from '../ipc'

const api: RendererApi = {
  listPacks: () => ipcRenderer.invoke(IPC.listPacks),
  choosePack: (key) => ipcRenderer.invoke(IPC.choosePack, key),
  openPacksFolder: () => ipcRenderer.invoke(IPC.openPacksFolder),
  getPackFolders: () => ipcRenderer.invoke(IPC.getPackFolders),
  setPackFolders: (folders) => ipcRenderer.invoke(IPC.setPackFolders, folders),
  chooseFolder: () => ipcRenderer.invoke(IPC.chooseFolder),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (update) => ipcRenderer.invoke(IPC.saveSettings, update),
  listModels: (request) => ipcRenderer.invoke(IPC.listModels, request),
  testConnection: (profileId) => ipcRenderer.invoke(IPC.testConnection, profileId),
  sceneTurn: (request) => ipcRenderer.invoke(IPC.sceneTurn, request),
  sceneEnd: (state) => ipcRenderer.invoke(IPC.sceneEnd, state),
  listSaves: () => ipcRenderer.invoke(IPC.listSaves),
  saveGame: (request) => ipcRenderer.invoke(IPC.saveGame, request),
  loadGame: (slotId) => ipcRenderer.invoke(IPC.loadGame, slotId),
  deleteSave: (slotId) => ipcRenderer.invoke(IPC.deleteSave, slotId),
  onSceneEvent: (listener) => {
    const heard = (_event: unknown, sceneEvent: SceneEvent) => listener(sceneEvent)
    ipcRenderer.on(IPC.sceneEvent, heard)
    return () => ipcRenderer.removeListener(IPC.sceneEvent, heard)
  }
}

contextBridge.exposeInMainWorld('api', api)
