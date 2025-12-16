import React, { useState } from 'react';
import { X, Settings, Server, Cloud, ListVideo, Scissors, Mic, ChevronDown, Terminal, CheckCircle2, Loader2, Download, RefreshCw } from 'lucide-react';
import { GeminiConfig, LocalASRConfig, LocalLLMConfig, SegmentationMethod, VADSettings } from '../types';
import { preloadOfflineModel, fetchLocalModels } from '../services/geminiService';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    
    // Config State
    settingsTab: 'online' | 'local';
    setSettingsTab: (tab: 'online' | 'local') => void;
    segmentationMethod: SegmentationMethod;
    setSegmentationMethod: (m: SegmentationMethod) => void;
    vadSettings: VADSettings;
    setVadSettings: React.Dispatch<React.SetStateAction<VADSettings>>;
    syncThreshold: number;
    setSyncThreshold: (val: number) => void;
    localLLMConfig: LocalLLMConfig;
    setLocalLLMConfig: React.Dispatch<React.SetStateAction<LocalLLMConfig>>;
    localASRConfig: LocalASRConfig;
    setLocalASRConfig: React.Dispatch<React.SetStateAction<LocalASRConfig>>;
    geminiConfig: GeminiConfig;
    setGeminiConfig: React.Dispatch<React.SetStateAction<GeminiConfig>>;
    
    // Model State
    modelStatus: 'idle' | 'loading' | 'ready';
    selectedModelId: string;
    setSelectedModelId: (id: string) => void;
    downloadProgress: { file: string; progress: number } | null;
    OFFLINE_MODELS: { id: string; name: string }[];
    
    // Local Utils
    localModels: string[];
    setLocalModels: (models: string[]) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
    isOpen, onClose,
    settingsTab, setSettingsTab,
    segmentationMethod, setSegmentationMethod,
    vadSettings, setVadSettings,
    syncThreshold, setSyncThreshold,
    localLLMConfig, setLocalLLMConfig,
    localASRConfig, setLocalASRConfig,
    geminiConfig, setGeminiConfig,
    modelStatus, selectedModelId, setSelectedModelId, downloadProgress, OFFLINE_MODELS,
    localModels, setLocalModels
}) => {
    const [checkingModel, setCheckingModel] = useState(false);

    if (!isOpen) return null;

    const handlePreloadModel = () => {
        preloadOfflineModel(selectedModelId);
    };

    const handleModelChange = (newModelId: string) => {
        if (newModelId !== selectedModelId) {
            setSelectedModelId(newModelId);
        }
    };

    const checkLocalConnection = async () => {
        setCheckingModel(true);
        try {
            const models = await fetchLocalModels(localLLMConfig.endpoint);
            setLocalModels(models);
            // Auto-select first if none selected
            if (!localLLMConfig.model && models.length > 0) {
                setLocalLLMConfig(p => ({ ...p, model: models[0] }));
            }
        } catch (e) {
            alert("Could not connect to Local LLM. Make sure Ollama is running and accessible (check CORS settings).");
        } finally {
            setCheckingModel(false);
        }
    };

    const applyASRPreset = (preset: string) => {
        if (preset === 'localai') {
            setLocalASRConfig(p => ({
                ...p,
                endpoint: 'http://127.0.0.1:8080/v1/audio/transcriptions',
                model: 'whisper-large',
                timeScale: 0.01
            }));
        } else if (preset === 'whispercpp') {
            setLocalASRConfig(p => ({
                ...p,
                endpoint: 'http://127.0.0.1:8080/v1/audio/transcriptions',
                model: 'whisper-1',
                timeScale: 0.01
            }));
        } else if (preset === 'fasterwhisper') {
            setLocalASRConfig(p => ({
                ...p,
                endpoint: 'http://127.0.0.1:8080/v1/audio/transcriptions',
                model: 'large-v3',
                timeScale: undefined
            }));
        }
    };

    return (
        <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md p-6 relative animate-in zoom-in-95 duration-200 overflow-y-auto max-h-[90vh]">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
                >
                    <X size={24} />
                </button>

                <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                    <Settings className="text-blue-500" />
                    Settings
                </h3>

                {/* TABS */}
                <div className="flex border-b border-gray-700 mb-6">
                    <button
                        onClick={() => setSettingsTab('local')}
                        className={`flex-1 pb-3 text-sm font-medium transition-colors border-b-2 ${settingsTab === 'local' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
                    >
                        <div className="flex items-center justify-center gap-2">
                            <Server size={16} />
                            Offline
                        </div>
                    </button>
                    <button
                        onClick={() => setSettingsTab('online')}
                        className={`flex-1 pb-3 text-sm font-medium transition-colors border-b-2 ${settingsTab === 'online' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
                    >
                        <div className="flex items-center justify-center gap-2">
                            <Cloud size={16} />
                            Online
                        </div>
                    </button>
                </div>

                {/* GLOBAL: SUBTITLE SYNC SETTINGS */}
                <div className="mb-6 border-b border-gray-800 pb-6">
                    <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2 pb-2 mb-3">
                        <ListVideo size={14} /> Subtitle Synchronization
                    </h4>
                    <div className="px-1">
                        <div className="flex justify-between items-center mb-1">
                            <label className="text-xs font-bold text-gray-500 uppercase">Lock Stability Threshold</label>
                            <span className="text-xs text-blue-400 font-mono">{syncThreshold} Frames</span>
                        </div>
                        <input
                            type="range"
                            min="1"
                            max="30"
                            step="1"
                            value={syncThreshold}
                            onChange={(e) => setSyncThreshold(parseInt(e.target.value))}
                            className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                        />
                        <p className="text-[10px] text-gray-500 mt-1">
                            Number of consecutive frames the timestamp must exceed the target start time before unlocking cursor control. Increase if you see the cursor jumping back.
                        </p>
                    </div>
                </div>

                {/* GLOBAL: AUDIO SEGMENTATION SETTINGS */}
                <div className="mb-8 border-b border-gray-800 pb-6">
                    <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2 pb-2 mb-3">
                        <Scissors size={14} /> Audio Segmentation
                    </h4>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                        <button
                            onClick={() => setSegmentationMethod('fixed')}
                            className={`flex flex-col items-center justify-center p-3 rounded-lg border text-center transition-all ${segmentationMethod === 'fixed'
                                ? 'bg-blue-900/30 border-blue-500 text-blue-300'
                                : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-750'
                                }`}
                        >
                            <span className="font-semibold text-xs mb-1">Progressive (Fixed)</span>
                            <span className="text-[10px] opacity-70">Manual splits (20s, 60s...) for faster initial load.</span>
                        </button>

                        <button
                            onClick={() => setSegmentationMethod('vad')}
                            className={`flex flex-col items-center justify-center p-3 rounded-lg border text-center transition-all ${segmentationMethod === 'vad'
                                ? 'bg-blue-900/30 border-blue-500 text-blue-300'
                                : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
                                }`}
                        >
                            <span className="font-semibold text-xs mb-1">VAD (Auto)</span>
                            <span className="text-[10px] opacity-70">Detects silence to split audio at sentence breaks.</span>
                        </button>
                    </div>

                    {/* VAD SETTINGS */}
                    {segmentationMethod === 'vad' && (
                        <div className="space-y-4 px-1">
                            <div>
                                <div className="flex justify-between items-center mb-1">
                                    <label className="text-xs font-bold text-gray-500 uppercase">Pre-split Batch Duration</label>
                                    <span className="text-xs text-blue-400 font-mono">{vadSettings.batchSize}s</span>
                                </div>
                                <input
                                    type="range"
                                    min="10"
                                    max="600"
                                    step="10"
                                    value={vadSettings.batchSize}
                                    onChange={(e) => setVadSettings(p => ({ ...p, batchSize: parseInt(e.target.value) }))}
                                    className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                                />
                                <p className="text-[10px] text-gray-500 mt-1">Processing window size. Larger = better context but slower updates.</p>
                            </div>

                            <div>
                                <div className="flex justify-between items-center mb-1">
                                    <label className="text-xs font-bold text-gray-500 uppercase">Min Silence Duration</label>
                                    <span className="text-xs text-blue-400 font-mono">{vadSettings.minSilence}s</span>
                                </div>
                                <input
                                    type="range"
                                    min="0.1"
                                    max="1.0"
                                    step="0.05"
                                    value={vadSettings.minSilence}
                                    onChange={(e) => setVadSettings(p => ({ ...p, minSilence: parseFloat(e.target.value) }))}
                                    className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                                />
                                <p className="text-[10px] text-gray-500 mt-1">Minimum silence required to trigger a split.</p>
                            </div>

                            <div>
                                <div className="flex justify-between items-center mb-1">
                                    <label className="text-xs font-bold text-gray-500 uppercase">Silence Threshold</label>
                                    <span className="text-xs text-blue-400 font-mono">{vadSettings.silenceThreshold}</span>
                                </div>
                                <input
                                    type="range"
                                    min="0.001"
                                    max="0.05"
                                    step="0.001"
                                    value={vadSettings.silenceThreshold}
                                    onChange={(e) => setVadSettings(p => ({ ...p, silenceThreshold: parseFloat(e.target.value) }))}
                                    className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                                />
                                <p className="text-[10px] text-gray-500 mt-1">Sensitivity. Lower = cleaner audio needed. Higher = tolerates noise.</p>
                            </div>

                            {/* Filtering Toggle */}
                            <div className="flex items-center justify-between pt-2 border-t border-gray-800 mt-2">
                                <div>
                                    <div className="text-xs font-bold text-gray-500 uppercase">Vocal Filtering</div>
                                    <p className="text-[10px] text-gray-500">Band-pass filter (150-3000Hz) to isolate voice.</p>
                                </div>
                                <button
                                    onClick={() => setVadSettings(p => ({ ...p, filteringEnabled: !p.filteringEnabled }))}
                                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${vadSettings.filteringEnabled ? 'bg-blue-600' : 'bg-gray-700'}`}
                                >
                                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${vadSettings.filteringEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* TAB CONTENT: LOCAL */}
                {settingsTab === 'local' && (
                    <div className="space-y-8">

                        {/* 1. WHISPER ASR SECTION */}
                        <div className="space-y-4">
                            <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2 pb-2 border-b border-gray-800">
                                <Mic size={14} /> Speech-to-Text (Whisper)
                            </h4>

                            {/* Enable Toggle for Local Server */}
                            <div className="flex items-center justify-between p-3 bg-gray-800/30 rounded-lg border border-gray-800">
                                <div className="flex flex-col">
                                    <span className="font-medium text-gray-200 text-sm">Use Local Whisper Server</span>
                                    <span className="text-[10px] text-gray-500">Connect to local server (e.g. Whisper.cpp)</span>
                                </div>
                                <button
                                    onClick={() => setLocalASRConfig(p => ({ ...p, enabled: !p.enabled }))}
                                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${localASRConfig.enabled ? 'bg-blue-600' : 'bg-gray-600'}`}
                                >
                                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${localASRConfig.enabled ? 'translate-x-5' : 'translate-x-1'}`} />
                                </button>
                            </div>

                            {/* Configuration for Local Server */}
                            <div className={`transition-opacity duration-200 ${localASRConfig.enabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                                <div className="mb-4">
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Server Presets</label>
                                    <div className="relative">
                                        <select
                                            onChange={(e) => applyASRPreset(e.target.value)}
                                            className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:border-blue-500 outline-none appearance-none cursor-pointer"
                                            defaultValue=""
                                        >
                                            <option value="" disabled>Select a server type...</option>
                                            <option value="fasterwhisper">Faster-Whisper-Server (Port 8080) - Recommended for VAD</option>
                                            <option value="whispercpp">Whisper.cpp Server (Port 8080) - Lightweight</option>
                                            <option value="localai">LocalAI (Port 8080) - General Purpose</option>
                                        </select>
                                        <ChevronDown size={14} className="absolute right-3 top-3 text-gray-500 pointer-events-none" />
                                    </div>
                                    <p className="text-[10px] text-blue-400 mt-2">
                                        Tip: "Faster-Whisper-Server" includes VAD to automatically remove silence.
                                    </p>
                                </div>

                                <div className="mb-3">
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">API Endpoint</label>
                                    <input
                                        type="text"
                                        value={localASRConfig.endpoint}
                                        onChange={(e) => setLocalASRConfig(p => ({ ...p, endpoint: e.target.value }))}
                                        className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:border-blue-500 outline-none transition-all placeholder-gray-700"
                                        placeholder="http://127.0.0.1:8080/v1/audio/transcriptions"
                                    />
                                    <p className="text-[10px] text-gray-500 mt-2">
                                        Supports OpenAI-compatible endpoints (e.g. /v1/audio/transcriptions).
                                    </p>
                                </div>

                                <div className="mb-3">
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Model Name</label>
                                    <input
                                        type="text"
                                        value={localASRConfig.model}
                                        onChange={(e) => setLocalASRConfig(p => ({ ...p, model: e.target.value }))}
                                        className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:border-blue-500 outline-none transition-all placeholder-gray-700"
                                        placeholder="whisper-large"
                                    />
                                    <p className="text-[10px] text-gray-500 mt-2">
                                        Server-side model identifier (e.g. large-v3).
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Timestamp Time Scale</label>
                                    <div className="relative">
                                        <select
                                            value={localASRConfig.timeScale ?? 0}
                                            onChange={(e) => {
                                                const val = parseFloat(e.target.value);
                                                setLocalASRConfig(p => ({ ...p, timeScale: val === 0 ? undefined : val }))
                                            }}
                                            className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:border-blue-500 outline-none appearance-none cursor-pointer"
                                        >
                                            <option value={0}>Auto Detect (Default)</option>
                                            <option value={1.0}>Seconds (1.0s)</option>
                                            <option value={0.01}>Centiseconds (0.01s) - Whisper.cpp / LocalAI</option>
                                            <option value={0.001}>Milliseconds (0.001s)</option>
                                        </select>
                                        <ChevronDown size={14} className="absolute right-3 top-3 text-gray-500 pointer-events-none" />
                                    </div>
                                    <p className="text-[10px] text-gray-500 mt-2">
                                        Manually override if timestamps are incorrect.
                                    </p>
                                </div>

                                {/* HELP: DOCKER COMMAND FOR FASTER WHISPER */}
                                {localASRConfig.endpoint.includes('8080') && localASRConfig.model === 'large-v3' && (
                                    <div className="mt-4 p-3 bg-gray-950 rounded border border-gray-800 text-xs font-mono text-gray-400 overflow-x-auto">
                                        <div className="flex items-center gap-2 text-gray-500 font-sans font-bold mb-2">
                                            <Terminal size={12} />
                                            <span>Run in Docker (NVIDIA GPU):</span>
                                        </div>
                                        <code className="whitespace-pre select-all text-[10px] text-green-500/80 block">
                                            {`docker run --gpus all -d -p 8080:8000 \\
-v faster_whisper_cache:/root/.cache/huggingface \\
--name faster-whisper \\
-e WHISPER_MODEL=large-v3 \\
-e WHISPER_VAD_FILTER=true \\
-e WHISPER_VAD_PARAMETERS='{"min_silence_duration_ms": 500}' \\
-e ALLOW_ORIGINS='["*"]' \\
fedirz/faster-whisper-server:latest-cuda`}
                                        </code>
                                        <div className="mt-2 text-gray-600 italic">
                                            Note: Maps host port 8080 to container 8000.
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* BROWSER MODEL MANAGER (Visible if Local Server is DISABLED) */}
                            {!localASRConfig.enabled && (
                                <div className="mt-4 p-4 bg-gray-800/50 rounded-lg border border-gray-700">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex flex-col">
                                            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">In-Browser Model</span>
                                            <span className="text-[10px] text-gray-500">Runs locally in browser via WebAssembly</span>
                                        </div>
                                        {modelStatus === 'ready' && <CheckCircle2 size={16} className="text-green-500" />}
                                    </div>

                                    <div className="mb-3 relative">
                                        <select
                                            value={selectedModelId}
                                            onChange={(e) => handleModelChange(e.target.value)}
                                            className="w-full bg-black text-gray-200 text-xs border border-gray-700 rounded px-2 py-2 appearance-none focus:outline-none focus:border-blue-500 cursor-pointer"
                                            disabled={modelStatus === 'loading'}
                                        >
                                            {OFFLINE_MODELS.map(model => (
                                                <option key={model.id} value={model.id}>{model.name}</option>
                                            ))}
                                        </select>
                                        <ChevronDown size={14} className="absolute right-3 top-3 text-gray-500 pointer-events-none" />
                                    </div>

                                    {modelStatus === 'idle' && (
                                        <button
                                            onClick={handlePreloadModel}
                                            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-xs py-2 rounded transition-colors font-medium shadow-lg shadow-blue-900/20"
                                        >
                                            <Download size={14} />
                                            <span>Download & Load Model</span>
                                        </button>
                                    )}

                                    {modelStatus === 'loading' && (
                                        <div className="space-y-2 bg-black/50 p-2 rounded border border-gray-800">
                                            <div className="flex items-center gap-2 text-xs text-blue-400">
                                                <Loader2 size={12} className="animate-spin" />
                                                <span>{downloadProgress ? `Downloading... ${Math.round(downloadProgress.progress)}%` : 'Initializing...'}</span>
                                            </div>
                                            {downloadProgress && (
                                                <div className="h-1.5 w-full bg-gray-700 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-blue-500 transition-all duration-300"
                                                        style={{ width: `${downloadProgress.progress}%` }}
                                                    />
                                                </div>
                                            )}
                                            <div className="text-[10px] text-gray-500 truncate" title={downloadProgress?.file}>
                                                {downloadProgress?.file || "Preparing environment..."}
                                            </div>
                                        </div>
                                    )}

                                    {modelStatus === 'ready' && (
                                        <div className="text-xs text-gray-400 flex items-center gap-2">
                                            <CheckCircle2 size={12} className="text-green-500" />
                                            Model cached and ready for use.
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>


                        {/* 2. OLLAMA LLM SECTION */}
                        <div className="space-y-4">
                            <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2 pb-2 border-b border-gray-800">
                                <Server size={14} /> Text Generation (Ollama)
                            </h4>

                            {/* Enable Toggle */}
                            <div className="flex items-center justify-between p-3 bg-gray-800/30 rounded-lg border border-gray-800">
                                <div className="flex flex-col">
                                    <span className="font-medium text-gray-200 text-sm">Use Local Ollama</span>
                                    <span className="text-[10px] text-gray-500">Use local LLM for word definitions</span>
                                </div>
                                <button
                                    onClick={() => setLocalLLMConfig(p => ({ ...p, enabled: !p.enabled }))}
                                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${localLLMConfig.enabled ? 'bg-blue-600' : 'bg-gray-600'}`}
                                >
                                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${localLLMConfig.enabled ? 'translate-x-5' : 'translate-x-1'}`} />
                                </button>
                            </div>

                            {/* Configuration Fields */}
                            <div className={`space-y-4 transition-opacity duration-200 ${localLLMConfig.enabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Endpoint URL</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={localLLMConfig.endpoint}
                                            onChange={(e) => setLocalLLMConfig(p => ({ ...p, endpoint: e.target.value }))}
                                            className="flex-1 bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:border-blue-500 outline-none transition-all placeholder-gray-700"
                                            placeholder="http://localhost:11434"
                                        />
                                        <button
                                            onClick={checkLocalConnection}
                                            disabled={checkingModel}
                                            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700 text-gray-300 transition-colors disabled:opacity-50"
                                            title="Check Connection & Fetch Models"
                                        >
                                            {checkingModel ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
                                        </button>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Model Name</label>
                                    {localModels.length > 0 ? (
                                        <div className="relative">
                                            <select
                                                value={localLLMConfig.model}
                                                onChange={(e) => setLocalLLMConfig(p => ({ ...p, model: e.target.value }))}
                                                className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:border-blue-500 outline-none appearance-none cursor-pointer"
                                            >
                                                <option value="">Select a model...</option>
                                                {localModels.map(m => <option key={m} value={m}>{m}</option>)}
                                            </select>
                                            <ChevronDown size={14} className="absolute right-3 top-3 text-gray-500 pointer-events-none" />
                                        </div>
                                    ) : (
                                        <input
                                            type="text"
                                            value={localLLMConfig.model}
                                            onChange={(e) => setLocalLLMConfig(p => ({ ...p, model: e.target.value }))}
                                            className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:border-blue-500 outline-none placeholder-gray-700"
                                            placeholder="e.g. llama3, mistral"
                                        />
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* TAB CONTENT: ONLINE */}
                {settingsTab === 'online' && (
                    <div className="space-y-6">
                        <div className="bg-blue-900/10 border border-blue-900/30 rounded-lg p-4 mb-4">
                            <p className="text-xs text-blue-300">
                                Enter your Google Gemini API Key to use cloud-based transcription and definitions.
                                This key is stored locally in your browser.
                            </p>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Gemini API Key</label>
                            <input
                                type="password"
                                value={geminiConfig.apiKey}
                                onChange={(e) => setGeminiConfig(p => ({ ...p, apiKey: e.target.value }))}
                                className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:border-blue-500 outline-none transition-all placeholder-gray-700"
                                placeholder="AIzaSy..."
                            />
                            <p className="text-[10px] text-gray-500 mt-2">
                                Leave blank to attempt using the built-in demo key (if configured in environment).
                            </p>
                        </div>
                    </div>
                )}

                <div className="mt-8 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors shadow-lg shadow-blue-900/20"
                    >
                        Save & Close
                    </button>
                </div>
            </div>
        </div>
    );
};