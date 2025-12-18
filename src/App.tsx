
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, BookOpen, Settings, GripHorizontal, LayoutList, AlertCircle, Trash2, Download, FileUp } from 'lucide-react';
import { segmentsToSRT, segmentsToVTT } from './utils/subtitleUtils';
import { saveFullPlaylistToDB } from './utils/storageUtils';

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
import { useVocabulary } from './hooks/useVocabulary';
import { useSubtitles } from './hooks/useSubtitles';
import { usePlaylist } from './hooks/usePlaylist';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

export default function App() {
    const settings = useAppSettings();
    const layout = useResizableLayout();
    const player = useVideoPlayer();

    const [videoSrc, setVideoSrc] = useState<string | null>(null);
    const [videoFile, setVideoFile] = useState<File | null>(null);
    const pendingSeekTimeRef = useRef<number | null>(null);

    const vocab = useVocabulary(settings, player);
    const subs = useSubtitles(player, videoFile, settings);
    const playlist = usePlaylist(
        (subtitlesMap, progressMap) => {
            subs.setVideoSubtitlesMap(subtitlesMap);
            subs.setPlaybackProgressMap(progressMap);
        },
        subs.autoLoadSubtitles
    );

    // 修复：传入 handleManualSeek 确保方向键快进退能正常重置字幕锁定逻辑
    useKeyboardShortcuts(player, subs.handlePrevSentence, subs.handleNextSentence, subs.handleManualSeek);

    useEffect(() => {
        if (playlist.isPlaylistLoaded) {
            const timer = setTimeout(() => {
                const tabsStruct = playlist.tabs.map(t => ({ id: t.id, name: t.name }));
                localStorage.setItem('lingo_playlist_tabs', JSON.stringify(tabsStruct));
                localStorage.setItem('lingo_active_tab', playlist.activeTabId);
                const allFiles = playlist.tabs.flatMap(t => t.files.map(f => ({ file: f, tabId: t.id, tabName: t.name })));
                saveFullPlaylistToDB(allFiles, subs.videoSubtitlesMap, subs.playbackProgressMap).catch(() => { });
            }, 1000);
            return () => clearTimeout(timer);
        }
    }, [playlist.tabs, subs.videoSubtitlesMap, subs.playbackProgressMap, playlist.isPlaylistLoaded, playlist.activeTabId]);

    const loadVideoFromFile = useCallback(async (file: File) => {
        const isElectron = !!window.electron?.isElectron;
        const filePath = (file as any).path;
        if ((file as any).isPlaceholder && (!isElectron || !filePath)) {
            alert(`Due to browser security, please re-select or drag-and-drop "${file.name}" to play it.`);
            return;
        }

        const key = `${file.name}-${file.size}`;
        player.setCurrentTime(0); player.setDuration(0); player.setIsPlaying(false);
        subs.setErrorMsg(null); subs.setCurrentSegmentIndex(-1);
        subs.audioDataCacheRef.current = null; subs.lockStateRef.current = null;

        const savedTime = subs.playbackProgressMap[key] || 0;
        pendingSeekTimeRef.current = savedTime > 0 ? savedTime : null;
        setVideoFile(file);

        if (isElectron && filePath) {
            setVideoSrc(`file://${encodeURI(filePath.replace(/\\/g, '/'))}`);
        } else {
            setVideoSrc(URL.createObjectURL(file));
        }

        setTimeout(() => { if (player.videoRef.current) { player.videoRef.current.play().catch(() => { }); player.setIsPlaying(true); } }, 100);
        subs.setSubtitles(subs.videoSubtitlesMap[key] || []);
    }, [player, subs]);

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]; if (!file) return;
        playlist.setTabs(prev => prev.map(t => t.id === playlist.activeTabId ? { ...t, files: t.files.some(f => f.name === file.name) ? t.files : [...t.files, file] } : t));
        setShowVideoList(true);
        await subs.autoLoadSubtitles([...playlist.getActiveFileList(), file], file);
        loadVideoFromFile(file);
        event.target.value = '';
    };

    const handleLoadedMetadata = () => {
        player.handleLoadedMetadata();
        if (player.videoRef.current && pendingSeekTimeRef.current !== null) {
            const t = Math.min(pendingSeekTimeRef.current, player.videoRef.current.duration);
            player.videoRef.current.currentTime = t; player.setCurrentTime(t); pendingSeekTimeRef.current = null;
        }
    };

    const [showVideoList, setShowVideoList] = useState(true);
    const isProcessingCurrent = videoFile && subs.processingVideoKey === `${videoFile.name}-${videoFile.size}`;

    return (
        <div className="flex h-screen bg-black text-gray-100 font-sans overflow-hidden relative">
            <SettingsModal isOpen={settings.isSettingsOpen} onClose={() => settings.setIsSettingsOpen(false)} {...settings} OFFLINE_MODELS={OFFLINE_MODELS} />
            <SubtitlePanel width={layout.leftPanelWidth} subtitles={subs.subtitles} currentSegmentIndex={subs.currentSegmentIndex} isProcessing={!!isProcessingCurrent} isAnyProcessing={!!subs.processingVideoKey} isOffline={settings.isOffline} videoSrc={videoSrc} isConverting={playlist.isConverting} onGenerate={() => subs.handleGenerate(false)} onImport={subs.handleSubtitleImport} onExport={(f) => { if (subs.subtitles.length === 0) return; const content = f === 'srt' ? segmentsToSRT(subs.subtitles) : segmentsToVTT(subs.subtitles); const blob = new Blob([content], { type: 'text/plain' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${videoFile?.name.replace(/\.[^/.]+$/, "") || "sub"}.${f}`; a.click(); }} editingSegmentIndex={subs.editingSegmentIndex} editText={subs.editText} editStart={subs.editStart} editEnd={subs.editEnd} onStartEdit={subs.startEditing} onSaveEdit={subs.saveEdit} onCancelEdit={subs.cancelEdit} setEditText={subs.setEditText} setEditStart={subs.setEditStart} setEditEnd={subs.setEditEnd} onDelete={subs.deleteSubtitle} onJumpTo={subs.jumpToSegment} currentTime={player.currentTime} formatTime={subs.formatTime} />
            <div onMouseDown={layout.startResizingLeft} className="w-1 cursor-col-resize bg-gray-800 hover:bg-blue-500 transition-colors z-20 flex-shrink-0 hidden md:block" />
            <div className="flex-1 flex flex-col min-w-0 bg-gray-900 relative">
                <div className="h-16 flex items-center justify-between px-6 bg-gray-900 border-b border-gray-800 flex-shrink-0">
                    <div className="flex items-center gap-4"><h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">LingoPlayer AI</h1></div>
                    <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-sm font-medium rounded-lg cursor-pointer transition-colors border border-gray-700"><Upload size={16} /><span>Load Video</span><input type="file" accept=".mp4,.mkv,.webm,.avi,.mov,.wmv" onChange={handleFileChange} className="hidden" /></label>
                        <button onClick={() => setShowVideoList(!showVideoList)} className={`p-2 rounded-lg transition-colors ${showVideoList ? 'text-blue-400 bg-blue-900/20' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}><LayoutList size={20} /></button>
                        <div className="w-px h-6 bg-gray-800 mx-1"></div>
                        <button onClick={() => settings.setIsSettingsOpen(true)} className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"><Settings size={20} /></button>
                        <button onClick={() => vocab.setShowVocabSidebar(!vocab.showVocabSidebar)} className={`p-2 rounded-lg transition-colors ${vocab.showVocabSidebar ? 'text-blue-400 bg-blue-900/20' : 'text-gray-400 hover:text-white'}`}><BookOpen size={20} /></button>
                    </div>
                </div>
                <VideoPlaylist show={showVideoList} tabs={playlist.tabs} activeTabId={playlist.activeTabId} onSwitchTab={playlist.setActiveTabId} onAddTab={playlist.handleAddTab} onRemoveTab={playlist.handleRemoveTab} onRenameTab={playlist.handleRenameTab} onReorderTabs={playlist.handleReorderTabs} videoList={playlist.getActiveFileList()} currentVideoFile={videoFile} videoStatuses={playlist.videoStatuses} draggedVideoIndex={playlist.draggedVideoIndex} processingVideoKey={subs.processingVideoKey} onLoadVideo={loadVideoFromFile} onBatchUpload={playlist.handleBatchUpload} onDeleteVideo={playlist.handleDeleteVideo} onClearList={playlist.handleClearList} onConvert={playlist.handleQueueConversion} onCancelConversion={(e, f) => { e.stopPropagation(); playlist.handleCancelConversion(`${f.name}-${f.size}`); }} onDragStart={(e, i) => playlist.setDraggedVideoIndex(i)} onDragOver={(e) => e.preventDefault()} onDrop={(e, i) => { e.preventDefault(); if (playlist.draggedVideoIndex === null) return; playlist.setTabs(prev => prev.map(t => t.id === playlist.activeTabId ? { ...t, files: (() => { const nl = [...t.files]; const [m] = nl.splice(playlist.draggedVideoIndex!, 1); nl.splice(i, 0, m); return nl; })() } : t)); playlist.setDraggedVideoIndex(null); }} onDragEnd={() => playlist.setDraggedVideoIndex(null)} />
                <div className="flex-1 flex flex-col overflow-hidden">
                    <div style={{ height: layout.videoHeight }} className="bg-black flex items-center justify-center relative flex-shrink-0">{videoSrc ? (<video ref={player.videoRef} src={videoSrc} className="w-full h-full object-contain" onClick={player.togglePlayPause} onLoadedMetadata={handleLoadedMetadata} onEnded={() => player.setIsPlaying(false)} onError={() => !subs.errorMsg && subs.setErrorMsg("Playback Error.")} playsInline />) : (<label className="text-gray-600 flex flex-col items-center cursor-pointer hover:text-gray-400 transition-colors"><Upload size={48} className="mb-4 opacity-50" /><p className="font-medium text-lg">Click to Load Video</p><input type="file" accept=".mp4,.mkv,.webm,.avi,.mov,.wmv" onChange={handleFileChange} className="hidden" /></label>)}</div>
                    <div onMouseDown={layout.startResizingVideo} className="h-1 cursor-row-resize bg-gray-800 hover:bg-blue-500 transition-colors z-20 flex-shrink-0 flex items-center justify-center group"><GripHorizontal size={12} className="text-gray-600 opacity-0 group-hover:opacity-100" /></div>
                    <div style={{ height: layout.subtitleHeight }} className="bg-gray-900 p-6 text-center flex flex-col items-center justify-center flex-shrink-0 overflow-y-auto">{isProcessingCurrent && subs.subtitles.length === 0 ? (<div className="flex flex-col items-center justify-center gap-2 animate-pulse"><span className="text-blue-400 text-sm font-medium">Analyzing...</span></div>) : subs.errorMsg ? (<div className="flex items-center gap-2 text-red-400 text-sm bg-red-900/20 px-4 py-2 rounded"><AlertCircle size={16} /><span>{subs.errorMsg}</span></div>) : null}{subs.currentSegmentIndex !== -1 && subs.subtitles[subs.currentSegmentIndex] && (<div className="animate-in fade-in slide-in-from-bottom-2 duration-200 w-full flex justify-center"><p className="text-xl md:text-2xl font-medium text-white leading-relaxed max-w-3xl text-center">{subs.subtitles[subs.currentSegmentIndex].text.split(' ').map((word, i) => (<React.Fragment key={i}> <span onClick={(e) => { e.stopPropagation(); vocab.handleWordClick(word, subs.subtitles[subs.currentSegmentIndex].text); }} className="cursor-pointer hover:text-blue-400 select-none inline-block hover:underline decoration-blue-500/50 underline-offset-4 transition-colors"> {word} </span> {' '} </React.Fragment>))}</p></div>)}</div>
                    <div onMouseDown={layout.startResizingSubtitle} className="h-1 cursor-row-resize bg-gray-800 hover:bg-blue-500 transition-colors z-20 flex-shrink-0 flex items-center justify-center group"><GripHorizontal size={12} className="text-gray-600 opacity-0 group-hover:opacity-100" /></div>
                    <div className="flex-1 min-h-0 bg-gray-950 overflow-hidden flex flex-col"><WordDefinitionPanel definition={vocab.selectedWord} onAddToVocab={vocab.addToVocab} isSaved={vocab.selectedWord ? vocab.vocabulary.some(v => v.word === vocab.selectedWord!.word) : false} isLoading={vocab.loadingWord} onWordSearch={(word) => vocab.handleWordClick(word, "")} /></div>
                </div>
                <VideoControls isPlaying={player.isPlaying} onPlayPause={player.togglePlayPause} playbackMode={player.playbackMode} onToggleMode={player.togglePlaybackMode} playbackRate={player.playbackRate} onRateChange={player.handleRateChange} onPrevSentence={subs.handlePrevSentence} onNextSentence={subs.handleNextSentence} onPrevFrame={() => player.stepFrame('prev')} onNextFrame={() => player.stepFrame('next')} hasSubtitles={subs.subtitles.length > 0} currentTime={player.currentTime} duration={player.duration} onSeek={subs.handleManualSeek} volume={player.volume} onVolumeChange={player.handleVolumeChange} isMuted={player.isMuted} onToggleMute={player.toggleMute} />
            </div>
            <div onMouseDown={layout.startResizingRight} className="w-1 cursor-col-resize bg-gray-800 hover:bg-blue-500 transition-colors z-20 flex-shrink-0 hidden md:block" />
            {vocab.showVocabSidebar && (<div style={{ width: layout.rightPanelWidth }} className="bg-gray-950 border-l border-gray-800 flex flex-col flex-shrink-0 hidden md:flex"><div className="p-4 border-b border-gray-800 bg-gray-900/50 flex items-center justify-between"><div className="flex items-center gap-2"><BookOpen className="text-blue-500" /><h2 className="font-bold text-lg">Vocabulary</h2></div><div className="flex items-center gap-1"><label className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors cursor-pointer" title="Import JSON"><FileUp size={16} /><input type="file" accept=".json" onChange={vocab.handleImportVocab} className="hidden" /></label><button onClick={vocab.handleExportVocab} className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors" title="Export JSON"><Download size={16} /></button></div></div><div className="flex-1 overflow-y-auto p-0">{vocab.vocabulary.length === 0 ? (<div className="p-8 text-center text-gray-500 text-sm opacity-60"><p>No words saved yet.</p></div>) : (vocab.vocabulary.map((item) => (<div key={item.id} onClick={() => { vocab.setSelectedWord(item); if (player.videoRef.current && player.isPlaying) { player.videoRef.current.pause(); player.setIsPlaying(false); } }} className="p-4 border-b border-gray-800 group hover:bg-gray-900 cursor-pointer transition-colors"><div className="flex justify-between items-start mb-1"><span className="font-bold text-white text-lg">{item.word}</span><button onClick={(e) => { e.stopPropagation(); vocab.setVocabulary(v => v.filter(i => i.id !== item.id)); }} className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-1"><Trash2 size={16} /></button></div><p className="text-sm text-gray-400 line-clamp-2">{item.meaning}</p></div>)))}</div></div>)}
        </div>
    );
}
