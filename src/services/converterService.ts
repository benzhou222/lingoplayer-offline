import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// CACHE: We cache the Blob URLs of the core files so we don't fetch them every time.
let cachedCoreURL: string | null = null;
let cachedWasmURL: string | null = null;
let cachedWorkerURL: string | null = null;

// Track active jobs for cancellation. Key: jobId, Value: termination function
const activeJobs = new Map<string, { terminate: () => void }>();

async function createFreshFFmpeg(onProgress?: (progress: number) => void) {
    const instance = new FFmpeg();

    if (onProgress) onProgress(1);

    // Determine thread support
    const isMultiThreaded = window.crossOriginIsolated;

    const coreBase = isMultiThreaded
        ? 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm'
        : 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';

    if (onProgress) onProgress(5);

    try {
        // Prepare Blob URLs if not cached
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
        console.error("FFmpeg load failed:", e);
        // Fallback logic for single-threaded if multi-threaded fails
        if (isMultiThreaded) {
            console.warn("Retrying with single-threaded core...");
            const stBase = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
            try {
                // We don't cache fallback URLs to keep logic simple, just load directly
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
 * Extracts audio from a video file and converts it to a standard 16kHz Mono WAV.
 * Handles large files via WORKERFS mounting to avoid Memory OOM.
 */
export async function extractAudioAsWav(videoFile: File): Promise<Float32Array> {
    // ELECTRON NATIVE FALLBACK
    // @ts-ignore
    if (window.electron && window.electron.isElectron && (videoFile as any).path) {
        console.log("[Converter] Using Electron Native FFmpeg for audio extraction");
        // @ts-ignore
        return await window.electron.extractAudio((videoFile as any).path);
    }

    let instance: FFmpeg | null = null;

    try {
        instance = await createFreshFFmpeg();
        // Note: extractAudio is treated as a transient internal job, currently not tied to external cancellation 
        // in the same way video conversion is (which has a dedicated UI button). 
        // If we needed to cancel this, we'd need to pass a signal or ID.
    } catch (e: any) {
        throw new Error(`FFmpeg Load Error: ${e.message}`);
    }

    // Threshold: 256MB. 
    // Files smaller than this are safer/faster in MEMFS. 
    // Files larger utilize WORKERFS to avoid crashing the tab.
    const MOUNT_THRESHOLD = 256 * 1024 * 1024;
    const useMount = videoFile.size > MOUNT_THRESHOLD;

    const mountDir = '/data';
    const safeFileName = 'input_video'; // generic name avoids escaping issues
    const mountedFileName = videoFile.name.replace(/['"\s]/g, '_'); // sanitize slightly
    const inputPath = useMount ? `${mountDir}/${mountedFileName}` : safeFileName;
    const outputName = 'output.wav';

    try {
        if (useMount) {
            console.log(`[Converter] File size ${(videoFile.size / 1024 / 1024).toFixed(0)}MB > 256MB. Using WORKERFS mount.`);
            try { await instance.createDir(mountDir); } catch (e) { }

            // @ts-ignore
            await instance.mount('WORKERFS', {
                files: [new File([videoFile], mountedFileName, { type: videoFile.type })]
            }, mountDir);

        } else {
            console.log(`[Converter] File size ${(videoFile.size / 1024 / 1024).toFixed(0)}MB. Using in-memory write.`);
            await instance.writeFile(inputPath, await fetchFile(videoFile));
        }

        // Check threads
        const threads = window.crossOriginIsolated ? Math.min(navigator.hardwareConcurrency || 4, 8) : 1;
        const cmd = ['-i', inputPath, '-ar', '16000', '-ac', '1', '-map', '0:a:0', '-y', outputName];
        if (threads > 1) cmd.unshift('-threads', threads.toString());

        console.log("FFmpeg Audio Extraction Command:", cmd.join(" "));

        const ret = await instance.exec(cmd);

        if (ret !== 0) {
            throw new Error(`FFmpeg exited with code ${ret}. Input file might be corrupt or codec unsupported.`);
        }

        const data = await instance.readFile(outputName);

        // Decode to Float32Array
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        const bufferContent = data instanceof Uint8Array ? data.buffer : new Uint8Array(data as any).buffer;
        const audioBuffer = await audioCtx.decodeAudioData(bufferContent as ArrayBuffer);

        return audioBuffer.getChannelData(0);

    } catch (e: any) {
        throw new Error(`Audio Extraction Failed: ${e.message}`);
    } finally {
        // ALWAYS TERMINATE to clear memory
        if (instance) {
            try {
                instance.terminate();
            } catch (e) { console.error("Error terminating ffmpeg", e); }
        }
    }
}

/**
 * Cancels a specific active conversion by Job ID.
 */
export async function cancelVideoConversion(jobId?: string) {
    // ELECTRON
    // @ts-ignore
    if (window.electron && window.electron.isElectron) {
        // @ts-ignore
        if (window.electron.cancelConversion) {
            // @ts-ignore
            await window.electron.cancelConversion(jobId);
        }
        return;
    }

    // WEB ASSEMBLY
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
        // Fallback: Clear all (safeguard)
        for (const [id, job] of activeJobs.entries()) {
            try { job.terminate(); } catch { }
            activeJobs.delete(id);
        }
    }
}

/**
 * Converts a video file to an MP4 container compatible with browsers.
 * Uses smart mounting for large files. Supports concurrent jobs via jobId.
 */
export async function convertVideoToMp4(videoFile: File, onProgress: ((progress: number) => void) | undefined, jobId: string): Promise<string> {
    // ELECTRON NATIVE FALLBACK
    // @ts-ignore
    if (window.electron && window.electron.isElectron && (videoFile as any).path) {
        let cleanup: (() => void) | null = null;
        // Setup listener for Electron progress
        // @ts-ignore
        if (window.electron.onConversionProgress && onProgress) {
            // @ts-ignore
            cleanup = window.electron.onConversionProgress((progress: number) => {
                onProgress(progress);
            }, jobId); // Pass jobId to electron listener if supported
        }

        try {
            // @ts-ignore
            const inputPath = (videoFile as any).path;
            // Calculate output path in same directory: replace extension with .mp4
            const outputPath = inputPath.replace(/\.[^/.\\]+$/, "") + ".mp4";

            // @ts-ignore
            return await window.electron.convertVideo(inputPath, outputPath, jobId);
        } finally {
            if (cleanup) cleanup();
        }
    }

    // WEB ASSEMBLY MODE
    let instance: FFmpeg | null = null;

    try {
        instance = await createFreshFFmpeg(onProgress);

        // Register for cancellation
        activeJobs.set(jobId, {
            terminate: () => {
                if (instance) {
                    try { instance.terminate(); } catch { }
                }
            }
        });

    } catch (e: any) {
        throw new Error(`FFmpeg Engine Load Failed: ${e.message}`);
    }

    // Accurate Progress Parsing
    let totalDurationSec = 0;

    const logHandler = ({ message }: { message: string }) => {
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

    // MOUNT STRATEGY
    const MOUNT_THRESHOLD = 256 * 1024 * 1024;
    const useMount = videoFile.size > MOUNT_THRESHOLD;
    const mountDir = `/data_${jobId.replace(/[^a-zA-Z0-9]/g, '')}`; // Unique mount dir per job

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

        // Try Fast Copy first
        try {
            const cmdCopy = ['-i', inputPath, '-c:v', 'copy', '-c:a', 'aac', '-strict', 'experimental', '-y', outputName];
            console.log("Attempt 1 (Fast Copy):", cmdCopy.join(" "));
            ret = await instance.exec(cmdCopy);
        } catch (e: any) {
            console.warn("Fast copy exec crashed:", e);
        }

        if (ret !== 0) {
            console.warn("Fast copy failed. Re-encoding (this may be very slow)...");
            try {
                // Using ultrafast preset for speed
                const cmdEncode = ['-i', inputPath, '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-y', outputName];
                ret = await instance.exec(cmdEncode);
            } catch (e: any) {
                strategyError = e.message;
            }
        }

        if (ret !== 0) {
            throw new Error(`Conversion Failed (Code ${ret}). ${strategyError}`);
        }

        // Read Output
        let data;
        try {
            data = await instance.readFile(outputName);
        } catch (e: any) {
            throw new Error(`Output Read Failed: ${e.message}`);
        }

        // Success: Create Blob
        const blob = new Blob([data as any], { type: 'video/mp4' });
        return URL.createObjectURL(blob);

    } catch (e: any) {
        throw new Error(`Process Error: ${e.message}`);
    } finally {
        // CRITICAL: Terminate to free memory for next item in queue
        if (instance) {
            try {
                instance.off('log', logHandler);
                instance.terminate();
                console.log("[Converter] FFmpeg instance terminated to free memory.");
            } catch (e) { console.error("Error terminating ffmpeg", e); }
        }
        activeJobs.delete(jobId);
    }
}