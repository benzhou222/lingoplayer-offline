import { SubtitleSegment, SegmentationMethod, VADSettings } from "../types";
import { getChunkDefinitions, encodeWAV, saveDebugZip, ChunkDefinition } from "./audioUtils";
import JSZip from "jszip";

// --- OFFLINE WORKER CODE ---
const WORKER_CODE = `
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

env.allowLocalModels = false;
env.useBrowserCache = true;

class PipelineFactory {
    static task = 'automatic-speech-recognition';
    static instances = {};

    static async getInstance(modelId, progress_callback = null) {
        if (!this.instances[modelId]) {
            this.instances[modelId] = await pipeline(this.task, modelId, {
                progress_callback
            });
        }
        return this.instances[modelId];
    }
}

self.onmessage = async (event) => {
    const message = event.data;

    if (message.type === 'load') {
        const { model } = message.data;
        try {
            await PipelineFactory.getInstance(model, (data) => {
                self.postMessage({ type: 'progress', data });
            });
            self.postMessage({ type: 'ready' });
        } catch (error) {
            self.postMessage({ type: 'error', data: error.message });
        }
        return;
    }

    if (message.type === 'generate') {
        const { audio, model, jobId, timeOffset: globalTimeOffset } = message.data;
        const SAMPLE_RATE = 16000;
        const CHUNK_LENGTH_S = 30;
        const CHUNK_SIZE = CHUNK_LENGTH_S * SAMPLE_RATE;
        const globalOffset = globalTimeOffset || 0;
        
        try {
            const transcriber = await PipelineFactory.getInstance(model, (data) => {
                 self.postMessage({ type: 'progress', data });
            });
            
            const totalSamples = audio.length;
            let offsetSamples = 0;
            
            while (offsetSamples < totalSamples) {
                const endSamples = Math.min(offsetSamples + CHUNK_SIZE, totalSamples);
                const chunk = audio.slice(offsetSamples, endSamples);
                const currentChunkOffset = offsetSamples / SAMPLE_RATE;
                const totalOffset = globalOffset + currentChunkOffset;
                
                const output = await transcriber(chunk, {
                    language: 'english',
                    return_timestamps: true
                });
                
                const adjustedChunks = (output.chunks || []).map((c, idx, arr) => {
                    let startRaw = c.timestamp[0];
                    if (startRaw === null) {
                        if (idx > 0 && arr[idx - 1].timestamp[1] !== null) {
                             startRaw = arr[idx - 1].timestamp[1];
                        } else {
                             if (c.timestamp[1] !== null) {
                                 startRaw = Math.max(0, c.timestamp[1] - 2.0);
                             } else {
                                 startRaw = 0;
                             }
                        }
                    }
                    const start = startRaw + totalOffset;
                    const end = (c.timestamp[1] === null ? start + 2 : c.timestamp[1]) + totalOffset;
                    return { text: c.text, timestamp: [start, end] };
                });

                self.postMessage({ type: 'partial', data: adjustedChunks, jobId });
                offsetSamples += CHUNK_SIZE;
            }
            self.postMessage({ type: 'complete', jobId });
        } catch (error) {
            self.postMessage({ type: 'error', data: error.message, jobId });
        }
    }
};
`;

let worker: Worker | null = null;
let onSubtitleProgressCallback: ((segments: SubtitleSegment[]) => void) | null = null;
let onLoadProgressCallback: ((data: any) => void) | null = null;
let accumulatedSegments: SubtitleSegment[] = [];

// This function needs to know the CURRENT activeJobId to filter events
export const initWorker = (currentActiveJobId?: number) => {
    if (!worker) {
        const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        worker = new Worker(workerUrl, { type: 'module' });

        worker.onmessage = (event) => {
            const { type, data, jobId } = event.data;

            // Filter out events from old jobs if provided
            if (currentActiveJobId !== undefined && typeof jobId === 'number' && jobId !== currentActiveJobId) {
                return;
            }

            if (type === 'progress') {
                if (onLoadProgressCallback) onLoadProgressCallback(data);
            }
            else if (type === 'ready') {
                if (onLoadProgressCallback) onLoadProgressCallback({ status: 'ready' });
            }
            else if (type === 'partial') {
                if (data && data.length > 0) {
                    console.log(`%c[Whisper Worker Return] Partial Results:`, "color: #10b981; font-weight: bold;", data);
                }
                const rawSegments = (data || []).map((chunk: any) => ({
                    id: 0,
                    start: chunk.timestamp[0],
                    end: chunk.timestamp[1],
                    text: chunk.text.trim()
                }));

                const validSegments = rawSegments.filter((s: SubtitleSegment) => {
                    if (!s.text) return false;
                    const t = s.text.toLowerCase().trim();
                    if (t === 'you' || t === 'thank you' || t === 'thanks for watching' || t.includes('subtitle by') || t === '.') return false;
                    if ((s.end - s.start) < 0.1 && t.length > 5) return false;
                    return true;
                });

                for (const seg of validSegments) {
                    const last = accumulatedSegments[accumulatedSegments.length - 1];
                    if (last) {
                        if (seg.text === last.text) continue;
                        const cleanSeg = seg.text.toLowerCase().replace(/[.,?!]/g, '').trim();
                        const cleanLast = last.text.toLowerCase().replace(/[.,?!]/g, '').trim();
                        if (cleanSeg.length > 2 && cleanLast.endsWith(cleanSeg)) continue;
                        if (seg.start < last.end) {
                            if (last.end - seg.start < 0.5) { /* fix later */ }
                            else if (seg.end <= last.end) continue;
                        }
                    }
                    if (seg.end > seg.start) accumulatedSegments.push(seg);
                }

                accumulatedSegments.sort((a, b) => a.start - b.start);
                accumulatedSegments = accumulatedSegments.map((s, i) => ({ ...s, id: i }));
                if (onSubtitleProgressCallback) onSubtitleProgressCallback(accumulatedSegments);
            }
            else if (type === 'complete') {
                accumulatedSegments.sort((a, b) => a.start - b.start);
                accumulatedSegments = accumulatedSegments.map((s, i) => ({ ...s, id: i }));
                if (onSubtitleProgressCallback) onSubtitleProgressCallback(accumulatedSegments);
            }
            else if (type === 'error') {
                console.error("[Whisper Worker] Error:", data);
                if (onLoadProgressCallback) onLoadProgressCallback({ status: 'error', error: data });
                if (!data.file && typeof data === 'string') alert("Offline AI Error: " + data);
            }
        };
    } else {
        // Update callback hook if worker already exists (legacy behavior simulation)
        // Ideally we re-bind listeners, but the singleton `onmessage` handles routing via callbacks
    }
    return worker;
};

export const preloadOfflineModel = (modelId: string) => {
    const w = initWorker();
    w.postMessage({ type: 'load', data: { model: modelId } });
};

export const setLoadProgressCallback = (cb: (data: any) => void) => {
    onLoadProgressCallback = cb;
};

export const generateSubtitlesOffline = async (
    audioData: Float32Array,
    onProgress: (segments: SubtitleSegment[]) => void,
    modelId: string,
    segmentationMethod: SegmentationMethod,
    vadSettings: VADSettings,
    testMode: boolean,
    jobId: number,
    checkCancelled: () => boolean,
    onStatus?: (status: string) => void
): Promise<SubtitleSegment[]> => {
    
    // Reset local accumulator for new run
    accumulatedSegments = [];
    
    // We pass jobId to initWorker to ensure it updates its internal filtering
    const w = initWorker(jobId);
    onSubtitleProgressCallback = onProgress;

    let chunksToProcess: ChunkDefinition[];
    const SAMPLE_RATE = 16000;

    if (testMode) {
        const batchSamples = vadSettings.batchSize * SAMPLE_RATE;
        const start = Math.max(0, audioData.length - batchSamples);
        chunksToProcess = [{ index: 0, start: start, end: audioData.length }];
        if (onStatus) onStatus("Running AI Model on Last Batch (Raw)...");
    } else {
        const chunkGenerator = getChunkDefinitions(audioData, SAMPLE_RATE, segmentationMethod, vadSettings, undefined);
        chunksToProcess = Array.from(chunkGenerator);
        if (onStatus) onStatus("Running AI Model...");
    }

    const zip = testMode ? new JSZip() : null;
    const lastChunks: { name: string; data: ArrayBuffer }[] = [];

    return new Promise(async (resolve, reject) => {
        try {
            for (const chunkDef of chunksToProcess) {
                if (checkCancelled()) {
                    console.log(`[Offline Job] Job ID ${jobId} cancelled.`);
                    break;
                }

                const chunkSamples = audioData.slice(chunkDef.start, chunkDef.end);
                const timeOffset = chunkDef.start / SAMPLE_RATE;

                if (testMode) {
                    const wavBuffer = encodeWAV(chunkSamples, SAMPLE_RATE);
                    const startTime = timeOffset.toFixed(2);
                    const endTime = (chunkDef.end / SAMPLE_RATE).toFixed(2);
                    const fileName = `chunk_${chunkDef.index.toString().padStart(3, '0')}_${startTime}s-${endTime}s.wav`;
                    lastChunks.push({ name: fileName, data: wavBuffer });
                    if (lastChunks.length > 2) lastChunks.shift();
                }

                await new Promise<void>((chunkResolve, chunkReject) => {
                    const chunkHandler = (e: MessageEvent) => {
                        if (e.data.jobId === jobId) {
                            if (e.data.type === 'complete') {
                                w.removeEventListener('message', chunkHandler);
                                chunkResolve();
                            }
                            if (e.data.type === 'error') {
                                w.removeEventListener('message', chunkHandler);
                                chunkReject(new Error(e.data.data));
                            }
                        }
                    };
                    w.addEventListener('message', chunkHandler);
                    w.postMessage({
                        type: 'generate',
                        data: { audio: chunkSamples, model: modelId, jobId, timeOffset }
                    });
                });
            }

            if (testMode && zip) {
                lastChunks.forEach(c => zip.file(c.name, c.data));
                await saveDebugZip(zip);
            }
            resolve(accumulatedSegments);
        } catch (e) {
            reject(e);
        }
    });
};
