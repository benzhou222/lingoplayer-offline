const { app, BrowserWindow, session, shell } = require('electron');
const path = require('path');

// 适配 Windows 7 等旧系统（可选，视情况开启）
// app.disableHardwareAcceleration();

// 设置 Windows 下的 App ID，确保通知正常显示
if (process.platform === 'win32') {
    app.setAppUserModelId(app.getName());
}

// 单例锁：防止用户打开多个应用实例
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
        backgroundColor: '#030712', // bg-gray-950 的颜色，防止加载时白屏
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false, // 允许在渲染进程简单使用 Node API
            webSecurity: true, // 保持安全策略开启
        },
        show: false, // 此时隐藏，等待 ready-to-show 再显示
        autoHideMenuBar: true, // 隐藏默认菜单栏
    });

    // 【核心代码】配置 COOP/COEP 安全头，确保 FFmpeg WASM 能够运行
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Cross-Origin-Opener-Policy': ['same-origin'],
                'Cross-Origin-Embedder-Policy': ['require-corp'],
            },
        });
    });

    // 根据环境加载页面
    // 运行 npm run electron:dev 时，会传入 --dev 参数（或根据 NODE_ENV）
    // 注意：需要确保 package.json 中的 electron:dev 脚本通过 concurrently 启动了 Vite
    if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
        // 开发环境：加载 Vite 本地服务
        // 等待一小会儿确保 Vite 启动（虽然 concurrently 会处理，但为了稳妥）
        // 或者结合 wait-on 库使用
        await mainWindow.loadURL('http://localhost:3000');
        // 开发环境自动打开调试控制台
        mainWindow.webContents.openDevTools();
    } else {
        // 生产环境：加载打包后的 index.html
        // __dirname 指向 resources/app/electron/
        // 所以 index.html 在 ../dist/index.html
        const indexPath = path.join(__dirname, '../dist/index.html');
        mainWindow.loadFile(indexPath);
    }

    // 优雅显示窗口
    mainWindow.on('ready-to-show', () => {
        mainWindow.show();
    });

    // 拦截新窗口跳转，使用系统默认浏览器打开外部链接
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

// Electron 初始化完成后创建窗口
app.whenReady().then(createWindow);

// 所有窗口关闭时退出应用
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