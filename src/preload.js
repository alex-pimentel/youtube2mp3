const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectOutputFolder: () => ipcRenderer.invoke('select-output-folder'),
    getOutputFolder: () => ipcRenderer.invoke('get-output-folder'),
    addToQueue: (url) => ipcRenderer.send('add-to-queue', url),
    onQueueUpdate: (callback) => {
        const listener = (_event, queue) => callback(queue);
        ipcRenderer.on('queue-update', listener);
        return () => ipcRenderer.removeListener('queue-update', listener); // Função para remover o listener
    },
    onUserNotification: (callback) => {
        const listener = (_event, notification) => callback(notification);
        ipcRenderer.on('user-notification', listener);
        return () => ipcRenderer.removeListener('user-notification', listener);
    }
});