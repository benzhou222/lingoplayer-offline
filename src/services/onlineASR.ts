import { SubtitleSegment, SegmentationMethod, VADSettings } from "../types";
import { GoogleGenAI, Type } from "@google/genai";
import { getChunkDefinitions, blobToBase64, encodeWAV, parseTimestamp, detectTimeScale, saveDebugZip, ChunkDefinition } from "./audioUtils";
import JSZip from "jszip";

let aiInstance: GoogleGenAI | null = null;

const getAI = (apiKey?: string) => {
    if (apiKey) return new GoogleGenAI({ apiKey });
    if (!aiInstance) {
        // @ts-ignore
        const key = typeof process !== 'undefined' ? process.env.API_KEY : '';
        if (key) aiInstance = new GoogleGenAI({ apiKey: key });
    }
    return aiInstance || new GoogleGenAI({ apiKey: '' });
};

export const generateSubtitlesOnline = async (
    audioData: Float32Array,
    apiKey: string | undefined,
    onProgress: (segments: SubtitleSegment[]) => void,
    segmentationMethod: SegmentationMethod,
    vadSettings: VADSettings,
    testMode: boolean,
    jobId: number,
    checkCancelled: () => boolean,
    onStatus?: (status: string) => void
): Promise<SubtitleSegment[]> => {
    
    if (!apiKey && (!process.env.API_KEY || process.env.API_KEY === '')) {
        throw new Error("API Key is missing. Please enter your Gemini API Key in Settings.");
    }

    if (onStatus) onStatus("Analyzing Audio Structure...");

    const SAMPLE_RATE = 16000;
    let chunksToProcess: ChunkDefinition[];

    if (testMode) {
        const batchSamples = vadSettings.batchSize * SAMPLE_RATE;
        const start = Math.max(0, audioData.length - batchSamples);
        chunksToProcess = [{ index: 0, start: start, end: audioData.length }];
        if (onStatus) onStatus(`Test Mode: Processing last raw batch...`);
    } else {
        const chunkGenerator = getChunkDefinitions(audioData, SAMPLE_RATE, segmentationMethod, vadSettings, undefined);
        chunksToProcess = Array.from(chunkGenerator);
    }

    const resultsMap: Record<number, SubtitleSegment[]> = {};
    let maxIndexFound = -1;
    const zip = testMode ? new JSZip() : null;

    const updateProgress = () => {
        let allSegments: SubtitleSegment[] = [];
        const indicesToCheck = testMode ? chunksToProcess.map(c => c.index) : Array.from({ length: maxIndexFound + 1 }, (_, i) => i);
        for (const i of indicesToCheck) {
            if (resultsMap[i]) allSegments = allSegments.concat(resultsMap[i]);
        }
        if (allSegments.length > 0) {
            allSegments.sort((a, b) => a.start - b.start);
            onProgress(allSegments.map((s, i) => ({ ...s, id: i })));
        }
    };

    const processChunk = async (chunkDef: ChunkDefinition) => {
        const chunkSamples = audioData.slice(chunkDef.start, chunkDef.end);
        const wavBuffer = encodeWAV(chunkSamples, SAMPLE_RATE);

        if (testMode && zip) {
            const startTime = (chunkDef.start / SAMPLE_RATE).toFixed(2);
            const endTime = (chunkDef.end / SAMPLE_RATE).toFixed(2);
            const fileName = `chunk_${chunkDef.index.toString().padStart(3, '0')}_${startTime}s-${endTime}s.wav`;
            zip.file(fileName, wavBuffer);
        }

        const base64Audio = await blobToBase64(new Blob([wavBuffer], { type: 'audio/wav' }));
        const timeOffset = chunkDef.start / SAMPLE_RATE;
        const actualDuration = chunkSamples.length / SAMPLE_RATE;
        const ai = getAI(apiKey);
        const prompt = `Transcribe the audio exactly. Output valid JSON array: [{ "start": float, "end": float, "text": string }]. 
Timestamps must be relative to the start of this clip (0.0). 
Include every spoken word. Do not summarize. Do not skip segments. Verbatim transcription only.`;

        let attempt = 0;
        const MAX_RETRIES = 3;

        while (attempt < MAX_RETRIES) {
            try {
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: [{ parts: [{ inlineData: { mimeType: 'audio/wav', data: base64Audio } }, { text: prompt }] }],
                    config: {
                        temperature: 0.0,
                        responseMimeType: 'application/json',
                        responseSchema: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: { start: { type: Type.NUMBER }, end: { type: Type.NUMBER }, text: { type: Type.STRING } },
                                required: ["start", "end", "text"]
                            }
                        }
                    }
                });

                if (response.text) {
                    const rawSegments = JSON.parse(response.text) as { start: number, end: number, text: string }[];
                    const scale = detectTimeScale(rawSegments, actualDuration);
                    const processedSegments = rawSegments.map(s => ({
                        id: 0,
                        start: (parseTimestamp(s.start) * scale) + timeOffset,
                        end: (parseTimestamp(s.end) * scale) + timeOffset,
                        text: s.text.trim()
                    })).filter(s => s.text.length > 0);
                    return processedSegments;
                }
                return [];
            } catch (e: any) {
                attempt++;
                if (attempt >= MAX_RETRIES) return [];
                const delay = Math.pow(2, attempt - 1) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        return [];
    };

    if (onStatus) onStatus(testMode ? "Transcribing Last Segment..." : "Transcribing Segments...");
    onProgress([]);

    const CONCURRENCY_LIMIT = 2;
    const processingIterator = chunksToProcess.values();

    const worker = async () => {
        for (const chunkDef of processingIterator) {
            if (checkCancelled()) break;
            if (chunkDef.index > maxIndexFound) maxIndexFound = chunkDef.index;
            const segs = await processChunk(chunkDef);
            resultsMap[chunkDef.index] = segs;
            updateProgress();
        }
    };

    const workers = [];
    for (let i = 0; i < CONCURRENCY_LIMIT; i++) workers.push(worker());
    await Promise.all(workers);

    if (testMode && zip) await saveDebugZip(zip);

    let finalSegments: SubtitleSegment[] = [];
    const finalIndices = testMode ? chunksToProcess.map(c => c.index) : Array.from({ length: maxIndexFound + 1 }, (_, i) => i);
    for (const i of finalIndices) {
        if (resultsMap[i]) finalSegments = finalSegments.concat(resultsMap[i]);
    }
    finalSegments.sort((a, b) => a.start - b.start);
    return finalSegments.map((s, i) => ({ ...s, id: i }));
};
