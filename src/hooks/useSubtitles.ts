
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

export const useSubtitles = (player: any, videoFile: File | null, settings: any) => {
    const [subtitles, setSubtitles] = useState<SubtitleSegment[]>([]);
    const [currentSegmentIndex, setCurrentSegmentIndex] = useState<number>(-1);
    const [videoSubtitlesMap, setVideoSubtitlesMap] = useState<Record<string, SubtitleSegment[]>>({});
    const [playbackProgressMap, setPlaybackProgressMap] = useState<Record<string, number>>({});
    const [processingVideoKey, setProcessingVideoKey] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const [editingSegmentIndex, setEditingSegmentIndex] = useState<number>(-1);
    const [editText, setEditText] = useState('');
    const [editStart, setEditStart] = useState('');
    const [editEnd, setEditEnd] = useState('');

    const processingIdRef = useRef(0);
    const audioDataCacheRef = useRef<Float32Array | null>(null);
    const lockStateRef = useRef<{ index: number; start: number; hits: number } | null>(null);
    const lastSaveTimeRef = useRef<number>(0);
    const isNewInsertionRef = useRef(false); // Track if currently editing a brand new insertion

    const subsRef = useRef<SubtitleSegment[]>([]);
    const modeRef = useRef<PlaybackMode>(PlaybackMode.CONTINUOUS);
    const indexRef = useRef<number>(-1);

    useEffect(() => { subsRef.current = subtitles; }, [subtitles]);
    useEffect(() => { modeRef.current = player.playbackMode; }, [player.playbackMode]);
    useEffect(() => { indexRef.current = currentSegmentIndex; }, [currentSegmentIndex]);

    const updateSubtitles = useCallback((newSegments: SubtitleSegment[], file: File | null = videoFile) => {
        if (!file) return;
        const key = `${file.name}-${file.size}`;
        setVideoSubtitlesMap(prev => ({ ...prev, [key]: newSegments }));
        if (videoFile && `${videoFile.name}-${videoFile.size}` === key) setSubtitles(newSegments);
    }, [videoFile]);

    const autoLoadSubtitles = useCallback(async (files: File[], newFile: File) => {
        const key = `${newFile.name}-${newFile.size}`;
        const baseName = newFile.name.replace(/\.[^/.]+$/, "");
        const sibling = files.find(f => f.name.replace(/\.[^/.]+$/, "") === baseName && (f.name.endsWith('.srt') || f.name.endsWith('.vtt')));

        if (sibling) {
            try {
                const segs = await parseSubtitleFile(sibling);
                const mapped = segs.map((s, i) => ({ ...s, id: i }));
                setVideoSubtitlesMap(prev => prev[key] ? prev : { ...prev, [key]: mapped });
                if (videoFile && videoFile.name === newFile.name) setSubtitles(mapped);
                return;
            } catch (e) { }
        }

        if (window.electron?.isElectron && (newFile as any).path) {
            try {
                const win = window as any;
                const fs = win.require('fs');
                const path = win.require('path');
                const videoPath = (newFile as any).path;
                const dir = path.dirname(videoPath);
                const nameNoExt = path.basename(videoPath, path.extname(videoPath));
                const exts = ['.srt', '.vtt'];
                for (const ext of exts) {
                    const subPath = path.join(dir, nameNoExt + ext);
                    if (fs.existsSync(subPath)) {
                        const text = fs.readFileSync(subPath, 'utf8');
                        const segs = parseSubtitleContent(text).map((s, i) => ({ ...s, id: i }));
                        setVideoSubtitlesMap(prev => prev[key] ? prev : { ...prev, [key]: segs });
                        if (videoFile && videoFile.name === newFile.name) setSubtitles(segs);
                        return;
                    }
                }
            } catch (e) { }
        }
    }, [videoFile]);

    const handleGenerate = async (testMode = false) => {
        if (!videoFile) return;
        const fileKey = `${videoFile.name}-${videoFile.size}`;
        if (processingVideoKey === fileKey) {
            cancelSubtitleGeneration();
            setProcessingVideoKey(null);
            processingIdRef.current += 1;
            return;
        }
        if (processingVideoKey) return;
        const currentId = ++processingIdRef.current;
        setProcessingVideoKey(fileKey);
        setSubtitles([]);
        setCurrentSegmentIndex(-1);
        setErrorMsg(null);
        lockStateRef.current = null;

        try {
            let audioData = audioDataCacheRef.current;
            if (!audioData) {
                const decoded = await getAudioData(videoFile, true);
                if (typeof decoded !== 'string') {
                    audioData = decoded;
                    audioDataCacheRef.current = decoded;
                }
            }
            if (!audioData) throw new Error("Audio decode failed");
            await generateSubtitles(
                videoFile,
                (newSegments) => {
                    if (processingIdRef.current === currentId) {
                        setVideoSubtitlesMap(prev => ({ ...prev, [fileKey]: newSegments }));
                        if (videoFile && `${videoFile.name}-${videoFile.size}` === fileKey) setSubtitles(newSegments);
                    }
                },
                settings.isOffline, settings.selectedModelId, settings.geminiConfig.apiKey, settings.localASRConfig, settings.segmentationMethod, settings.vadSettings, testMode, audioData
            );
            if (processingIdRef.current === currentId) setProcessingVideoKey(null);
        } catch (error: any) {
            if (processingIdRef.current === currentId) {
                setErrorMsg(error.message || "Failed");
                setProcessingVideoKey(null);
            }
        }
    };

    const jumpToSegment = (index: number) => {
        if (!player.videoRef.current || !subsRef.current[index]) return;
        const seg = subsRef.current[index];
        lockStateRef.current = { index, start: seg.start, hits: 0 };
        setCurrentSegmentIndex(index);
        player.videoRef.current.currentTime = seg.start + 0.005;
        player.setCurrentTime(seg.start);
        if (!player.isPlaying) player.togglePlayPause();
    };

    const handleManualSeek = useCallback((time: number) => {
        if (!player.videoRef.current) return;
        player.handleSeek(time);
        const idx = subsRef.current.findIndex(s => time >= s.start && time < s.end);
        setCurrentSegmentIndex(idx);
        if (idx !== -1) lockStateRef.current = { index: idx, start: time, hits: 0 };
        else lockStateRef.current = null;
    }, [player]);

    const handlePrevSentence = () => {
        const currentTime = player.currentTime;
        const segments = subsRef.current;
        const currentIndex = indexRef.current;

        if (currentIndex !== -1) {
            if (currentIndex > 0) jumpToSegment(currentIndex - 1);
        } else {
            const prevIndex = [...segments].reverse().findIndex(s => s.end < currentTime);
            if (prevIndex !== -1) {
                jumpToSegment(segments.length - 1 - prevIndex);
            } else if (segments.length > 0) {
                jumpToSegment(0);
            }
        }
    };

    const handleNextSentence = () => {
        const currentTime = player.currentTime;
        const segments = subsRef.current;
        const currentIndex = indexRef.current;

        if (currentIndex !== -1) {
            if (currentIndex < segments.length - 1) jumpToSegment(currentIndex + 1);
        } else {
            const nextIndex = segments.findIndex(s => s.start > currentTime);
            if (nextIndex !== -1) {
                jumpToSegment(nextIndex);
            }
        }
    };

    const startEditing = useCallback((i: number, t: string, s: number, e: number) => {
        isNewInsertionRef.current = false; // Regular edit resets the "new" flag
        setEditingSegmentIndex(i);
        setEditText(t);
        setEditStart(formatTime(s));
        setEditEnd(formatTime(e));
        if (player.videoRef.current) player.videoRef.current.pause();
        player.setIsPlaying(false);
    }, [player]);

    const insertSubtitleBefore = useCallback((index: number) => {
        const currentSub = subtitles[index];
        const prevSub = subtitles[index - 1];

        let newStart = 0;
        let newEnd = currentSub.start;

        if (prevSub) {
            const gap = currentSub.start - prevSub.end;
            if (gap > 0.5) {
                newStart = prevSub.end;
            } else {
                newStart = Math.max(prevSub.end, currentSub.start - 2);
            }
        } else {
            newStart = Math.max(0, currentSub.start - 2);
        }

        const newSeg: SubtitleSegment = {
            id: Date.now(),
            start: newStart,
            end: newEnd,
            text: 'New segment'
        };

        const updated = [...subtitles];
        updated.splice(index, 0, newSeg);
        const reindexed = updated.map((s, i) => ({ ...s, id: i }));

        updateSubtitles(reindexed);

        // Set flag and enter edit mode
        setTimeout(() => {
            isNewInsertionRef.current = true;
            setEditingSegmentIndex(index);
            setEditText(newSeg.text);
            setEditStart(formatTime(newSeg.start));
            setEditEnd(formatTime(newSeg.end));
            if (player.videoRef.current) player.videoRef.current.pause();
            player.setIsPlaying(false);
        }, 10);
    }, [subtitles, updateSubtitles, player]);

    useEffect(() => {
        let rafId: number;
        const update = () => {
            const video = player.videoRef.current;
            if (video && !video.paused) {
                const time = video.currentTime;
                player.setCurrentTime(time);

                const now = Date.now();
                if (now - lastSaveTimeRef.current > 2000 && videoFile) {
                    const key = `${videoFile.name}-${videoFile.size}`;
                    setPlaybackProgressMap(prev => ({ ...prev, [key]: time }));
                    lastSaveTimeRef.current = now;
                }

                let isLocked = false;
                if (lockStateRef.current) {
                    if (indexRef.current !== lockStateRef.current.index) setCurrentSegmentIndex(lockStateRef.current.index);
                    if (time > (lockStateRef.current.start + 0.005)) lockStateRef.current.hits++;
                    if (lockStateRef.current.hits >= settings.syncThreshold) lockStateRef.current = null;
                    else isLocked = true;
                }

                if (!isLocked && modeRef.current === PlaybackMode.LOOP_SENTENCE && indexRef.current !== -1) {
                    const seg = subsRef.current[indexRef.current];
                    if (seg && time >= seg.end) {
                        video.currentTime = seg.start;
                        player.setCurrentTime(seg.start);
                    }
                }

                if (!isLocked && editingSegmentIndex === -1) {
                    const shouldAuto = modeRef.current !== PlaybackMode.LOOP_SENTENCE || indexRef.current === -1;
                    if (shouldAuto) {
                        const idx = subsRef.current.findIndex(s => time >= s.start && time < s.end);
                        if (idx !== indexRef.current) setCurrentSegmentIndex(idx);
                    }
                }
            }
            rafId = requestAnimationFrame(update);
        };
        if (player.isPlaying) rafId = requestAnimationFrame(update);
        return () => cancelAnimationFrame(rafId);
    }, [player.isPlaying, videoFile, settings.syncThreshold, editingSegmentIndex, player.setCurrentTime]);

    const cancelEdit = useCallback(() => {
        if (isNewInsertionRef.current && editingSegmentIndex !== -1) {
            // It was a fresh insertion, delete it on cancel
            const next = subtitles.filter((_, idx) => idx !== editingSegmentIndex);
            updateSubtitles(next.map((s, i) => ({ ...s, id: i })));
        }
        setEditingSegmentIndex(-1);
        isNewInsertionRef.current = false;
    }, [editingSegmentIndex, subtitles, updateSubtitles]);

    return {
        subtitles, setSubtitles, currentSegmentIndex, setCurrentSegmentIndex,
        videoSubtitlesMap, setVideoSubtitlesMap, playbackProgressMap, setPlaybackProgressMap,
        processingVideoKey, errorMsg, setErrorMsg, editingSegmentIndex, editText, setEditText,
        editStart, setEditStart, editEnd, setEditEnd, audioDataCacheRef, lockStateRef,
        updateSubtitles, autoLoadSubtitles, handleGenerate, jumpToSegment, handleManualSeek,
        handlePrevSentence,
        handleNextSentence,
        formatTime,
        insertSubtitleBefore,
        startEditing,
        saveEdit: () => {
            const s = parseTime(editStart);
            const e = parseTime(editEnd);
            if (isNaN(s) || isNaN(e)) { alert("Invalid time format"); return; }
            const next = [...subtitles];
            next[editingSegmentIndex] = { ...next[editingSegmentIndex], text: editText, start: s, end: e };
            updateSubtitles(next);
            setEditingSegmentIndex(-1);
            isNewInsertionRef.current = false; // Saved successfully
        },
        cancelEdit,
        deleteSubtitle: (e: any, i: number) => {
            e.stopPropagation(); setSubtitles(prev => prev.filter((_, idx) => idx !== i));
        },
        handleSubtitleImport: async (e: any) => {
            const f = e.target.files?.[0]; if (!f) return;
            const s = await parseSubtitleFile(f); updateSubtitles(s.map((x, i) => ({ ...x, id: i })));
        }
    };
};
