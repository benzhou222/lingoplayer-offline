import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// CACHE
let cachedCoreURL: string | null = null;
let cachedWasmURL: string | null = null;
let cachedWorkerURL: string | null = null;

const activeJobs = new Map<string, { terminate: () => void }>();

// Helper to check for Electron
function getElectron() {
    // @ts-ignore
    return (typeof window !== 'undefined' && window.electron && window.electron.isElectron) ? window.electron : null;
}

async function createFreshFFmpeg(onProgress?: (progress: number) => void) {
    const instance = new FFmpeg();
    if (onProgress) onProgress(1);

    // Check Cross-Origin Isolation (Needed for SharedArrayBuffer)
    const isMultiThreaded = window.crossOriginIsolated;
    console.log(`[FFmpeg WASM] Loading... Multi-threaded: ${isMultiThreaded}`);

    const coreBase = isMultiThreaded
        ? 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm'
        : 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';

    if (onProgress) onProgress(5);

    try {
        if (!cachedCoreURL || !cachedWasmURL) {
            cachedCoreURL = await toBlobURL(`${coreBase}/ffmpeg-core.js`, 'text/javascript');
            cachedWasmURL = await toBlobURL(`${coreBase}/ffmpeg-core.wasm`, 'application/wasm');
            if (isMultiThreaded) {
                cachedWorkerURL = await toBlobURL(`${coreBase}/ffmpeg-core.worker.js`, 'text/javascript');
            }
        }

        await instance.load({
            coreURL: cachedCoreURL,
            wasmURL: cachedWasmURL,
            workerURL: cachedWorkerURL || undefined,
        });

    } catch (e: any) {
        console.error("FFmpeg WASM load failed:", e);
        if (isMultiThreaded) {
            console.warn("Retrying with single-threaded core...");
            const stBase = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
            try {
                await instance.load({
                    coreURL: await toBlobURL(`${stBase}/ffmpeg-core.js`, 'text/javascript'),
                    wasmURL: await toBlobURL(`${stBase}/ffmpeg-core.wasm`, 'application/wasm'),
                });
            } catch (retryError: any) {
                throw new Error(`FFmpeg Load Failed (Retry): ${retryError.message}`);
            }
        } else {
            throw new Error(`FFmpeg Load Failed: ${e.message}`);
        }
    }

    if (onProgress) onProgress(10);
    return instance;
}

/**
 * Extracts audio from a video file.
 */
export async function extractAudioAsWav(videoFile: File): Promise<Float32Array> {
    const electron = getElectron();
    const filePath = (videoFile as any).path;

    // 1. ELECTRON NATIVE PATH
    if (electron && filePath) {
        try {
            console.log("[Converter] ⚡ Using Native Electron FFmpeg for Extraction:", filePath);
            const buffer = await electron.extractAudio(filePath);

            // Native buffer is F32LE raw
            const floatArray = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
            console.log("[Converter] Extraction successful. Samples:", floatArray.length);
            return floatArray;
        } catch (e: any) {
            console.error("Native extraction failed:", e);
            throw new Error(`Native Audio Extraction Failed: ${e.message}`);
        }
    }

    // 2. BROWSER WASM PATH
    console.log("[Converter] 🐢 Using Browser WASM FFmpeg for Extraction (Native not available)");
    let instance: FFmpeg | null = null;

    try {
        instance = await createFreshFFmpeg();
    } catch (e: any) {
        throw new Error(`[FFmpeg] Engine Load Error: ${e.message}`);
    }

    const logBuffer: string[] = [];
    instance.on('log', ({ message }) => {
        logBuffer.push(message);
        if (logBuffer.length > 30) logBuffer.shift();
    });

    const MOUNT_THRESHOLD = 256 * 1024 * 1024;
    const useMount = videoFile.size > MOUNT_THRESHOLD;

    const mountDir = '/data';
    const safeFileName = 'input_video';
    const mountedFileName = videoFile.name.replace(/['"\s]/g, '_');
    const inputPath = useMount ? `${mountDir}/${mountedFileName}` : safeFileName;
    const outputName = 'output.wav';

    try {
        if (useMount) {
            try { await instance.createDir(mountDir); } catch (e) { }
            // @ts-ignore
            await instance.mount('WORKERFS', {
                files: [new File([videoFile], mountedFileName, { type: videoFile.type })]
            }, mountDir);
        } else {
            await instance.writeFile(inputPath, await fetchFile(videoFile));
        }

        const threads = window.crossOriginIsolated ? Math.min(navigator.hardwareConcurrency || 4, 8) : 1;

        const cmd = ['-i', inputPath, '-vn', '-ar', '16000', '-ac', '1', '-map', '0:a:0', '-y', outputName];
        if (threads > 1) cmd.unshift('-threads', threads.toString());

        console.log("[AudioExtract] Command:", cmd.join(" "));
        const ret = await instance.exec(cmd);

        if (ret !== 0) {
            const errorDetails = logBuffer.join('\n');
            throw new Error(`[AudioExtract] FFmpeg exited with code ${ret}.\nLogs:\n${errorDetails}`);
        }

        const data = await instance.readFile(outputName);

        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        const bufferContent = data instanceof Uint8Array ? data.buffer : new Uint8Array(data as any).buffer;
        const audioBuffer = await audioCtx.decodeAudioData(bufferContent as ArrayBuffer);

        return audioBuffer.getChannelData(0);

    } catch (e: any) {
        throw new Error(`[AudioExtract] Failed: ${e.message}`);
    } finally {
        if (instance) {
            try { instance.terminate(); } catch (e) { }
        }
    }
}

/**
 * Cancels a specific active conversion by Job ID.
 */
export async function cancelVideoConversion(jobId?: string) {
    const electron = getElectron();
    if (electron && jobId) {
        electron.cancelConversion(jobId);
        return;
    }

    if (jobId) {
        const job = activeJobs.get(jobId);
        if (job) {
            try {
                job.terminate();
                activeJobs.delete(jobId);
                console.log(`[Converter] Job ${jobId} terminated.`);
            } catch (e) {
                console.error("Failed to terminate FFmpeg worker", e);
            }
        }
    } else {
        for (const [id, job] of activeJobs.entries()) {
            try { job.terminate(); } catch { }
            activeJobs.delete(id);
        }
    }
}

/**
 * Converts a video file to an MP4 container.
 */
export async function convertVideoToMp4(videoFile: File, onProgress: ((progress: number) => void) | undefined, jobId: string): Promise<string> {
    const electron = getElectron();
    const filePath = (videoFile as any).path;

    // 1. ELECTRON NATIVE PATH
    if (electron && filePath) {
        console.log("[Converter] ⚡ Using Native Electron FFmpeg for Conversion:", filePath);

        let cleanup: (() => void) | undefined;

        if (onProgress) {
            cleanup = electron.onConversionProgress((data: any) => {
                if (data.jobId === jobId && typeof data.percent === 'number') {
                    onProgress(Math.round(data.percent));
                }
            });
        }

        try {
            const outputPath = await electron.convertVideo(filePath, jobId);
            // Return file:// URL for the frontend to consume/display
            return `file://${outputPath}`;
        } catch (e: any) {
            console.error("Native conversion failed:", e);
            throw new Error(`Native Conversion Failed: ${e.message}`);
        } finally {
            if (cleanup) cleanup();
        }
    }

    // 2. BROWSER WASM PATH
    console.log("[Converter] 🐢 Using Browser WASM FFmpeg for Conversion");
    let instance: FFmpeg | null = null;

    try {
        instance = await createFreshFFmpeg(onProgress);
        activeJobs.set(jobId, {
            terminate: () => { if (instance) try { instance.terminate(); } catch { } }
        });
    } catch (e: any) {
        throw new Error(`[Converter] FFmpeg Load Failed: ${e.message}`);
    }

    let totalDurationSec = 0;
    const logBuffer: string[] = [];

    const logHandler = ({ message }: { message: string }) => {
        logBuffer.push(message);
        if (logBuffer.length > 30) logBuffer.shift();

        if (message.includes('Duration:') && totalDurationSec === 0) {
            const match = message.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
            if (match) {
                const [_, h, m, s] = match;
                totalDurationSec = (parseInt(h) * 3600) + (parseInt(m) * 60) + parseFloat(s);
            }
        }
        if (message.includes('time=') && totalDurationSec > 0 && onProgress) {
            const match = message.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
            if (match) {
                const [_, h, m, s] = match;
                const currentSec = (parseInt(h) * 3600) + (parseInt(m) * 60) + parseFloat(s);
                const percent = Math.min(100, Math.round((currentSec / totalDurationSec) * 100));
                onProgress(percent);
            }
        }
    };

    instance.on('log', logHandler);

    const MOUNT_THRESHOLD = 256 * 1024 * 1024;
    const useMount = videoFile.size > MOUNT_THRESHOLD;
    const mountDir = `/data_${jobId.replace(/[^a-zA-Z0-9]/g, '')}`;

    const mountedFileName = videoFile.name.replace(/['"\s]/g, '_');
    const inputPath = useMount ? `${mountDir}/${mountedFileName}` : `input_${jobId}_${mountedFileName}`;
    const outputName = `output_${jobId}.mp4`;

    try {
        if (useMount) {
            try { await instance.createDir(mountDir); } catch { }
            // @ts-ignore
            await instance.mount('WORKERFS', { files: [new File([videoFile], mountedFileName)] }, mountDir);
        } else {
            await instance.writeFile(inputPath, await fetchFile(videoFile));
        }

        let ret = -1;
        let strategyError = "";

        // Attempt 1: Copy Stream (Fast)
        try {
            const cmdCopy = ['-i', inputPath, '-c:v', 'copy', '-c:a', 'aac', '-strict', 'experimental', '-y', outputName];
            console.log("[Converter] Attempt 1 (Fast Copy):", cmdCopy.join(" "));
            ret = await instance.exec(cmdCopy);
        } catch (e: any) {
            console.warn("Fast copy exec crashed:", e);
        }

        // Attempt 2: Re-encode (Slow)
        if (ret !== 0) {
            console.warn("[Converter] Fast copy failed. Re-encoding...");
            try {
                const cmdEncode = ['-i', inputPath, '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-y', outputName];
                ret = await instance.exec(cmdEncode);
            } catch (e: any) {
                strategyError = e.message;
            }
        }

        if (ret !== 0) {
            const logs = logBuffer.join('\n');
            throw new Error(`[Converter] Failed (Code ${ret}). ${strategyError}\nLogs:\n${logs}`);
        }

        let data;
        try {
            data = await instance.readFile(outputName);
        } catch (e: any) {
            throw new Error(`Output Read Failed: ${e.message}`);
        }

        const blob = new Blob([data as any], { type: 'video/mp4' });
        return URL.createObjectURL(blob);

    } catch (e: any) {
        throw new Error(`[Converter] Process Error: ${e.message}`);
    } finally {
        if (instance) {
            try {
                instance.off('log', logHandler);
                instance.terminate();
                console.log("[Converter] Instance terminated.");
            } catch (e) { }
        }
        activeJobs.delete(jobId);
    }
}
