import { extractAudioAsWav } from "./converterService";
import { SegmentationMethod, VADSettings, SubtitleSegment } from "../types";
import JSZip from "jszip";

export interface ChunkDefinition {
    index: number;
    start: number;
    end: number;
}

// --- AUDIO DECODING & ENCODING ---

export const getAudioData = async (videoFile: File, forOffline: boolean): Promise<Float32Array | string> => {
    try {
        const targetSampleRate = 16000;
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: targetSampleRate });

        const processDecodedBuffer = async (decoded: AudioBuffer) => {
            let monoData: Float32Array;
            if (decoded.numberOfChannels > 1) {
                const offlineCtx = new OfflineAudioContext(1, decoded.length, targetSampleRate);
                const source = offlineCtx.createBufferSource();
                source.buffer = decoded;
                source.connect(offlineCtx.destination);
                source.start();
                const renderedBuffer = await offlineCtx.startRendering();
                monoData = renderedBuffer.getChannelData(0);
            } else {
                monoData = decoded.getChannelData(0);
            }

            if (forOffline) {
                return monoData;
            } else {
                const wavBuffer = encodeWAV(monoData, targetSampleRate);
                return blobToBase64(new Blob([wavBuffer], { type: 'audio/wav' }));
            }
        };

        // @ts-ignore
        if (window.electron && window.electron.isElectron && (videoFile as any).path) {
            console.log("[AudioData] Electron detected. Using Native FFmpeg.");
            const pcmData = await extractAudioAsWav(videoFile);
            if (forOffline) {
                return pcmData;
            } else {
                const wavBuffer = encodeWAV(pcmData, targetSampleRate);
                return blobToBase64(new Blob([wavBuffer], { type: 'audio/wav' }));
            }
        }

        try {
            const arrayBuffer = await videoFile.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            return await processDecodedBuffer(audioBuffer);
        } catch (nativeError: any) {
            console.warn("Native browser decoding failed. Switching to FFmpeg fallback.", nativeError);
            const pcmData = await extractAudioAsWav(videoFile);
            if (forOffline) {
                return pcmData;
            } else {
                const wavBuffer = encodeWAV(pcmData, targetSampleRate);
                return blobToBase64(new Blob([wavBuffer], { type: 'audio/wav' }));
            }
        }
    } catch (e: any) {
        throw e;
    }
};

export function encodeWAV(samples: Float32Array, sampleRate: number) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeString = (view: DataView, offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
    };

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, samples.length * 2, true);

    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return buffer;
}

export function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64String = (reader.result as string).split(',')[1];
            resolve(base64String);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

export async function saveDebugZip(zip: JSZip) {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `lingoplayer_vad_debug_${timestamp}.zip`;
        const blob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        console.log(`[Debug] ZIP Saved: ${filename}`);
    } catch (e) {
        console.error("Failed to save debug zip", e);
    }
}

// --- TIMESTAMP UTILS ---

export function parseTimestamp(val: any): number {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
        const v = val.trim();
        if (!v) return 0;
        const normalized = v.replace(',', '.');
        if (normalized.includes(':')) {
            const parts = normalized.split(':');
            let seconds = 0;
            if (parts.length === 3) {
                seconds = parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
            } else if (parts.length === 2) {
                seconds = parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
            } else {
                seconds = parseFloat(parts[parts.length - 1]);
            }
            return isNaN(seconds) ? 0 : seconds;
        }
        const num = parseFloat(normalized);
        return isNaN(num) ? 0 : num;
    }
    return 0;
}

export function detectTimeScale(segments: any[], chunkDuration: number): number {
    const parsed = segments.map(s => {
        const start = parseTimestamp(s.start);
        const end = parseTimestamp(s.end);
        return { start, end, dur: end - start };
    }).filter(s => s.end > s.start && s.dur > 0);

    if (parsed.length === 0) return 1.0;
    const avgDur = parsed.reduce((sum, s) => sum + s.dur, 0) / parsed.length;
    const maxEnd = Math.max(...parsed.map(s => s.end));
    const candidates = [1.0, 0.01, 0.001];

    const validCandidates = candidates.filter(scale => {
        const scaledAvg = avgDur * scale;
        const scaledMax = maxEnd * scale;
        const isDurationReasonable = scaledAvg >= 0.1 && scaledAvg <= 60.0;
        const fitsInChunk = scaledMax <= (chunkDuration * 1.5);
        return isDurationReasonable && fitsInChunk;
    });

    if (validCandidates.length === 1) return validCandidates[0];

    if (validCandidates.length > 1) {
        return validCandidates.sort((a, b) => {
            const valA = avgDur * a;
            const valB = avgDur * b;
            const logA = Math.log(Math.max(0.0001, valA));
            const logB = Math.log(Math.max(0.0001, valB));
            const target = Math.log(3.0);
            return Math.abs(logA - target) - Math.abs(logB - target);
        })[0];
    }

    return candidates.sort((a, b) => {
        return Math.abs((maxEnd * a) - chunkDuration) - Math.abs((maxEnd * b) - chunkDuration);
    })[0];
}

// --- VAD & CHUNKING ---

const calculateRMS = (buffer: Float32Array): number => {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
    return Math.sqrt(sum / buffer.length);
};

const applyVocalFilter = (audio: Float32Array, sampleRate: number): Float32Array => {
    const filtered = new Float32Array(audio.length);
    const dt = 1 / sampleRate;
    const rc_hp = 1 / (2 * Math.PI * 60);
    const alpha_hp = rc_hp / (rc_hp + dt);
    const rc_lp = 1 / (2 * Math.PI * 6000);
    const alpha_lp = dt / (rc_lp + dt);

    let lastIn = 0, lastOutHp = 0, lastOutLp = 0;
    for (let i = 0; i < audio.length; i++) {
        const hp = alpha_hp * (lastOutHp + audio[i] - lastIn);
        lastIn = audio[i];
        lastOutHp = hp;
        const lp = lastOutLp + alpha_lp * (hp - lastOutLp);
        filtered[i] = lp;
        lastOutLp = lp;
    }
    return filtered;
};

const scanForSplitPoints = (audio: Float32Array, sampleRate: number, minSilenceSec: number, threshold: number): number[] => {
    const splitPoints: number[] = [];
    const windowSize = Math.floor(sampleRate * 0.05);
    const minSilenceSamples = minSilenceSec * sampleRate;
    let currentSilenceSamples = 0;
    let silenceStartIndex = -1;

    for (let i = 0; i < audio.length; i += windowSize) {
        const end = Math.min(i + windowSize, audio.length);
        const window = audio.subarray(i, end);
        const rms = calculateRMS(window);

        if (rms < threshold) {
            if (currentSilenceSamples === 0) silenceStartIndex = i;
            currentSilenceSamples += (end - i);
        } else {
            if (currentSilenceSamples >= minSilenceSamples) {
                splitPoints.push(silenceStartIndex + Math.floor(currentSilenceSamples / 2));
            }
            currentSilenceSamples = 0;
            silenceStartIndex = -1;
        }
    }
    if (currentSilenceSamples >= minSilenceSamples) {
        splitPoints.push(silenceStartIndex + Math.floor(currentSilenceSamples / 2));
    }
    return splitPoints;
};

function* getVADChunks(
    audioData: Float32Array, sampleRate: number, batchSizeSec: number, 
    minSilenceSec: number, silenceThreshold: number, filteringEnabled: boolean, limitSec?: number
): Generator<ChunkDefinition> {
    const BATCH_SAMPLES = batchSizeSec * sampleRate;
    let filePointer = 0;
    let globalIndex = 0;
    let buffer: Float32Array = new Float32Array(0);
    let bufferGlobalStart = 0;

    while (filePointer < audioData.length) {
        if (limitSec !== undefined && (filePointer / sampleRate) >= limitSec) break;

        const batchEnd = Math.min(filePointer + BATCH_SAMPLES, audioData.length);
        const newBatch = audioData.slice(filePointer, batchEnd);
        const combined = new Float32Array(buffer.length + newBatch.length);
        combined.set(buffer);
        combined.set(newBatch, buffer.length);
        buffer = combined;

        let analysisBuffer = buffer;
        if (filteringEnabled) analysisBuffer = applyVocalFilter(buffer, sampleRate);

        const splitIndices = scanForSplitPoints(analysisBuffer, sampleRate, minSilenceSec, silenceThreshold);
        let lastSplitLocal = 0;

        for (const splitPoint of splitIndices) {
            const dur = (splitPoint - lastSplitLocal) / sampleRate;
            if (dur > 0.2) {
                yield {
                    index: globalIndex++,
                    start: bufferGlobalStart + lastSplitLocal,
                    end: bufferGlobalStart + splitPoint
                };
            }
            lastSplitLocal = splitPoint;
        }

        const isEOF = batchEnd >= audioData.length;
        const isLimitReached = limitSec !== undefined && (batchEnd / sampleRate) >= limitSec;
        const leftoverSamples = buffer.length - lastSplitLocal;

        if (isEOF || isLimitReached) {
            if (leftoverSamples > 0) {
                yield { index: globalIndex++, start: bufferGlobalStart + lastSplitLocal, end: bufferGlobalStart + buffer.length };
            }
            buffer = new Float32Array(0);
        } else {
            const MAX_BUFFER_SAMPLES = BATCH_SAMPLES * 3;
            if (leftoverSamples > MAX_BUFFER_SAMPLES) {
                yield { index: globalIndex++, start: bufferGlobalStart + lastSplitLocal, end: bufferGlobalStart + buffer.length };
                buffer = new Float32Array(0);
                bufferGlobalStart = batchEnd;
            } else {
                buffer = buffer.slice(lastSplitLocal);
                bufferGlobalStart = bufferGlobalStart + lastSplitLocal;
            }
        }
        filePointer = batchEnd;
        if (isLimitReached) break;
    }
}

function* getFixedChunks(audioData: Float32Array, sampleRate: number, limitSec?: number): Generator<ChunkDefinition> {
    const CHUNK_SCHEDULE_ENDS = [20, 60, 180];
    const STANDARD_CHUNK_DURATION = 180;
    const totalSamples = audioData.length;
    let currentSampleOffset = 0;
    let scheduleIndex = 0;
    let globalIndex = 0;

    while (currentSampleOffset < totalSamples) {
        if (limitSec !== undefined && (currentSampleOffset / sampleRate) >= limitSec) break;
        let chunkEndSamples;
        if (scheduleIndex < CHUNK_SCHEDULE_ENDS.length) {
            const endSeconds = CHUNK_SCHEDULE_ENDS[scheduleIndex];
            chunkEndSamples = Math.floor(endSeconds * sampleRate);
            if (chunkEndSamples <= currentSampleOffset) chunkEndSamples = currentSampleOffset + (STANDARD_CHUNK_DURATION * sampleRate);
        } else {
            chunkEndSamples = currentSampleOffset + (STANDARD_CHUNK_DURATION * sampleRate);
        }
        chunkEndSamples = Math.min(chunkEndSamples, totalSamples);
        if (chunkEndSamples <= currentSampleOffset) break;

        yield { index: globalIndex++, start: currentSampleOffset, end: chunkEndSamples };
        currentSampleOffset = chunkEndSamples;
        scheduleIndex++;
    }
}

export const getChunkDefinitions = (
    audioData: Float32Array, sampleRate: number, method: SegmentationMethod, 
    vadSettings: VADSettings, limitSec?: number
): Generator<ChunkDefinition> => {
    if (method === 'vad') {
        return getVADChunks(audioData, sampleRate, vadSettings.batchSize, vadSettings.minSilence, vadSettings.silenceThreshold, vadSettings.filteringEnabled, limitSec);
    }
    return getFixedChunks(audioData, sampleRate, limitSec);
};
