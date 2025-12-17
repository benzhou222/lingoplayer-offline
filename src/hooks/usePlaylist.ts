
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { PlaylistTab } from '../types';
import { saveFullPlaylistToDB, loadFullPlaylistFromDB } from '../utils/storageUtils';
import { convertVideoToMp4, cancelVideoConversion } from '../services/converterService';

export const usePlaylist = (
    onLoadMetadata: (subtitlesMap: Record<string, any[]>, progressMap: Record<string, number>) => void,
    autoLoadSubtitles: (files: File[], newFile: File) => Promise<void>
) => {
    // State
    const [tabs, setTabs] = useState<PlaylistTab[]>([
        { id: 'default', name: 'Default Library', files: [] }
    ]);
    const [activeTabId, setActiveTabId] = useState<string>('default');
    const [videoStatuses, setVideoStatuses] = useState<Record<string, { converting: boolean, progress: number, done: boolean, queued?: boolean }>>({});
    const [draggedVideoIndex, setDraggedVideoIndex] = useState<number | null>(null);
    const [isPlaylistLoaded, setIsPlaylistLoaded] = useState(false);
    
    // Conversion State
    const [isConverting, setIsConverting] = useState(false); 
    const [conversionQueue, setConversionQueue] = useState<string[]>([]);
    
    const autoSaveTimerRef = useRef<any>(null);

    // Helpers
    const getActiveFileList = useCallback(() => {
        return tabs.find(t => t.id === activeTabId)?.files || [];
    }, [tabs, activeTabId]);

    // LOAD
    useEffect(() => {
        const initPlaylist = async () => {
            try {
                let loadedTabs: PlaylistTab[] = [];
                try {
                    const savedTabs = localStorage.getItem('lingo_playlist_tabs');
                    if (savedTabs) {
                        const parsed = JSON.parse(savedTabs);
                        loadedTabs = parsed.map((t: any) => ({ ...t, files: [] }));
                    }
                } catch(e) { console.error("LS Tabs Load Error", e); }

                const { entries, subtitlesMap, progressMap } = await loadFullPlaylistFromDB();
                
                // Pass metadata up
                onLoadMetadata(subtitlesMap, progressMap);

                if (loadedTabs.length === 0) {
                    loadedTabs = [{ id: 'default', name: 'Default Library', files: [] }];
                }

                const tabsMap = new Map<string, PlaylistTab>();
                loadedTabs.forEach(t => tabsMap.set(t.id, t));

                entries.forEach(item => {
                    const f = new File([""], item.name, { type: item.type, lastModified: item.lastModified });
                    try { Object.defineProperty(f, 'size', { value: item.size, writable: false }); } catch(e) {}
                    if (item.path) {
                        try { Object.defineProperty(f, 'path', { value: item.path, writable: false, enumerable: false, configurable: true }); } catch(e) {}
                    } else {
                        try { Object.defineProperty(f, 'isPlaceholder', { value: true, writable: false, enumerable: false, configurable: true }); } catch(e) {}
                    }

                    const tId = item.tabId || 'default';
                    let targetTab = tabsMap.get(tId);
                    
                    if (!targetTab) {
                        if (!tabsMap.has('default')) {
                            const def = { id: 'default', name: 'Default Library', files: [] };
                            tabsMap.set('default', def);
                            targetTab = def;
                        } else {
                            targetTab = tabsMap.get('default')!;
                        }
                    }
                    targetTab.files.push(f);
                });

                const finalTabs: PlaylistTab[] = [];
                const processedIds = new Set<string>();
                
                loadedTabs.forEach(t => {
                    if (tabsMap.has(t.id)) {
                        finalTabs.push(tabsMap.get(t.id)!);
                        processedIds.add(t.id);
                    }
                });
                
                tabsMap.forEach((t, id) => {
                    if (!processedIds.has(id)) {
                        finalTabs.push(t);
                    }
                });

                if (finalTabs.length > 0) {
                    setTabs(finalTabs);
                    const lastActive = localStorage.getItem('lingo_active_tab');
                    if (lastActive && finalTabs.some(t => t.id === lastActive)) {
                        setActiveTabId(lastActive);
                    } else {
                        setActiveTabId(finalTabs[0].id);
                    }
                }
            } catch (e) {
                console.error("Failed to load playlist", e);
            } finally {
                setIsPlaylistLoaded(true);
            }
        };
        initPlaylist();
    }, []);

    // AUTO SAVE
    // Note: We need the caller to trigger the DB save for metadata maps since they are outside this hook.
    // However, saving structure/files is done here, and we can export a trigger for the App to save metadata.
    // Actually, `saveFullPlaylistToDB` takes all files + maps.
    // So `App.tsx` needs to coordinate the save.
    // We will expose `isPlaylistLoaded` so App can run its save effect.

    // CONVERSION LOGIC
    const startConversion = useCallback(async (file: File, key: string) => {
        setIsConverting(true);
        setVideoStatuses(prev => ({ 
            ...prev, 
            [key]: { converting: true, progress: 0, done: false, queued: false } 
        }));

        try {
            const convertedUrl = await convertVideoToMp4(file, (progress) => {
                setVideoStatuses(prev => ({ ...prev, [key]: { ...prev[key], converting: true, progress } }));
            }, key);

            setVideoStatuses(prev => ({ ...prev, [key]: { converting: false, progress: 100, done: true, queued: false } }));

            // @ts-ignore
            const isElectron = (window.electron && window.electron.isElectron);

            if (isElectron && (file as any).path) {
                try {
                    // @ts-ignore
                    const path = window.require('path');
                    // @ts-ignore
                    const originalPath = (file as any).path;
                    const dir = path.dirname(originalPath);
                    const name = path.parse(originalPath).name;
                    const newPath = path.join(dir, `${name}.mp4`);

                    const newFile = new File([""], `${name}.mp4`, { type: 'video/mp4' });
                    Object.defineProperty(newFile, 'path', { value: newPath, writable: false, enumerable: false, configurable: true });
                    // @ts-ignore
                    const fs = window.require('fs');
                    try { const stats = fs.statSync(newPath); Object.defineProperty(newFile, 'size', { value: stats.size }); } catch(e) {}

                    setTabs(prev => prev.map(t => {
                        if (t.files.some(f => f.name === file.name && f.size === file.size)) {
                            return { ...t, files: [...t.files, newFile] };
                        }
                        return t;
                    }));
                    autoLoadSubtitles([newFile], newFile);

                } catch (saveErr: any) { console.error("Failed to register converted file", saveErr); }
            } else {
                const a = document.createElement('a');
                a.href = convertedUrl;
                a.download = file.name.replace(/\.[^/.]+$/, "") + ".mp4";
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);

                try {
                    const blob = await fetch(convertedUrl).then(r => r.blob());
                    const newFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".mp4", { type: 'video/mp4' });
                    setTabs(prev => prev.map(t => {
                        if (t.files.some(f => f.name === file.name && f.size === file.size)) {
                            return { ...t, files: [...t.files, newFile] };
                        }
                        return t;
                    }));
                    autoLoadSubtitles([newFile], newFile);
                } catch(e) {}
            }

        } catch (error: any) {
            const errMsg = error.message || "";
            if (!errMsg.includes("terminated") && !errMsg.includes("Code -1") && !errMsg.includes("SIGKILL")) {
                alert(`Conversion failed for ${file.name}: ${errMsg}`);
            }
            setVideoStatuses(prev => ({ ...prev, [key]: { converting: false, progress: 0, done: false, queued: false } }));
        } finally {
            setVideoStatuses(currentStatuses => {
                const isAnyConverting = Object.values(currentStatuses).some(s => s.converting);
                setIsConverting(isAnyConverting);
                return currentStatuses;
            });
        }
    }, [tabs, autoLoadSubtitles]);

    useEffect(() => {
        if (conversionQueue.length === 0) return;
        const batch = [...conversionQueue];
        setConversionQueue([]);
        const allFiles = tabs.flatMap(t => t.files);
        batch.forEach(key => {
            const file = allFiles.find(f => `${f.name}-${f.size}` === key);
            if (file) startConversion(file, key);
        });
    }, [conversionQueue, tabs, startConversion]);

    // Handlers
    const handleBatchUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files && event.target.files.length > 0) {
            const newFiles = Array.from(event.target.files);
            setTabs(prev => prev.map(t => {
                if (t.id === activeTabId) {
                    const combined = [...t.files];
                    newFiles.forEach(f => {
                         if (!combined.some(existing => existing.name === f.name && existing.size === f.size)) {
                             combined.push(f);
                         }
                    });
                    return { ...t, files: combined };
                }
                return t;
            }));

            const activeTab = tabs.find(t => t.id === activeTabId);
            const currentFiles = activeTab ? activeTab.files : [];
            const allFilesContext = [...currentFiles, ...newFiles]; 
            for (const f of newFiles) {
                if (f.type.startsWith('video') || f.name.match(/\.(mp4|mkv|webm|avi|mov|wmv)$/i)) {
                    await autoLoadSubtitles(allFilesContext, f);
                }
            }
        }
        event.target.value = '';
    };

    const handleAddTab = () => {
        const newId = crypto.randomUUID();
        const newName = `Playlist ${tabs.length + 1}`;
        setTabs(prev => [...prev, { id: newId, name: newName, files: [] }]);
        setActiveTabId(newId);
    };

    const handleRemoveTab = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (tabs.length <= 1) return; 
        if (confirm("Delete this playlist tab?")) {
            setTabs(prev => {
                const filtered = prev.filter(t => t.id !== id);
                return filtered;
            });
            if (activeTabId === id) {
                const remaining = tabs.filter(t => t.id !== id);
                if (remaining.length > 0) setActiveTabId(remaining[0].id);
            }
        }
    };

    const handleRenameTab = (id: string, newName: string) => {
        setTabs(prev => prev.map(t => t.id === id ? { ...t, name: newName } : t));
    };

    const handleReorderTabs = (fromIndex: number, toIndex: number) => {
        setTabs(prev => {
            const newTabs = [...prev];
            const [moved] = newTabs.splice(fromIndex, 1);
            newTabs.splice(toIndex, 0, moved);
            return newTabs;
        });
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
        setTabs(prev => prev.map(t => {
            if (t.id === activeTabId) {
                const newFiles = t.files.filter((_, i) => i !== index);
                return { ...t, files: newFiles };
            }
            return t;
        }));
    };

    const handleClearList = () => {
        if (confirm("Clear all videos in this playlist?")) {
            setTabs(prev => prev.map(t => {
                if (t.id === activeTabId) return { ...t, files: [] };
                return t;
            }));
        }
    };

    return {
        tabs, setTabs,
        activeTabId, setActiveTabId,
        videoStatuses, setVideoStatuses,
        draggedVideoIndex, setDraggedVideoIndex,
        isPlaylistLoaded,
        isConverting,
        conversionQueue,
        processingVideoKey: null, // This is managed in Subtitles hook actually
        
        getActiveFileList,
        handleBatchUpload,
        handleAddTab,
        handleRemoveTab,
        handleRenameTab,
        handleReorderTabs,
        handleQueueConversion,
        handleCancelConversion,
        handleDeleteVideo,
        handleClearList
    };
};
