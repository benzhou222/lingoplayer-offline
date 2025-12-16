
const { ipcRenderer } = require('electron');

// Since contextIsolation is false, we don't strictly need contextBridge.
// However, to keep compatibility with existing frontend checks for window.electron:
window.electron = {
    isElectron: true,
    // Native extraction via Main process
    extractAudio: (filePath) => ipcRenderer.invoke('ffmpeg-extract-audio', filePath),

    // Native conversion via Main process
    convertVideo: (filePath, jobId) => ipcRenderer.invoke('ffmpeg-convert-video', filePath, jobId),

    // Cancel command
    cancelConversion: (jobId) => ipcRenderer.invoke('ffmpeg-cancel', jobId),

    // Progress Listener
    onConversionProgress: (callback) => {
        // Don't remove all listeners, otherwise parallel jobs might break or components might lose state.
        // Instead, just add a new one and return a cleanup function.
        const listener = (event, data) => callback(data);
        ipcRenderer.on('conversion-progress', listener);

        // Return a function to unsubscribe
        return () => ipcRenderer.removeListener('conversion-progress', listener);
    }
};
