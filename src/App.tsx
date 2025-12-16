import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, BookOpen, Settings, GripHorizontal, LayoutList, AlertCircle, Trash2, Download, FileUp } from 'lucide-react';
import { SubtitleSegment, WordDefinition, VocabularyItem, PlaybackMode } from './types';
import { generateSubtitles, getWordDefinition, getAudioData, cancelSubtitleGeneration } from './services/geminiService';
import { convertVideoToMp4, cancelVideoConversion } from './services/converterService';
import { segmentsToSRT, segmentsToVTT, parseSubtitleFile, parseSubtitleContent } from './utils/subtitleUtils';
import { saveFullPlaylistToDB, loadFullPlaylistFromDB } from './utils/storageUtils';

// Components
import { VideoControls } from './components/VideoControls';
import { WordDefinitionPanel } from './components/WordDefinitionPanel';
import { SettingsModal } from './components/SettingsModal';
import { VideoPlaylist } from './components/VideoPlaylist';
import { SubtitlePanel } from './components/SubtitlePanel';

// Hooks
import { useAppSettings, OFFLINE_MODELS } from './hooks/useAppSettings';
import { useResizableLayout } from './hooks/useResizableLayout';
import { useVideoPlayer } from './hooks/useVideoPlayer';

const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds * 1000) % 1000);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
};

const parseTime = (timeStr: string): number => {
    try {
        const parts = timeStr.trim().split(':');
        if (parts.length === 3) {
            const h = parseInt(parts[0], 10);
            const m = parseInt(parts[1], 10);
            const s = parseFloat(parts[2].replace(',', '.'));
            return (h * 3600) + (m * 60) + s;
        } else if (parts.length === 2) {
            const m = parseInt(parts[0], 10);
            const s = parseFloat(parts[1].replace(',', '.'));
            return (m * 60) + s;
        } else {
            return parseFloat(timeStr.replace(',', '.'));
        }
    } catch (e) {
        return NaN;
    }
};

export default function App() {
    // --- HOOKS ---
    const settings = useAppSettings();
    const layout = useResizableLayout();
    const player = useVideoPlayer();

    // --- APP STATE ---
    // Media & Files
    const [videoSrc, setVideoSrc] = useState<string | null>(null);
    const [videoFile, setVideoFile] = useState<File | null>(null);
    // Keep a ref of videoFile to access in callbacks without closures
    const currentVideoFileRef = useRef<File | null>(null);

    const [subtitles, setSubtitles] = useState<SubtitleSegment[]>([]);
    const [currentSegmentIndex, setCurrentSegmentIndex] = useState<number>(-1);

    // Subtitle Persistence: Map "filename-size" -> SubtitleSegment[]
    const [videoSubtitlesMap, setVideoSubtitlesMap] = useState<Record<string, SubtitleSegment[]>>({});

    // Progress Persistence: Map "filename-size" -> number (seconds)
    const [playbackProgressMap, setPlaybackProgressMap] = useState<Record<string, number>>({});

    // Conversion
    // isConverting is now just a general flag if ANY conversion is happening (optional, for UI hints)
    const [isConverting, setIsConverting] = useState(false);
    const [conversionQueue, setConversionQueue] = useState<string[]>([]);

    // Video List
    const [showVideoList, setShowVideoList] = useState(false);
    const [videoList, setVideoList] = useState<File[]>([]);
    const [videoStatuses, setVideoStatuses] = useState<Record<string, { converting: boolean, progress: number, done: boolean, queued?: boolean }>>({});
    const [draggedVideoIndex, setDraggedVideoIndex] = useState<number | null>(null);

    // Playlist Persistence State
    const [isPlaylistLoaded, setIsPlaylistLoaded] = useState(false);

    // Editing & UI
    const [editingSegmentIndex, setEditingSegmentIndex] = useState<number>(-1);
    const [editText, setEditText] = useState<string>('');
    const [editStart, setEditStart] = useState<string>('');
    const [editEnd, setEditEnd] = useState<string>('');

    // Processing State: Now tracks specific file key instead of just boolean
    const [processingVideoKey, setProcessingVideoKey] = useState<string | null>(null);

    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // Vocabulary State (with persistence)
    const [vocabulary, setVocabulary] = useState<VocabularyItem[]>(() => {
        try {
            const saved = localStorage.getItem('lingo_vocabulary');
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            console.error("Failed to load vocabulary", e);
            return [];
        }
    });

    const [selectedWord, setSelectedWord] = useState<WordDefinition | null>(null);
    const [loadingWord, setLoadingWord] = useState(false);
    const [showVocabSidebar, setShowVocabSidebar] = useState(false);

    // Refs for processing
    const processingIdRef = useRef(0);
    const audioDataCacheRef = useRef<Float32Array | null>(null);
    const lockStateRef = useRef<{ index: number; start: number; hits: number } | null>(null);
    const pendingSeekTimeRef = useRef<number | null>(null);
    const lastSaveTimeRef = useRef<number>(0);

    // Auto-Save Timer Ref to debounce IndexedDB writes
    const autoSaveTimerRef = useRef<any>(null);

    // --- VOCABULARY PERSISTENCE ---
    useEffect(() => {
        localStorage.setItem('lingo_vocabulary', JSON.stringify(vocabulary));
    }, [vocabulary]);

    // --- PLAYLIST PERSISTENCE (LOAD) ---
    useEffect(() => {
        const initPlaylist = async () => {
            try {
                const { files, subtitlesMap, progressMap } = await loadFullPlaylistFromDB();
                if (files && files.length > 0) {
                    setVideoList(files);
                    setVideoSubtitlesMap(subtitlesMap);
                    setPlaybackProgressMap(progressMap);
                    setShowVideoList(true);
                }
            } catch (e) {
                console.error("Failed to load playlist", e);
            } finally {
                setIsPlaylistLoaded(true);
            }
        };
        initPlaylist();
    }, []);

    // --- PLAYLIST PERSISTENCE (AUTO-SAVE) ---
    useEffect(() => {
        if (isPlaylistLoaded) {
            if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
            autoSaveTimerRef.current = setTimeout(() => {
                saveFullPlaylistToDB(videoList, videoSubtitlesMap, playbackProgressMap)
                    .catch(e => console.error("Auto-save playlist failed", e));
            }, 2000); // Save every 2 seconds if changes occur
        }
    }, [videoList, videoSubtitlesMap, playbackProgressMap, isPlaylistLoaded]);

    // --- HELPERS ---
    const updateSubtitles = useCallback((newSegments: SubtitleSegment[], file: File | null = videoFile) => {
        if (file) {
            const key = `${file.name}-${file.size}`;
            setVideoSubtitlesMap(prev => ({ ...prev, [key]: newSegments }));

            // Only update visible subtitles if this is the currently viewed video
            if (videoFile && `${videoFile.name}-${videoFile.size}` === key) {
                setSubtitles(newSegments);
            }
        } else {
            setSubtitles(newSegments);
        }
    }, [videoFile]);

    // Update Ref when state changes
    useEffect(() => {
        currentVideoFileRef.current = videoFile;
    }, [videoFile]);

    // --- AUTO-SUBTITLE LOADER ---
    const autoLoadSubtitles = async (files: File[], newFile: File) => {
        const key = `${newFile.name}-${newFile.size}`;
        if (videoSubtitlesMap[key]) return; // Already exists

        const baseName = newFile.name.replace(/\.[^/.]+$/, "");

        // Strategy 1: Check sibling files in the drop batch (Web/Drag-Drop)
        const sibling = files.find(f => {
            const fName = f.name.replace(/\.[^/.]+$/, "");
            const ext = f.name.split('.').pop()?.toLowerCase();
            return fName === baseName && (ext === 'srt' || ext === 'vtt');
        });

        if (sibling) {
            try {
                const segs = await parseSubtitleFile(sibling);
                const mapped = segs.map((s, i) => ({ ...s, id: i }));
                setVideoSubtitlesMap(prev => ({ ...prev, [key]: mapped }));
                console.log(`[AutoSub] Loaded sibling for ${newFile.name} from batch`);
                // If this is the currently loaded video, update immediately
                if (videoFile && videoFile.name === newFile.name) setSubtitles(mapped);
                return;
            } catch (e) { console.warn("Failed to parse sibling subtitle", e); }
        }

        // Strategy 2: Check File System (Electron Only) - Using Native Node FS
        // @ts-ignore
        if (window.electron && window.electron.isElectron && newFile.path) {
            try {
                // Since nodeIntegration is true, we can dynamically require 'fs' and 'path'
                // This bypasses webSecurity fetch restrictions
                // @ts-ignore
                const fs = window.require('fs');
                // @ts-ignore
                const path = window.require('path');

                // @ts-ignore
                const videoPath = newFile.path;
                const dir = path.dirname(videoPath);
                const nameNoExt = path.basename(videoPath, path.extname(videoPath));
                const exts = ['.srt', '.vtt'];

                for (const ext of exts) {
                    const subPath = path.join(dir, nameNoExt + ext);
                    if (fs.existsSync(subPath)) {
                        console.log(`[AutoSub] Found sidecar via FS: ${subPath}`);
                        const text = fs.readFileSync(subPath, 'utf8');
                        const segs = parseSubtitleContent(text);
                        const mapped = segs.map((s: any, i: number) => ({ ...s, id: i }));

                        setVideoSubtitlesMap(prev => ({ ...prev, [key]: mapped }));

                        // If this is the currently loaded video, update immediately
                        if (videoFile && videoFile.name === newFile.name) {
                            setSubtitles(mapped);
                        }
                        return; // Stop after first success
                    }
                }
            } catch (e) {
                console.warn("Electron FS sidecar search failed", e);
            }
        }
    };

    // --- CONVERSION LOGIC ---

    const startConversion = useCallback(async (file: File, key: string) => {
        setIsConverting(true);
        setVideoStatuses(prev => ({
            ...prev,
            [key]: { converting: true, progress: 0, done: false, queued: false }
        }));

        try {
            const convertedUrl = await convertVideoToMp4(file, (progress) => {
                setVideoStatuses(prev => ({
                    ...prev,
                    [key]: { ...prev[key], converting: true, progress }
                }));
            }, key);

            setVideoStatuses(prev => ({
                ...prev,
                [key]: { converting: false, progress: 100, done: true, queued: false }
            }));

            // @ts-ignore
            const isElectron = (window.electron && window.electron.isElectron) || (window.process && window.process.versions && window.process.versions.electron);

            if (isElectron && (file as any).path) {
                try {
                    // ELECTRON: File is already saved to disk by Native FFmpeg at `convertedUrl` (which is file://...)
                    // We just need to register it in the UI list.

                    // @ts-ignore
                    const path = window.require('path');
                    // @ts-ignore
                    const originalPath = (file as any).path;
                    const dir = path.dirname(originalPath);
                    const name = path.parse(originalPath).name;
                    const newPath = path.join(dir, `${name}.mp4`);

                    // Create new File object for the playlist that points to the local path
                    // Note: We don't read the blob content here, just creating a reference.
                    const newFile = new File([""], `${name}.mp4`, { type: 'video/mp4' });

                    // CRITICAL FIX: 'path' property is read-only on File objects in Electron/Chrome.
                    // We must use Object.defineProperty to set it.
                    Object.defineProperty(newFile, 'path', {
                        value: newPath,
                        writable: false,
                        enumerable: false, // Don't show up in normal enumeration if not desired
                        configurable: true
                    });

                    // Fake size just so it looks okay in UI (optional, or read via fs.statSync if needed)
                    // @ts-ignore
                    const fs = window.require('fs');
                    try {
                        const stats = fs.statSync(newPath);
                        Object.defineProperty(newFile, 'size', { value: stats.size });
                    } catch (e) { }

                    setVideoList(prev => [...prev, newFile]);
                    autoLoadSubtitles(videoList, newFile);

                } catch (saveErr: any) {
                    console.error("Failed to register converted file in Electron:", saveErr);
                    // Don't alert here, it might just be a UI update issue, the file is likely safe.
                }
            } else {
                // WEB: Prompt download
                const a = document.createElement('a');
                a.href = convertedUrl;
                a.download = file.name.replace(/\.[^/.]+$/, "") + ".mp4";
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);

                // Add to list for immediate usage (blob based)
                try {
                    const blob = await fetch(convertedUrl).then(r => r.blob());
                    const newFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".mp4", { type: 'video/mp4' });
                    setVideoList(prev => [...prev, newFile]);
                    autoLoadSubtitles(videoList, newFile);
                } catch (e) { }
            }

        } catch (error: any) {
            const errMsg = error.message || "";
            // Ignore cancellation errors
            if (!errMsg.includes("terminated") && !errMsg.includes("Code -1") && !errMsg.includes("SIGKILL")) {
                alert(`Conversion failed for ${file.name}: ${errMsg}`);
            }
            // Reset status on error
            setVideoStatuses(prev => ({ ...prev, [key]: { converting: false, progress: 0, done: false, queued: false } }));
        } finally {
            // We check if any other conversions are running to turn off global flag, mostly for safety
            setVideoStatuses(currentStatuses => {
                const isAnyConverting = Object.values(currentStatuses).some(s => s.converting);
                setIsConverting(isAnyConverting);
                return currentStatuses;
            });
        }
    }, [videoList]);

    // Effect to process the queue: now concurrent!
    useEffect(() => {
        if (conversionQueue.length === 0) return;
        const batch = [...conversionQueue];
        setConversionQueue([]);
        batch.forEach(key => {
            const file = videoList.find(f => `${f.name}-${f.size}` === key);
            if (file) {
                startConversion(file, key);
            }
        });
    }, [conversionQueue, videoList, startConversion]);


    // Playlist Handlers
    const handleBatchUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files && event.target.files.length > 0) {
            const newFiles = Array.from(event.target.files);

            // 1. Add to list
            setVideoList(prev => {
                const combined = [...prev];
                newFiles.forEach(f => {
                    // Only add if not duplicate
                    if (!combined.some(existing => existing.name === f.name && existing.size === f.size)) {
                        combined.push(f);
                    }
                });
                return combined;
            });

            // 2. Auto-Scan Subtitles for newly added videos
            // We pass the entire new batch so we can find pairs (video + srt dragged together)
            const allFilesContext = [...videoList, ...newFiles];

            for (const f of newFiles) {
                const isVideo = f.type.startsWith('video') || f.name.match(/\.(mp4|mkv|webm|avi|mov|wmv)$/i);
                if (isVideo) {
                    await autoLoadSubtitles(allFilesContext, f);
                }
            }
        }
        event.target.value = '';
    };

    const handleQueueConversion = (e: React.MouseEvent, file: File) => {
        e.stopPropagation();
        const key = `${file.name}-${file.size}`;
        if (conversionQueue.includes(key) || videoStatuses[key]?.converting) return;
        setVideoStatuses(prev => ({
            ...prev,
            [key]: { converting: false, progress: 0, done: false, queued: true }
        }));
        setConversionQueue(prev => [...prev, key]);
    };

    const handleCancelConversion = useCallback((key: string) => {
        cancelVideoConversion(key);
        setVideoStatuses(prev => ({
            ...prev,
            [key]: { converting: false, progress: 0, done: false, queued: false }
        }));
    }, []);

    const handleDeleteVideo = (e: React.MouseEvent, index: number) => {
        e.stopPropagation();
        if (window.confirm("Remove video from list?")) {
            const fileToRemove = videoList[index];
            setVideoList(prev => prev.filter((_, i) => i !== index));
            // Optional: clean up subtitle map/progress map? 
            // Better to keep in case user re-adds.
        }
    };

    // --- SUBTITLE EDITING ---
    const startEditing = (index: number, text: string, start: number, end: number) => {
        setEditingSegmentIndex(index);
        setEditText(text);
        setEditStart(formatTime(start));
        setEditEnd(formatTime(end));
        if (player.isPlaying && player.videoRef.current) {
            player.videoRef.current.pause();
            player.setIsPlaying(false);
        }
    };

    const saveEdit = () => {
        if (editingSegmentIndex === -1) return;
        const startVal = parseTime(editStart);
        const endVal = parseTime(editEnd);
        if (isNaN(startVal) || isNaN(endVal) || startVal >= endVal) { alert("Invalid time range."); return; }
        if (editingSegmentIndex > 0 && startVal < subtitles[editingSegmentIndex - 1].end) { alert("Overlap with previous."); return; }
        if (editingSegmentIndex < subtitles.length - 1 && endVal > subtitles[editingSegmentIndex + 1].start) { alert("Overlap with next."); return; }

        const newSubs = [...subtitles];
        newSubs[editingSegmentIndex] = { ...newSubs[editingSegmentIndex], text: editText, start: startVal, end: endVal };
        updateSubtitles(newSubs);
        cancelEdit();
    };

    const cancelEdit = useCallback(() => {
        setEditingSegmentIndex(-1);
        setEditText('');
        setEditStart('');
        setEditEnd('');
    }, []);

    const deleteSubtitle = (e: React.MouseEvent, index: number) => {
        e.stopPropagation();
        if (window.confirm("Delete this subtitle line?")) {
            const newSubs = subtitles.filter((_, i) => i !== index);
            const reindexed = newSubs.map((s, i) => ({ ...s, id: i }));
            updateSubtitles(reindexed);
            if (currentSegmentIndex === index) setCurrentSegmentIndex(-1);
        }
    };

    useEffect(() => {
        const handleGlobalClick = (e: MouseEvent) => {
            if (editingSegmentIndex === -1) return;
            const editContainer = document.getElementById(`subtitle-edit-container-${editingSegmentIndex}`);
            if (editContainer && !editContainer.contains(e.target as Node)) cancelEdit();
        };
        window.addEventListener('mousedown', handleGlobalClick);
        return () => window.removeEventListener('mousedown', handleGlobalClick);
    }, [editingSegmentIndex, cancelEdit]);

    // --- SUBTITLE GENERATION ---
    const handleGenerate = async (testMode: boolean = false) => {
        if (!videoFile) return;

        // Check if placeholder
        if ((videoFile as any).isPlaceholder) {
            alert("Cannot generate subtitles for a placeholder file. Please reload the original video.");
            return;
        }

        const fileKey = `${videoFile.name}-${videoFile.size}`;
        if (processingVideoKey === fileKey) {
            cancelSubtitleGeneration();
            setProcessingVideoKey(null);
            processingIdRef.current += 1;
            return;
        }
        if (processingVideoKey) return;

        const currentId = processingIdRef.current + 1;
        processingIdRef.current = currentId;
        setProcessingVideoKey(fileKey);

        if (videoFile && `${videoFile.name}-${videoFile.size}` === fileKey) {
            setSubtitles([]);
            setCurrentSegmentIndex(-1);
            setErrorMsg(null);
        }

        setSelectedWord(null);
        // We do NOT pause here anymore, allowing playback to continue
        lockStateRef.current = null;

        if (settings.isOffline && !settings.localASRConfig.enabled && settings.modelStatus === 'idle') settings.setModelStatus('loading');

        try {
            let audioDataForProcess = audioDataCacheRef.current;
            if (videoFile && `${videoFile.name}-${videoFile.size}` !== fileKey) {
                audioDataForProcess = null;
            }

            if (!audioDataForProcess) {
                const decoded = await getAudioData(videoFile, true);
                if (typeof decoded !== 'string') {
                    audioDataForProcess = decoded;
                    if (videoFile && `${videoFile.name}-${videoFile.size}` === fileKey) {
                        audioDataCacheRef.current = decoded;
                    }
                }
            }

            await generateSubtitles(
                videoFile,
                (newSegments) => {
                    if (processingIdRef.current === currentId) {
                        setVideoSubtitlesMap(prev => ({ ...prev, [fileKey]: newSegments }));
                        const current = currentVideoFileRef.current;
                        if (current && `${current.name}-${current.size}` === fileKey) {
                            setSubtitles(newSegments);
                        }
                    }
                },
                settings.isOffline, settings.selectedModelId, settings.geminiConfig.apiKey, settings.localASRConfig, settings.segmentationMethod, settings.vadSettings, testMode, audioDataForProcess
            );

            if (processingIdRef.current === currentId) {
                setProcessingVideoKey(null);
            }
        } catch (error: any) {
            console.error("Subtitle generation failed", error);
            if (processingIdRef.current === currentId) {
                if (videoFile && `${videoFile.name}-${videoFile.size}` === fileKey) {
                    setErrorMsg(error.message || "Generation Failed");
                }
                setProcessingVideoKey(null);
            }
        }
    };

    // --- SUBTITLE IMPORT ---
    const handleSubtitleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (!videoFile) {
            alert("Please load a video first to import subtitles for it.");
            event.target.value = '';
            return;
        }

        try {
            const segs = await parseSubtitleFile(file);
            const mapped = segs.map((s, i) => ({ ...s, id: i }));
            updateSubtitles(mapped);
        } catch (e) {
            console.error(e);
            alert("Failed to parse subtitle file.");
        }
        event.target.value = '';
    };

    // --- VIDEO LOADING ---
    const loadVideoFromFile = useCallback(async (file: File) => {
        // More robust Electron check
        // @ts-ignore
        const isElectron = (window.electron && window.electron.isElectron) || (window.process && window.process.versions && window.process.versions.electron);
        const filePath = (file as any).path;

        // --- 1. Placeholder Check (Web Security) ---
        // If it's a placeholder (restored from DB), we can ONLY play it if we are in Electron and have a path.
        if ((file as any).isPlaceholder) {
            if (!isElectron || !filePath) {
                alert(`Due to browser security, please re-select or drag-and-drop "${file.name}" to play it.`);
                return;
            }
        }

        const key = `${file.name}-${file.size}`;

        player.setCurrentTime(0);
        player.setDuration(0);
        player.setIsPlaying(false);
        setErrorMsg(null);
        setCurrentSegmentIndex(-1);
        setIsConverting(false);
        setVideoSrc(null);
        audioDataCacheRef.current = null;
        lockStateRef.current = null;

        // Restore progress from map
        const savedTime = playbackProgressMap[key] || 0;
        pendingSeekTimeRef.current = savedTime > 0 ? savedTime : null;

        setVideoFile(file);

        // --- 2. Electron Path vs Web Blob ---
        if (isElectron && filePath) {
            // CRITICAL FIX: Handle Windows paths and encoding for file:// protocol
            const safePath = filePath.replace(/\\/g, '/');
            const encodedPath = safePath.split('/').map(encodeURIComponent).join('/');
            // Windows drive letters (e.g., "C%3A") usually work fine encoded, but just in case of issues:
            // A simpler robust method for many electron versions:
            setVideoSrc(`file://${encodeURI(safePath)}`);
        } else {
            // Standard web behavior
            setVideoSrc(URL.createObjectURL(file));
        }

        setTimeout(() => { if (player.videoRef.current) { player.videoRef.current.play().catch(() => { }); player.setIsPlaying(true); } }, 100);

        // Subtitle Loading Strategy:
        // 1. Check in-memory map (loaded from DB or generated)
        if (videoSubtitlesMap[key]) {
            setSubtitles(videoSubtitlesMap[key]);
        } else {
            setSubtitles([]);
        }
    }, [videoList, player, videoSubtitlesMap, playbackProgressMap]);

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        // This is the single file input (top right)
        const file = event.target.files?.[0];
        if (!file) return;

        // Add to list if not present
        setVideoList(prev => prev.some(f => f.name === file.name && f.size === file.size) ? prev : [...prev, file]);
        setShowVideoList(true);

        // Try auto load subs for this single file
        // We pass current list + new file as context
        await autoLoadSubtitles([...videoList, file], file);

        // Load it
        loadVideoFromFile(file);
        event.target.value = '';
    };

    // --- VIDEO & SUBTITLE SYNC LOOP ---
    useEffect(() => {
        let animationFrameId: number;
        const updateLoop = () => {
            if (player.videoRef.current && !player.videoRef.current.paused) {
                const time = player.videoRef.current.currentTime;
                player.setCurrentTime(time);

                // Debounced progress update (updates React state which eventually updates DB)
                const now = Date.now();
                if (now - lastSaveTimeRef.current > 1000 && videoFile) {
                    const key = `${videoFile.name}-${videoFile.size}`;
                    setPlaybackProgressMap(prev => ({ ...prev, [key]: time }));
                    lastSaveTimeRef.current = now;
                }

                if (player.playbackMode === PlaybackMode.LOOP_SENTENCE && currentSegmentIndex !== -1 && subtitles[currentSegmentIndex] && time >= subtitles[currentSegmentIndex].end) {
                    player.videoRef.current.currentTime = subtitles[currentSegmentIndex].start;
                    player.setCurrentTime(subtitles[currentSegmentIndex].start);
                    animationFrameId = requestAnimationFrame(updateLoop);
                    return;
                }

                if (lockStateRef.current) {
                    const { index, start } = lockStateRef.current;
                    if (time > (start + 0.001)) lockStateRef.current.hits += 1; else lockStateRef.current.hits = 0;
                    if (lockStateRef.current.hits >= settings.syncThreshold) lockStateRef.current = null;
                    else {
                        if (currentSegmentIndex !== index) setCurrentSegmentIndex(index);
                        animationFrameId = requestAnimationFrame(updateLoop);
                        return;
                    }
                }

                const shouldAutoUpdate = player.playbackMode !== PlaybackMode.LOOP_SENTENCE || currentSegmentIndex === -1;
                if (shouldAutoUpdate && editingSegmentIndex === -1) {
                    const exactIndex = subtitles.findIndex(s => time >= s.start && time < s.end);
                    if (exactIndex !== -1 && exactIndex !== currentSegmentIndex) setCurrentSegmentIndex(exactIndex);
                    else if (exactIndex === -1 && currentSegmentIndex !== -1) setCurrentSegmentIndex(-1);
                }
            }
            animationFrameId = requestAnimationFrame(updateLoop);
        };
        if (player.isPlaying) updateLoop(); else cancelAnimationFrame(animationFrameId);
        return () => cancelAnimationFrame(animationFrameId);
    }, [player.isPlaying, subtitles, currentSegmentIndex, player.playbackMode, settings.syncThreshold, editingSegmentIndex, videoFile, player]);

    // --- NAVIGATION HELPERS ---
    const handleLoadedMetadata = () => {
        player.handleLoadedMetadata();
        if (player.videoRef.current && pendingSeekTimeRef.current !== null) {
            const t = Math.min(pendingSeekTimeRef.current, player.videoRef.current.duration);
            player.videoRef.current.currentTime = t;
            player.setCurrentTime(t);
            pendingSeekTimeRef.current = null;
        }
    };

    const jumpToSegment = (index: number) => {
        if (editingSegmentIndex !== -1 || !player.videoRef.current || !subtitles[index]) return;
        const segment = subtitles[index];
        lockStateRef.current = { index: index, start: segment.start, hits: 0 };
        setCurrentSegmentIndex(index);
        player.videoRef.current.currentTime = segment.start + 0.001;
        player.setCurrentTime(segment.start);
        if (!player.isPlaying) { player.videoRef.current.play(); player.setIsPlaying(true); }
    };

    const handlePrevSentence = () => {
        if (subtitles.length === 0) return;
        if (currentSegmentIndex > 0) jumpToSegment(currentSegmentIndex - 1);
        else {
            const time = player.videoRef.current?.currentTime || player.currentTime;
            const next = subtitles.findIndex(s => s.start > time);
            if (next === -1 && subtitles.length > 0) jumpToSegment(subtitles.length - 1);
            else if (next > 0) jumpToSegment(next - 1);
        }
    };

    const handleNextSentence = () => {
        if (subtitles.length === 0) return;
        if (currentSegmentIndex !== -1 && currentSegmentIndex < subtitles.length - 1) jumpToSegment(currentSegmentIndex + 1);
        else {
            const time = player.videoRef.current?.currentTime || player.currentTime;
            const next = subtitles.findIndex(s => s.start > time);
            if (next !== -1) jumpToSegment(next);
        }
    };

    // --- KEYBOARD SHORTCUTS ---
    const handleVolumeUp = useCallback(() => {
        player.handleVolumeChange(Math.min(1, player.volume + 0.05));
    }, [player]);

    const handleVolumeDown = useCallback(() => {
        player.handleVolumeChange(Math.max(0, player.volume - 0.05));
    }, [player]);

    const handlersRef = useRef<any>({});
    useEffect(() => { handlersRef.current = { handlePrevSentence, handleNextSentence, togglePlayPause: player.togglePlayPause, toggleMute: player.toggleMute, stepFrame: player.stepFrame, setPlaybackRate: player.setPlaybackRate, togglePlaybackMode: player.togglePlaybackMode, playbackRate: player.playbackRate, playbackMode: player.playbackMode, handleVolumeUp, handleVolumeDown }; });
    useEffect(() => {
        const playbackRates = [0.3, 0.4, 0.5, 0.6, 0.75, 1.0, 1.25, 1.5, 2.0];
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable) return;
            const h = handlersRef.current;
            switch (e.key.toLowerCase()) {
                case 'a': h.handlePrevSentence(); break;
                case 'd': h.handleNextSentence(); break;
                case 'w': {
                    let idx = playbackRates.indexOf(h.playbackRate);
                    if (idx === -1) idx = playbackRates.findIndex(r => r > h.playbackRate) - 1;
                    if (idx < playbackRates.length - 1) h.setPlaybackRate(playbackRates[idx + 1]);
                    break;
                }
                case 's': {
                    let idx = playbackRates.indexOf(h.playbackRate);
                    if (idx === -1) idx = playbackRates.findIndex(r => r >= h.playbackRate);
                    if (idx > 0) h.setPlaybackRate(playbackRates[idx - 1]);
                    break;
                }
                case ' ': e.preventDefault(); h.togglePlayPause(); break;
                case 'q': h.togglePlaybackMode(); break;
                case 'e': h.toggleMute(); break;
                case ',': case '<': h.stepFrame('prev'); break;
                case '.': case '>': h.stepFrame('next'); break;
                case '-': case '_': h.handleVolumeDown(); break;
                case '=': case '+': h.handleVolumeUp(); break;
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // --- DICTIONARY ---
    const handleWordClick = async (word: string) => {
        if (editingSegmentIndex !== -1) return;
        const cleanWord = word.replace(/[.,!?;:"()]/g, "").trim();
        if (!cleanWord) return;
        const context = subtitles[currentSegmentIndex]?.text || "No context";
        setLoadingWord(true);
        try { setSelectedWord(await getWordDefinition(cleanWord, context, settings.isOffline, settings.localLLMConfig, settings.geminiConfig.apiKey)); if (player.videoRef.current && player.isPlaying) { player.videoRef.current.pause(); player.setIsPlaying(false); } }
        catch (error) { console.error(error); } finally { setLoadingWord(false); }
    };
    const addToVocab = (wordDef: WordDefinition) => { if (!vocabulary.some(v => v.word === wordDef.word)) setVocabulary(prev => [{ ...wordDef, id: crypto.randomUUID(), addedAt: Date.now() }, ...prev]); };

    // --- VOCABULARY EXPORT/IMPORT ---
    const handleExportVocab = () => {
        if (vocabulary.length === 0) {
            alert("Vocabulary list is empty.");
            return;
        }
        const dataStr = JSON.stringify(vocabulary, null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `lingoplayer_vocab_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const handleImportVocab = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const json = JSON.parse(event.target?.result as string);
                if (Array.isArray(json)) {
                    setVocabulary(prev => {
                        const existingWords = new Set(prev.map(v => v.word.toLowerCase()));
                        const newItems = json.filter((item: any) =>
                            item.word && !existingWords.has(item.word.toLowerCase())
                        ).map((item: any) => ({
                            ...item,
                            id: item.id || crypto.randomUUID(),
                            addedAt: item.addedAt || Date.now()
                        }));

                        if (newItems.length === 0) {
                            alert("No new words found in file.");
                            return prev;
                        }

                        alert(`Imported ${newItems.length} new words.`);
                        return [...newItems, ...prev];
                    });
                } else {
                    alert("Invalid file format. Expected a JSON array.");
                }
            } catch (error) {
                console.error("Import failed", error);
                alert("Failed to parse the vocabulary file.");
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    // Derived prop for UI components
    const isProcessingCurrent = videoFile && processingVideoKey === `${videoFile.name}-${videoFile.size}`;

    return (
        <div className="flex h-screen bg-black text-gray-100 font-sans overflow-hidden relative">

            <SettingsModal
                isOpen={settings.isSettingsOpen}
                onClose={() => settings.setIsSettingsOpen(false)}
                {...settings}
                OFFLINE_MODELS={OFFLINE_MODELS}
            />

            <SubtitlePanel
                width={layout.leftPanelWidth}
                subtitles={subtitles}
                currentSegmentIndex={currentSegmentIndex}
                isProcessing={!!isProcessingCurrent}
                isAnyProcessing={!!processingVideoKey}
                isOffline={settings.isOffline}
                // setIsOffline removed here
                videoSrc={videoSrc}
                isConverting={isConverting}
                onGenerate={() => handleGenerate(false)}
                onImport={handleSubtitleImport}
                onExport={(f) => {
                    if (subtitles.length === 0) return;
                    const content = f === 'srt' ? segmentsToSRT(subtitles) : segmentsToVTT(subtitles);
                    const blob = new Blob([content], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    const baseName = videoFile ? videoFile.name.replace(/\.[^/.]+$/, "") : "subtitles";
                    a.download = `${baseName}.${f}`;
                    a.click();
                    URL.revokeObjectURL(url);
                }}
                editingSegmentIndex={editingSegmentIndex}
                editText={editText}
                editStart={editStart}
                editEnd={editEnd}
                onStartEdit={startEditing}
                onSaveEdit={saveEdit}
                onCancelEdit={cancelEdit}
                setEditText={setEditText}
                setEditStart={setEditStart}
                setEditEnd={setEditEnd}
                onDelete={deleteSubtitle}
                onJumpTo={jumpToSegment}
                currentTime={player.currentTime}
                formatTime={formatTime}
            />

            <div onMouseDown={layout.startResizingLeft} className="w-1 cursor-col-resize bg-gray-800 hover:bg-blue-500 transition-colors z-20 flex-shrink-0 hidden md:block" />

            {/* CENTER: VIDEO PLAYER AREA */}
            <div className="flex-1 flex flex-col min-w-0 bg-gray-900 relative">
                <div className="h-16 flex items-center justify-between px-6 bg-gray-900 border-b border-gray-800 flex-shrink-0">
                    <div className="flex items-center gap-4"><h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">LingoPlayer AI</h1></div>
                    <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-sm font-medium rounded-lg cursor-pointer transition-colors border border-gray-700">
                            <Upload size={16} /><span>Load Video</span><input type="file" accept=".mp4,.mkv,.webm,.avi,.mov,.wmv" onChange={handleFileChange} className="hidden" />
                        </label>
                        <button onClick={() => setShowVideoList(!showVideoList)} className={`p-2 rounded-lg transition-colors ${showVideoList ? 'text-blue-400 bg-blue-900/20' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}><LayoutList size={20} /></button>
                        <div className="w-px h-6 bg-gray-800 mx-1"></div>
                        <button onClick={() => settings.setIsSettingsOpen(true)} className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"><Settings size={20} /></button>
                        <button onClick={() => setShowVocabSidebar(!showVocabSidebar)} className={`p-2 rounded-lg transition-colors ${showVocabSidebar ? 'text-blue-400 bg-blue-900/20' : 'text-gray-400 hover:text-white'}`}><BookOpen size={20} /></button>
                    </div>
                </div>

                <VideoPlaylist
                    show={showVideoList}
                    videoList={videoList}
                    currentVideoFile={videoFile}
                    videoStatuses={videoStatuses}
                    draggedVideoIndex={draggedVideoIndex}
                    processingVideoKey={processingVideoKey}
                    onLoadVideo={loadVideoFromFile}
                    onBatchUpload={handleBatchUpload}
                    onClearList={() => { if (confirm("Clear playlist?")) setVideoList([]); }}
                    onDelete={handleDeleteVideo}
                    onConvert={handleQueueConversion}
                    onCancelConversion={(e, file) => {
                        e.stopPropagation();
                        const key = `${file.name}-${file.size}`;
                        handleCancelConversion(key);
                    }}
                    onDragStart={(e, i) => setDraggedVideoIndex(i)}
                    onDragOver={(e) => { e.preventDefault(); }}
                    onDrop={(e, i) => {
                        e.preventDefault();
                        if (draggedVideoIndex === null) return;
                        const newList = [...videoList];
                        const [moved] = newList.splice(draggedVideoIndex, 1);
                        newList.splice(i, 0, moved);
                        setVideoList(newList);
                        setDraggedVideoIndex(null);
                    }}
                    onDragEnd={() => setDraggedVideoIndex(null)}
                />

                <div className="flex-1 flex flex-col overflow-hidden">
                    <div style={{ height: layout.videoHeight }} className="bg-black flex items-center justify-center relative flex-shrink-0">
                        {videoSrc ? (
                            <video ref={player.videoRef} src={videoSrc} className="w-full h-full object-contain" onClick={player.togglePlayPause} onLoadedMetadata={handleLoadedMetadata} onEnded={() => player.setIsPlaying(false)} onError={() => !errorMsg && setErrorMsg("Browser cannot decode audio.")} playsInline />
                        ) : (
                            <label className="text-gray-600 flex flex-col items-center cursor-pointer hover:text-gray-400 transition-colors"><Upload size={48} className="mb-4 opacity-50" /><p className="font-medium text-lg">Click to Load Video</p><input type="file" accept=".mp4,.mkv,.webm,.avi,.mov,.wmv" onChange={handleFileChange} className="hidden" /></label>
                        )}
                    </div>

                    <div onMouseDown={layout.startResizingVideo} className="h-1 cursor-row-resize bg-gray-800 hover:bg-blue-500 transition-colors z-20 flex-shrink-0 flex items-center justify-center group"><GripHorizontal size={12} className="text-gray-600 opacity-0 group-hover:opacity-100" /></div>

                    <div style={{ height: layout.subtitleHeight }} className="bg-gray-900 p-6 text-center flex flex-col items-center justify-center flex-shrink-0 overflow-y-auto">
                        {isProcessingCurrent && subtitles.length === 0 ? (<div className="flex flex-col items-center justify-center gap-2 animate-pulse"><span className="text-blue-400 text-sm font-medium">Analyzing Audio...</span></div>) : errorMsg ? (<div className="flex items-center gap-2 text-red-400 text-sm bg-red-900/20 px-4 py-2 rounded"><AlertCircle size={16} /><span>{errorMsg}</span></div>) : null}
                        {currentSegmentIndex !== -1 && subtitles[currentSegmentIndex] && (
                            <div className="animate-in fade-in slide-in-from-bottom-2 duration-200 w-full flex justify-center">
                                <p className="text-xl md:text-2xl font-medium text-white leading-relaxed max-w-3xl text-center">
                                    {subtitles[currentSegmentIndex].text.split(' ').map((word, i) => (
                                        <React.Fragment key={i}>
                                            <span
                                                onClick={(e) => { e.stopPropagation(); handleWordClick(word); }}
                                                className="cursor-pointer hover:text-blue-400 select-none inline-block hover:underline decoration-blue-500/50 underline-offset-4 transition-colors"
                                            >
                                                {word}
                                            </span>
                                            {' '}
                                        </React.Fragment>
                                    ))}
                                </p>
                            </div>
                        )}
                    </div>

                    <div onMouseDown={layout.startResizingSubtitle} className="h-1 cursor-row-resize bg-gray-800 hover:bg-blue-500 transition-colors z-20 flex-shrink-0 flex items-center justify-center group"><GripHorizontal size={12} className="text-gray-600 opacity-0 group-hover:opacity-100" /></div>

                    <div className="flex-1 min-h-0 bg-gray-950 overflow-hidden flex flex-col">
                        <WordDefinitionPanel definition={selectedWord} onAddToVocab={addToVocab} isSaved={selectedWord ? vocabulary.some(v => v.word === selectedWord.word) : false} isLoading={loadingWord} onWordSearch={handleWordClick} />
                    </div>
                </div>

                <VideoControls
                    isPlaying={player.isPlaying}
                    onPlayPause={player.togglePlayPause}
                    playbackMode={player.playbackMode}
                    onToggleMode={player.togglePlaybackMode}
                    playbackRate={player.playbackRate}
                    onRateChange={player.handleRateChange}
                    onPrevSentence={handlePrevSentence}
                    onNextSentence={handleNextSentence}
                    onPrevFrame={() => player.stepFrame('prev')}
                    onNextFrame={() => player.stepFrame('next')}
                    hasSubtitles={subtitles.length > 0}
                    currentTime={player.currentTime}
                    duration={player.duration}
                    onSeek={player.handleSeek}
                    volume={player.volume}
                    onVolumeChange={player.handleVolumeChange}
                    isMuted={player.isMuted}
                    onToggleMute={player.toggleMute}
                />
            </div>

            <div onMouseDown={layout.startResizingRight} className="w-1 cursor-col-resize bg-gray-800 hover:bg-blue-500 transition-colors z-20 flex-shrink-0 hidden md:block" />

            {showVocabSidebar && (
                <div style={{ width: layout.rightPanelWidth }} className="bg-gray-950 border-l border-gray-800 flex flex-col flex-shrink-0 hidden md:flex">
                    <div className="p-4 border-b border-gray-800 bg-gray-900/50 flex items-center justify-between">
                        <div className="flex items-center gap-2"><BookOpen className="text-blue-500" /><h2 className="font-bold text-lg">Vocabulary</h2></div>
                        <div className="flex items-center gap-1">
                            <label className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors cursor-pointer" title="Import JSON">
                                <FileUp size={16} />
                                <input type="file" accept=".json" onChange={handleImportVocab} className="hidden" />
                            </label>
                            <button onClick={handleExportVocab} className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors" title="Export JSON">
                                <Download size={16} />
                            </button>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-0">{vocabulary.length === 0 ? (<div className="p-8 text-center text-gray-500 text-sm opacity-60"><p>No words saved yet.</p></div>) : (vocabulary.map((item) => (<div key={item.id} onClick={() => { setSelectedWord(item); if (player.videoRef.current && player.isPlaying) { player.videoRef.current.pause(); player.setIsPlaying(false); } }} className="p-4 border-b border-gray-800 group hover:bg-gray-900 cursor-pointer transition-colors"><div className="flex justify-between items-start mb-1"><span className="font-bold text-white text-lg">{item.word}</span><button onClick={(e) => { e.stopPropagation(); setVocabulary(v => v.filter(i => i.id !== item.id)); }} className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-1"><Trash2 size={16} /></button></div><p className="text-sm text-gray-400 line-clamp-2">{item.meaning}</p></div>)))}</div>
                </div>
            )}
        </div>
    );
}
