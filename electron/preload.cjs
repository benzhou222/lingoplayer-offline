const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    isElectron: true,

    /**
     * 使用 MessageChannel 进行零拷贝音频数据提取
     * @param {string} videoPath 
     * @returns {Promise<Float32Array>}
     */
    extractAudio: (videoPath) => {
        return new Promise((resolve, reject) => {
            // 创建本地 MessageChannel
            const { port1, port2 } = new MessageChannel();

            // 监听来自主进程的回复
            port1.onmessage = (event) => {
                const { status, buffer, error } = event.data;

                if (status === 'complete') {
                    // buffer 此时是 ArrayBuffer，转换为 Float32Array 供应用使用
                    try {
                        const float32Data = new Float32Array(buffer);
                        resolve(float32Data);
                    } catch (e) {
                        reject(new Error("Failed to decode audio buffer from main process"));
                    }
                } else {
                    reject(new Error(error || 'Audio extraction failed'));
                }

                // 关闭端口
                port1.close();
            };

            // 发送请求给主进程，同时移交 port2 的所有权
            ipcRenderer.postMessage('extract-audio-stream', { videoPath }, [port2]);
        });
    },

    /**
     * 视频转码
     */
    convertVideo: (inputPath, outputPath) => ipcRenderer.invoke('convert-video', inputPath, outputPath),

    /**
     * 监听转码进度
     */
    onConversionProgress: (callback) => {
        const subscription = (event, percent) => callback(percent);
        ipcRenderer.on('conversion-progress', subscription);
        return () => {
            ipcRenderer.removeListener('conversion-progress', subscription);
        };
    },

    /**
     * 取消转码
     */
    cancelConversion: () => ipcRenderer.invoke('cancel-conversion'),
});