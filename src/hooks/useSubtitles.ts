
import { useState, useRef, useEffect, useCallback } from 'react';
import { SubtitleSegment, PlaybackMode } from '../types';
import { generateSubtitles, getAudioData, cancelSubtitleGeneration } from '../services/geminiService';
import { parseSubtitleFile, parseSubtitleContent } from '../utils/subtitleUtils';

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

export const useSubtitles = (
    player: any, 
    videoFile: File | null, 
    settings: any
) => {
    // State
    const [subtitles, setSubtitles] = useState<SubtitleSegment[]>([]);
    const [currentSegmentIndex, setCurrentSegmentIndex] = useState<number>(-1);
    const [videoSubtitlesMap, setVideoSubtitlesMap] = useState<Record<string, SubtitleSegment[]>>({});
    const [playbackProgressMap, setPlaybackProgressMap] = useState<Record<string, number>>({});
    const [processingVideoKey, setProcessingVideoKey] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // Editing State
    const [editingSegmentIndex, setEditingSegmentIndex] = useState<number>(-1);
    const [editText, setEditText] = useState<string>('');
    const [editStart, setEditStart] = useState<string>('');
    const [editEnd, setEditEnd] = useState<string>('');

    // Refs
    const processingIdRef = useRef(0);
    const audioDataCacheRef = useRef<Float32Array | null>(null);
    const lockStateRef = useRef<{ index: number; start: number; hits: number } | null>(null);
    const lastSaveTimeRef = useRef<number>(0);
    const currentVideoFileRef = useRef<File | null>(null);

    useEffect(() => {
        currentVideoFileRef.current = videoFile;
    }, [videoFile]);

    // Helpers
    const updateSubtitles = useCallback((newSegments: SubtitleSegment[], file: File | null = videoFile) => {
        if (file) {
            const key = `${file.name}-${file.size}`;
            setVideoSubtitlesMap(prev => ({ ...prev, [key]: newSegments }));
            if (videoFile && `${videoFile.name}-${videoFile.size}` === key) {
                setSubtitles(newSegments);
            }
        } else {
            setSubtitles(newSegments);
        }
    }, [videoFile]);

    const autoLoadSubtitles = useCallback(async (files: File[], newFile: File) => {
        const key = `${newFile.name}-${newFile.size}`;
        // Note: We access the state directly here, but in `usePlaylist` this might be stale if not careful.
        // However, this function is passed down and called. We need to check if the map has it.
        // Since `videoSubtitlesMap` is in closure, we use functional update pattern or just rely on the fact that
        // this component re-renders when map updates.
        // Optimization: Check existing map in a functional update? No, that's for setting.
        // Here we can't easily see the *latest* map if we are inside a callback that hasn't refreshed.
        // But `autoLoadSubtitles` is usually triggered by user action, so state should be fresh.
        // To be safe, we'll check it before parsing.
        
        // Actually, for this specific refactor, we can skip the map check here or pass the map in.
        // Simpler: Just do the logic. If it overwrites, it's fine (same content).
        
        const baseName = newFile.name.replace(/\.[^/.]+$/, "");
        const sibling = files.find(f => {
            const fName = f.name.replace(/\.[^/.]+$/, "");
            const ext = f.name.split('.').pop()?.toLowerCase();
            return fName === baseName && (ext === 'srt' || ext === 'vtt');
        });

        if (sibling) {
            try {
                const segs = await parseSubtitleFile(sibling);
                const mapped = segs.map((s, i) => ({ ...s, id: i }));
                setVideoSubtitlesMap(prev => {
                    if (prev[key]) return prev; // Don't overwrite if exists
                    return { ...prev, [key]: mapped };
                });
                if (videoFile && videoFile.name === newFile.name) setSubtitles(mapped);
                return;
            } catch (e) { console.warn("Failed to parse sibling", e); }
        }

        // Electron sidecar check
        // @ts-ignore
        if (window.electron && window.electron.isElectron && newFile.path) {
            try {
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
                        const text = fs.readFileSync(subPath, 'utf8');
                        const segs = parseSubtitleContent(text);
                        const mapped = segs.map((s: any, i: number) => ({ ...s, id: i }));
                        setVideoSubtitlesMap(prev => {
                            if (prev[key]) return prev;
                            return { ...prev, [key]: mapped };
                        });
                        if (videoFile && videoFile.name === newFile.name) setSubtitles(mapped);
                        return; 
                    }
                }
            } catch (e) { console.warn("Electron FS sidecar search failed", e); }
        }
    }, [videoFile]);

    // Generation
    const handleGenerate = async (testMode: boolean = false) => {
        if (!videoFile) return;
        if ((videoFile as any).isPlaceholder) { alert("Cannot generate subtitles for a placeholder file."); return; }
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
        
        lockStateRef.current = null;
        if (settings.isOffline && !settings.localASRConfig.enabled && settings.modelStatus === 'idle') settings.setModelStatus('loading');
        
        try {
            let audioDataForProcess = audioDataCacheRef.current;
            if (videoFile && `${videoFile.name}-${videoFile.size}` !== fileKey) audioDataForProcess = null;
            if (!audioDataForProcess) {
                const decoded = await getAudioData(videoFile, true);
                if (typeof decoded !== 'string') {
                    audioDataForProcess = decoded;
                    if (videoFile && `${videoFile.name}-${videoFile.size}` === fileKey) audioDataCacheRef.current = decoded;
                }
            }
            await generateSubtitles(
                videoFile,
                (newSegments) => { 
                    if (processingIdRef.current === currentId) {
                        setVideoSubtitlesMap(prev => ({ ...prev, [fileKey]: newSegments }));
                        const current = currentVideoFileRef.current;
                        if (current && `${current.name}-${current.size}` === fileKey) setSubtitles(newSegments);
                    } 
                },
                settings.isOffline, settings.selectedModelId, settings.geminiConfig.apiKey, settings.localASRConfig, settings.segmentationMethod, settings.vadSettings, testMode, audioDataForProcess
            );
            if (processingIdRef.current === currentId) setProcessingVideoKey(null);
        } catch (error: any) {
            console.error("Subtitle generation failed", error);
            if (processingIdRef.current === currentId) {
                if (videoFile && `${videoFile.name}-${videoFile.size}` === fileKey) setErrorMsg(error.message || "Generation Failed");
                setProcessingVideoKey(null);
            }
        }
    };

    // Editing
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
            updateSubtitles(newSubs.map((s, i) => ({ ...s, id: i })));
            if (currentSegmentIndex === index) setCurrentSegmentIndex(-1);
        }
    };

    const handleSubtitleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !videoFile) return;
        try {
            const segs = await parseSubtitleFile(file);
            updateSubtitles(segs.map((s, i) => ({ ...s, id: i })));
        } catch (e) { alert("Failed to parse subtitle file."); }
        event.target.value = '';
    };

    // Global click listener to cancel edit
    useEffect(() => {
        const handleGlobalClick = (e: MouseEvent) => {
            if (editingSegmentIndex === -1) return;
            const editContainer = document.getElementById(`subtitle-edit-container-${editingSegmentIndex}`);
            if (editContainer && !editContainer.contains(e.target as Node)) cancelEdit();
        };
        window.addEventListener('mousedown', handleGlobalClick);
        return () => window.removeEventListener('mousedown', handleGlobalClick);
    }, [editingSegmentIndex, cancelEdit]);

    // Jump to segment
    const jumpToSegment = (index: number) => {
        if (editingSegmentIndex !== -1 || !player.videoRef.current || !subtitles[index]) return;
        const segment = subtitles[index];
        lockStateRef.current = { index: index, start: segment.start, hits: 0 };
        setCurrentSegmentIndex(index);
        player.videoRef.current.currentTime = segment.start + 0.001; 
        player.setCurrentTime(segment.start);
        if (!player.isPlaying) { 
            player.videoRef.current.play(); 
            player.setIsPlaying(true); 
        }
    };

    const handlePrevSentence = () => {
        if (subtitles.length === 0) return;
        if (currentSegmentIndex > 0) jumpToSegment(currentSegmentIndex - 1);
        else {
            const time = player.videoRef.current?.currentTime || player.currentTime;
            const next = subtitles.findIndex(s => s.start > time);
            if (next === -1 && subtitles.length > 0) jumpToSegment(subtitles.length - 1); else if (next > 0) jumpToSegment(next - 1);
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

    // SYNC LOOP
    useEffect(() => {
        let animationFrameId: number;
        const updateLoop = () => {
            if (player.videoRef.current && !player.videoRef.current.paused) {
                const time = player.videoRef.current.currentTime;
                player.setCurrentTime(time);
                const now = Date.now();
                if (now - lastSaveTimeRef.current > 1000 && videoFile) {
                    const key = `${videoFile.name}-${videoFile.size}`;
                    setPlaybackProgressMap(prev => ({ ...prev, [key]: time }));
                    lastSaveTimeRef.current = now;
                }
                let isLocked = false;
                if (lockStateRef.current) {
                    const { index, start } = lockStateRef.current;
                    if (currentSegmentIndex !== index) setCurrentSegmentIndex(index);
                    if (time > (start + 0.001)) lockStateRef.current.hits += 1; else lockStateRef.current.hits = 0;
                    if (lockStateRef.current.hits >= settings.syncThreshold) lockStateRef.current = null; else isLocked = true;
                }
                if (!isLocked && player.playbackMode === PlaybackMode.LOOP_SENTENCE && currentSegmentIndex !== -1 && subtitles[currentSegmentIndex]) {
                    const seg = subtitles[currentSegmentIndex];
                    if (time >= seg.end) { player.videoRef.current.currentTime = seg.start; player.setCurrentTime(seg.start); }
                }
                if (!isLocked && editingSegmentIndex === -1) {
                    const shouldAutoUpdate = player.playbackMode !== PlaybackMode.LOOP_SENTENCE || currentSegmentIndex === -1;
                    if (shouldAutoUpdate) {
                        const exactIndex = subtitles.findIndex(s => time >= s.start && time < s.end);
                        if (exactIndex !== -1 && exactIndex !== currentSegmentIndex) setCurrentSegmentIndex(exactIndex);
                        else if (exactIndex === -1 && currentSegmentIndex !== -1) setCurrentSegmentIndex(-1);
                    }
                }
            }
            animationFrameId = requestAnimationFrame(updateLoop);
        };
        if (player.isPlaying) updateLoop(); else cancelAnimationFrame(animationFrameId);
        return () => cancelAnimationFrame(animationFrameId);
    }, [player.isPlaying, subtitles, currentSegmentIndex, player.playbackMode, settings.syncThreshold, editingSegmentIndex, videoFile, player]);

    return {
        subtitles, setSubtitles,
        currentSegmentIndex, setCurrentSegmentIndex,
        videoSubtitlesMap, setVideoSubtitlesMap,
        playbackProgressMap, setPlaybackProgressMap,
        processingVideoKey, setProcessingVideoKey,
        errorMsg, setErrorMsg,
        
        editingSegmentIndex,
        editText, setEditText,
        editStart, setEditStart,
        editEnd, setEditEnd,

        audioDataCacheRef,
        lockStateRef,

        updateSubtitles,
        autoLoadSubtitles,
        handleGenerate,
        startEditing,
        saveEdit,
        cancelEdit,
        deleteSubtitle,
        handleSubtitleImport,
        jumpToSegment,
        handlePrevSentence,
        handleNextSentence,
        formatTime
    };
};
