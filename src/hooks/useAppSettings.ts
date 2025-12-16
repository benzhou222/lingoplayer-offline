import { useState, useEffect } from 'react';
import { GeminiConfig, LocalASRConfig, LocalLLMConfig, SegmentationMethod, VADSettings } from '../types';
import { setLoadProgressCallback } from '../services/geminiService';

export const OFFLINE_MODELS = [
    { id: 'Xenova/whisper-base', name: 'Base (Multilingual, ~75MB)' },
    { id: 'Xenova/whisper-base.en', name: 'Base English (Balanced, ~75MB)' },
    { id: 'Xenova/whisper-small', name: 'Small (Multilingual, ~250MB)' },
    { id: 'Xenova/whisper-small.en', name: 'Small English (High Quality, ~250MB)' },
    { id: 'Xenova/whisper-medium', name: 'Medium (Very High Quality, ~1.5GB)' },
    { id: 'Xenova/whisper-medium.en', name: 'Medium English (Very High Quality, ~1.5GB)' },
    { id: 'Xenova/distil-whisper-large-v3', name: 'Distil-Large V3 (Best Accuracy, ~1.2GB)' },
];

export const useAppSettings = () => {
    // UI State
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [settingsTab, setSettingsTab] = useState<'online' | 'local'>('local');
    
    // Derived State: Offline status is now strictly determined by the settings tab
    const isOffline = settingsTab === 'local';

    // Configuration State with LocalStorage Initialization
    const [segmentationMethod, setSegmentationMethod] = useState<SegmentationMethod>(() => (localStorage.getItem('lingo_segmentation') as SegmentationMethod) || 'fixed');
    
    const [vadSettings, setVadSettings] = useState<VADSettings>(() => {
        try { return JSON.parse(localStorage.getItem('lingo_vad_settings') || '') || { batchSize: 120, minSilence: 0.4, silenceThreshold: 0.02, filteringEnabled: true }; }
        catch { return { batchSize: 120, minSilence: 0.4, silenceThreshold: 0.02, filteringEnabled: true }; }
    });

    const [syncThreshold, setSyncThreshold] = useState<number>(() => parseInt(localStorage.getItem('lingo_sync_threshold') || '3'));

    const [localLLMConfig, setLocalLLMConfig] = useState<LocalLLMConfig>(() => {
        try { return JSON.parse(localStorage.getItem('lingo_local_llm') || '') || { enabled: false, endpoint: 'http://localhost:11434', model: '' }; }
        catch { return { enabled: false, endpoint: 'http://localhost:11434', model: '' }; }
    });

    const [localASRConfig, setLocalASRConfig] = useState<LocalASRConfig>(() => {
        try { return JSON.parse(localStorage.getItem('lingo_local_asr') || '') || { enabled: false, endpoint: 'http://127.0.0.1:8080/v1/audio/transcriptions', model: 'whisper-large' }; }
        catch { return { enabled: false, endpoint: 'http://127.0.0.1:8080/v1/audio/transcriptions', model: 'whisper-large' }; }
    });

    const [geminiConfig, setGeminiConfig] = useState<GeminiConfig>(() => {
        try { return JSON.parse(localStorage.getItem('lingo_gemini_config') || '') || { apiKey: '' }; }
        catch { return { apiKey: '' }; }
    });

    // Model Management
    const [localModels, setLocalModels] = useState<string[]>([]);
    const [selectedModelId, setSelectedModelId] = useState(OFFLINE_MODELS[0].id);
    const [modelStatus, setModelStatus] = useState<'idle' | 'loading' | 'ready'>('idle');
    const [downloadProgress, setDownloadProgress] = useState<{ file: string; progress: number } | null>(null);

    // Persistence Effects
    useEffect(() => localStorage.setItem('lingo_local_llm', JSON.stringify(localLLMConfig)), [localLLMConfig]);
    useEffect(() => localStorage.setItem('lingo_local_asr', JSON.stringify(localASRConfig)), [localASRConfig]);
    useEffect(() => localStorage.setItem('lingo_gemini_config', JSON.stringify(geminiConfig)), [geminiConfig]);
    useEffect(() => localStorage.setItem('lingo_segmentation', segmentationMethod), [segmentationMethod]);
    useEffect(() => localStorage.setItem('lingo_vad_settings', JSON.stringify(vadSettings)), [vadSettings]);
    useEffect(() => localStorage.setItem('lingo_sync_threshold', syncThreshold.toString()), [syncThreshold]);

    // Model Preload Listener
    useEffect(() => {
        setLoadProgressCallback((data) => {
            if (data.status === 'progress') {
                setModelStatus('loading');
                setDownloadProgress({ file: data.file, progress: data.progress || 0 });
            } else if (data.status === 'ready') {
                setModelStatus('ready');
                setDownloadProgress(null);
            }
        });
    }, []);

    return {
        isSettingsOpen, setIsSettingsOpen,
        settingsTab, setSettingsTab,
        isOffline, // Derived
        segmentationMethod, setSegmentationMethod,
        vadSettings, setVadSettings,
        syncThreshold, setSyncThreshold,
        localLLMConfig, setLocalLLMConfig,
        localASRConfig, setLocalASRConfig,
        geminiConfig, setGeminiConfig,
        localModels, setLocalModels,
        selectedModelId, setSelectedModelId,
        modelStatus, setModelStatus,
        downloadProgress
    };
};