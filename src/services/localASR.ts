import { SubtitleSegment, LocalASRConfig, SegmentationMethod, VADSettings } from "../types";
import { getChunkDefinitions, encodeWAV, saveDebugZip, detectTimeScale, parseTimestamp, ChunkDefinition } from "./audioUtils";
import JSZip from "jszip";

export const testLocalWhisperConnection = async (endpoint: string): Promise<boolean> => {
    try {
        await fetch(endpoint, { method: 'OPTIONS', credentials: 'omit' });
        return true;
    } catch (e: any) {
        try {
            await fetch(endpoint, { method: 'GET', mode: 'no-cors' });
            return true;
        } catch {
            return false;
        }
    }
};

export const generateSubtitlesLocalServer = async (
    audioData: Float32Array,
    onProgress: (segments: SubtitleSegment[]) => void,
    config: LocalASRConfig,
    segmentationMethod: SegmentationMethod,
    vadSettings: VADSettings,
    testMode: boolean,
    jobId: number,
    checkCancelled: () => boolean
): Promise<SubtitleSegment[]> => {
    const SAMPLE_RATE = 16000;
    let chunksToProcess: ChunkDefinition[];

    if (testMode) {
        const batchSamples = vadSettings.batchSize * SAMPLE_RATE;
        const start = Math.max(0, audioData.length - batchSamples);
        chunksToProcess = [{ index: 0, start: start, end: audioData.length }];
        console.log(`%c[Test VAD] Processing Last Raw Batch: ${start / SAMPLE_RATE}s - ${audioData.length / SAMPLE_RATE}s`, "color: orange; font-weight: bold;");
    } else {
        const chunkGenerator = getChunkDefinitions(audioData, SAMPLE_RATE, segmentationMethod, vadSettings, undefined);
        chunksToProcess = Array.from(chunkGenerator);
    }

    let allSegments: SubtitleSegment[] = [];
    const zip = testMode ? new JSZip() : null;
    const lastChunks: { name: string; data: ArrayBuffer }[] = [];

    for (const chunkDef of chunksToProcess) {
        if (checkCancelled()) break;

        const chunkSamples = audioData.slice(chunkDef.start, chunkDef.end);
        const chunkStartTime = chunkDef.start / SAMPLE_RATE;
        const chunkDuration = chunkSamples.length / SAMPLE_RATE;
        const wavBuffer = encodeWAV(chunkSamples, SAMPLE_RATE);

        if (testMode) {
            const startTime = chunkStartTime.toFixed(2);
            const endTime = (chunkDef.end / SAMPLE_RATE).toFixed(2);
            const fileName = `chunk_${chunkDef.index.toString().padStart(3, '0')}_${startTime}s-${endTime}s.wav`;
            lastChunks.push({ name: fileName, data: wavBuffer });
            if (lastChunks.length > 2) lastChunks.shift();
        }

        const audioBlob = new Blob([wavBuffer], { type: 'audio/wav' });
        const file = new File([audioBlob], "chunk.wav", { type: "audio/wav" });
        const formData = new FormData();
        formData.append('file', file);
        formData.append('model', config.model || 'whisper-1');
        formData.append('response_format', 'verbose_json');

        try {
            const response = await fetch(config.endpoint, { method: 'POST', body: formData });
            if (response.ok) {
                const data = await response.json();
                console.log(`%c[Local Whisper Return] Chunk #${chunkDef.index} Data:`, "color: #10b981; font-weight: bold;", data);

                let rawSegments: any[] = [];
                if (data.segments && Array.isArray(data.segments)) rawSegments = data.segments;
                else if (Array.isArray(data)) rawSegments = data;
                else if (data.text) rawSegments = [{ start: 0, end: chunkDuration, text: data.text }];

                if (rawSegments.length > 0) {
                    const scale = config.timeScale || detectTimeScale(rawSegments, chunkDuration);
                    const chunkSegments: SubtitleSegment[] = rawSegments.map((s: any) => {
                        const startRaw = parseTimestamp(s.start);
                        const endRaw = parseTimestamp(s.end);
                        return {
                            id: 0,
                            start: (startRaw * scale) + chunkStartTime,
                            end: (endRaw * scale) + chunkStartTime,
                            text: s.text?.trim() || ""
                        };
                    }).filter(s => s.text.length > 0);

                    for (const seg of chunkSegments) {
                        const last = allSegments[allSegments.length - 1];
                        if (last) {
                            if (seg.text === last.text) continue;
                            const cleanSeg = seg.text.toLowerCase().trim();
                            const cleanLast = last.text.toLowerCase().trim();
                            if (cleanSeg.length > 3 && cleanLast.endsWith(cleanSeg)) continue;
                        }
                        if (seg.end > seg.start) allSegments.push(seg);
                    }
                    allSegments.sort((a, b) => a.start - b.start);
                    onProgress(allSegments.map((s, i) => ({ ...s, id: i })));
                }
            }
        } catch (e) { }
    }

    if (testMode && zip) {
        lastChunks.forEach(c => zip.file(c.name, c.data));
        await saveDebugZip(zip);
    }

    return allSegments.map((s, i) => ({ ...s, id: i }));
};
