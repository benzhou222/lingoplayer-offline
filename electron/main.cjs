
const { app, BrowserWindow, session, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');

// --- FFMPEG PATH HANDLING ---
let ffmpegPath;
if (app.isPackaged) {
    // 生产环境：通常在 resources/ffmpeg.exe 或 app.asar.unpacked 中
    // 优先检查 extraResources 配置的根目录
    const resourcePath = path.join(process.resourcesPath, 'ffmpeg.exe');
    if (fs.existsSync(resourcePath)) {
        ffmpegPath = resourcePath;
    } else {
        // 回退到 ffmpeg-static 的默认 unpacked 路径
        ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
    }
} else {
    // 开发环境：直接使用 node_modules 中的二进制
    ffmpegPath = require('ffmpeg-static');
}

console.log('[Main] FFmpeg Path:', ffmpegPath);
ffmpeg.setFfmpegPath(ffmpegPath);

// 适配 Windows 7 等旧系统
// app.disableHardwareAcceleration();

if (process.platform === 'win32') {
    app.setAppUserModelId(app.getName());
}

if (!app.requestSingleInstanceLock()) {
    app.quit();
    process.exit(0);
}

let mainWindow = null;

async function createWindow() {
    mainWindow = new BrowserWindow({
        title: 'LingoPlayer AI',
        width: 1200,
        height: 800,
        backgroundColor: '#030712',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false,
            // CRITICAL FIX: Load the preload script to expose window.electron
            preload: path.join(__dirname, 'preload.cjs'),
        },
        show: false,
        autoHideMenuBar: true,
    });

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Cross-Origin-Opener-Policy': ['same-origin'],
                'Cross-Origin-Embedder-Policy': ['require-corp'],
            },
        });
    });

    if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
        await mainWindow.loadURL('http://localhost:3000');
        mainWindow.webContents.openDevTools();
    } else {
        const indexPath = path.join(__dirname, '../dist/index.html');
        mainWindow.loadFile(indexPath);
    }

    mainWindow.on('ready-to-show', () => {
        mainWindow.show();
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https:') || url.startsWith('http:')) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// --- IPC HANDLERS ---
const activeCommands = new Map();

ipcMain.handle('ffmpeg-extract-audio', async (event, filePath) => {
    console.log('[IPC] Extract Audio Request:', filePath);
    return new Promise((resolve, reject) => {
        const chunks = [];
        const command = ffmpeg(filePath)
            .noVideo()
            .audioChannels(1)
            .audioFrequency(16000)
            .format('f32le')
            .on('start', (cmdLine) => console.log('[FFmpeg] Start Extract:', cmdLine))
            .on('error', (err) => {
                console.error('[FFmpeg] Extract Error:', err);
                reject(err.message);
            })
            .on('end', () => {
                console.log('[FFmpeg] Extract Complete');
                const buffer = Buffer.concat(chunks);
                resolve(buffer);
            });

        const stream = command.pipe();
        stream.on('data', chunk => chunks.push(chunk));
    });
});

ipcMain.handle('ffmpeg-convert-video', async (event, filePath, jobId) => {
    console.log('[IPC] Convert Video Request:', filePath, jobId);
    return new Promise((resolve, reject) => {
        const dir = path.dirname(filePath);
        const name = path.parse(filePath).name;
        const outputPath = path.join(dir, `${name}.mp4`);

        let totalDurationSec = 0;

        const command = ffmpeg(filePath)
            .output(outputPath)
            .videoCodec('libx264')
            .addOutputOptions('-preset ultrafast') // Optimize for speed
            .addOutputOptions('-crf 26') // Slightly lower quality for faster encoding (23 is default, 28 is lower)
            .addOutputOptions('-pix_fmt yuv420p') // Ensure broad compatibility
            .audioCodec('aac')
            .on('start', (cmdLine) => console.log('[FFmpeg] Start Convert:', cmdLine))
            .on('codecData', (data) => {
                // Parse duration: HH:MM:SS.ms
                if (data && data.duration) {
                    const parts = data.duration.split(':');
                    const s = parseFloat(parts.pop());
                    const m = parseInt(parts.pop() || '0');
                    const h = parseInt(parts.pop() || '0');
                    totalDurationSec = (h * 3600) + (m * 60) + s;
                    console.log(`[FFmpeg] Total Duration: ${totalDurationSec}s`);
                }
            })
            .on('progress', (progress) => {
                let percent = progress.percent;

                // Fallback calculation if percent is missing (common with MKV)
                if ((typeof percent !== 'number' || percent < 0) && totalDurationSec > 0 && progress.timemark) {
                    const parts = progress.timemark.split(':');
                    const s = parseFloat(parts.pop());
                    const m = parseInt(parts.pop() || '0');
                    const h = parseInt(parts.pop() || '0');
                    const currentSec = (h * 3600) + (m * 60) + s;
                    percent = (currentSec / totalDurationSec) * 100;
                }

                // Ensure reasonable bounds
                if (typeof percent === 'number') {
                    percent = Math.min(99.9, Math.max(0, percent));

                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('conversion-progress', { jobId, percent });
                    }
                }
            })
            .on('error', (err) => {
                console.error('[FFmpeg] Convert Error:', err.message);

                // CLEANUP: Delete the partial file if it was killed or failed
                if (err.message.includes('SIGKILL')) {
                    console.log('[FFmpeg] Job cancelled, cleaning up partial file:', outputPath);
                    fs.unlink(outputPath, (unlinkErr) => {
                        if (unlinkErr && unlinkErr.code !== 'ENOENT') {
                            console.error('Failed to cleanup file:', unlinkErr);
                        }
                    });
                }

                activeCommands.delete(jobId);
                reject(err.message);
            })
            .on('end', () => {
                console.log('[FFmpeg] Convert Complete:', outputPath);
                activeCommands.delete(jobId);
                resolve(outputPath);
            });

        activeCommands.set(jobId, command);
        command.run();
    });
});

ipcMain.handle('ffmpeg-cancel', async (event, jobId) => {
    if (activeCommands.has(jobId)) {
        const command = activeCommands.get(jobId);
        try {
            command.kill();
            console.log(`[IPC] Killed native FFmpeg job: ${jobId}`);
        } catch (e) {
            console.error(`[IPC] Failed to kill job ${jobId}`, e);
        }
        activeCommands.delete(jobId);
    }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});
