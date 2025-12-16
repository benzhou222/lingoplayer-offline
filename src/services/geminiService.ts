import { SubtitleSegment, LocalASRConfig, SegmentationMethod, VADSettings } from "../types";
import { getAudioData } from "./audioUtils";
import { generateSubtitlesOffline, preloadOfflineModel, setLoadProgressCallback } from "./offlineASR";
import { generateSubtitlesOnline } from "./onlineASR";
import { generateSubtitlesLocalServer, testLocalWhisperConnection } from "./localASR";
import { getWordDefinition, playAudio, fetchLocalModels } from "./dictionaryService";

// --- EXPORTS ---
// Re-export utility functions so the rest of the app doesn't break
export { 
    getAudioData, 
    preloadOfflineModel, 
    setLoadProgressCallback, 
    getWordDefinition, 
    playAudio, 
    fetchLocalModels, 
    testLocalWhisperConnection 
};

// --- ORCHESTRATOR STATE ---
let activeJobId = 0;

export const cancelSubtitleGeneration = () => {
    activeJobId++;
    console.log(`[Orchestrator] Cancelled previous job. New Job ID: ${activeJobId + 1}`);
};

// --- ORCHESTRATOR FUNCTION ---
export const generateSubtitles = async (
    videoFile: File,
    onProgress: (segments: SubtitleSegment[]) => void,
    isOffline: boolean,
    modelId: string,
    apiKey: string,
    localASRConfig: LocalASRConfig,
    segmentationMethod: SegmentationMethod,
    vadSettings: VADSettings,
    testMode: boolean = false,
    cachedAudioData?: Float32Array,
    onStatus?: (status: string) => void
): Promise<SubtitleSegment[]> => {

    // Start new job
    activeJobId++;
    const currentJobId = activeJobId;
    
    // Cancellation Check Closure
    const checkCancelled = () => currentJobId !== activeJobId;

    console.clear();
    console.log("%c[System] Logs cleared. Starting generation...", "color: #a78bfa; font-weight: bold;");

    // 1. Prepare Audio Data (Shared step)
    let audioData: Float32Array;
    
    if (cachedAudioData) {
        audioData = cachedAudioData;
    } else {
        // If online mode, we handle audio differently inside the online function (it converts to wav there), 
        // BUT for consistency and VAD support, we generally need the PCM data first anyway.
        // For online mode, getAudioData(..., true) gets us the raw Float32Array which is flexible.
        if (onStatus) onStatus("Decoding Audio (Full File)...");
        
        // Note: For 'Online' mode, we also get raw data now so we can perform VAD locally before sending chunks
        const data = await getAudioData(videoFile, true); 
        
        if (typeof data === 'string') throw new Error("Received string data unexpectedly.");
        audioData = data;
    }

    if (checkCancelled()) return [];

    // 2. Route to specific service
    if (isOffline) {
        if (localASRConfig.enabled) {
            if (onStatus) onStatus("Connecting to Local Whisper Server...");
            return await generateSubtitlesLocalServer(
                audioData, 
                onProgress, 
                localASRConfig, 
                segmentationMethod, 
                vadSettings, 
                testMode, 
                currentJobId,
                checkCancelled
            );
        } else {
            // Browser In-Memory Whisper
            return await generateSubtitlesOffline(
                audioData, 
                onProgress, 
                modelId, 
                segmentationMethod, 
                vadSettings, 
                testMode, 
                currentJobId,
                checkCancelled,
                onStatus
            );
        }
    } else {
        // Online Gemini
        return await generateSubtitlesOnline(
            audioData, 
            apiKey, 
            onProgress, 
            segmentationMethod, 
            vadSettings, 
            testMode, 
            currentJobId,
            checkCancelled,
            onStatus
        );
    }
};
