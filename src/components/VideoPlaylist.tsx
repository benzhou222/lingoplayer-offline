
import React, { useRef, useState, useMemo } from 'react';
import { FolderOpen, Trash2, FileVideo, Hourglass, RefreshCw, Ban, Loader2, Sparkles, Plus, X, ListX } from 'lucide-react';
import { PlaylistTab } from '../types';

interface VideoPlaylistProps {
    show: boolean;
    tabs: PlaylistTab[];
    activeTabId: string;
    onSwitchTab: (id: string) => void;
    onAddTab: () => void;
    onRemoveTab: (e: React.MouseEvent, id: string) => void;
    onRenameTab: (id: string, newName: string) => void;
    onReorderTabs: (fromIndex: number, toIndex: number) => void;

    // List Props
    videoList: File[]; // Files of the active tab
    currentVideoFile: File | null;
    videoStatuses: Record<string, { converting: boolean, progress: number, done: boolean, queued?: boolean }>;
    draggedVideoIndex: number | null;
    processingVideoKey: string | null;
    onLoadVideo: (file: File) => void;
    onBatchUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
    onDeleteVideo: (e: React.MouseEvent, index: number) => void;
    onClearList: () => void;
    onConvert: (e: React.MouseEvent, file: File) => void;
    onCancelConversion: (e: React.MouseEvent, file: File) => void;
    onDragStart: (e: React.DragEvent<HTMLDivElement>, index: number) => void;
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
    onDrop: (e: React.DragEvent<HTMLDivElement>, index: number) => void;
    onDragEnd: () => void;
}

export const VideoPlaylist: React.FC<VideoPlaylistProps> = ({
    show,
    tabs,
    activeTabId,
    onSwitchTab,
    onAddTab,
    onRemoveTab,
    onRenameTab,
    onReorderTabs,

    videoList,
    currentVideoFile,
    videoStatuses,
    draggedVideoIndex,
    processingVideoKey,
    onLoadVideo,
    onBatchUpload,
    onDeleteVideo,
    onClearList,
    onConvert,
    onCancelConversion,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd
}) => {
    const listRef = useRef<HTMLDivElement>(null);
    const tabBarRef = useRef<HTMLDivElement>(null);
    const [editingTabId, setEditingTabId] = useState<string | null>(null);
    const [editName, setEditName] = useState("");
    const [draggingTabId, setDraggingTabId] = useState<string | null>(null);

    const processingTabId = useMemo(() => {
        if (!processingVideoKey) return null;
        return tabs.find(t => t.files.some(f => `${f.name}-${f.size}` === processingVideoKey))?.id;
    }, [processingVideoKey, tabs]);

    const handleListWheel = (e: React.WheelEvent) => {
        if (listRef.current && e.deltaY !== 0) {
            listRef.current.scrollLeft += e.deltaY;
        }
    };

    const handleTabBarWheel = (e: React.WheelEvent) => {
        if (tabBarRef.current && e.deltaY !== 0) {
            tabBarRef.current.scrollLeft += e.deltaY;
        }
    };

    const handleStartRename = (tab: PlaylistTab) => {
        setEditingTabId(tab.id);
        setEditName(tab.name);
    };

    const handleFinishRename = () => {
        if (editingTabId && editName.trim()) {
            onRenameTab(editingTabId, editName.trim());
        }
        setEditingTabId(null);
    };

    // Tab Drag Handlers
    const handleTabDragStart = (e: React.DragEvent, id: string) => {
        setDraggingTabId(id);
        // We use a custom string or just rely on state. 
        // Using internal state is simpler for same-component DnD.
        e.dataTransfer.effectAllowed = "move";
    };

    const handleTabDragOver = (e: React.DragEvent) => {
        e.preventDefault(); // Allow drop
        e.dataTransfer.dropEffect = "move";
    };

    const handleTabDrop = (e: React.DragEvent, targetId: string) => {
        e.preventDefault();
        if (draggingTabId && draggingTabId !== targetId) {
            const fromIndex = tabs.findIndex(t => t.id === draggingTabId);
            const toIndex = tabs.findIndex(t => t.id === targetId);
            if (fromIndex !== -1 && toIndex !== -1) {
                onReorderTabs(fromIndex, toIndex);
            }
        }
        setDraggingTabId(null);
    };

    if (!show) return null;

    return (
        <div className="h-44 bg-gray-950 border-b border-gray-800 flex flex-col flex-shrink-0 animate-in slide-in-from-top-2 duration-200">

            {/* TAB BAR */}
            <div
                ref={tabBarRef}
                onWheel={handleTabBarWheel}
                className="h-10 flex items-end bg-gray-900 border-b border-gray-800 overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']"
            >
                {tabs.map(tab => {
                    const isActive = tab.id === activeTabId;
                    const isProcessing = tab.id === processingTabId;
                    const isDragging = draggingTabId === tab.id;

                    return (
                        <div
                            key={tab.id}
                            draggable
                            onDragStart={(e) => handleTabDragStart(e, tab.id)}
                            onDragOver={handleTabDragOver}
                            onDrop={(e) => handleTabDrop(e, tab.id)}
                            onDragEnd={() => setDraggingTabId(null)}
                            onClick={() => onSwitchTab(tab.id)}
                            onDoubleClick={() => handleStartRename(tab)}
                            className={`group relative flex items-center justify-center min-w-[120px] h-full px-4 text-xs font-medium cursor-pointer select-none transition-all border-r border-gray-800 whitespace-nowrap flex-shrink-0 ${isActive
                                    ? 'bg-gray-950 text-blue-400 border-t-2 border-t-blue-500 border-b-gray-950 z-10'
                                    : 'bg-gray-900 text-gray-500 hover:bg-gray-800 hover:text-gray-300 border-t-2 border-t-transparent'
                                } ${isDragging ? 'opacity-40 border-dashed border-gray-500' : ''}`}
                            style={isActive ? { marginBottom: '-1px' } : {}}
                        >
                            {editingTabId === tab.id ? (
                                <input
                                    autoFocus
                                    className="bg-transparent text-white outline-none w-full text-center"
                                    value={editName}
                                    onChange={e => setEditName(e.target.value)}
                                    onBlur={handleFinishRename}
                                    onKeyDown={e => e.key === 'Enter' && handleFinishRename()}
                                    onClick={e => e.stopPropagation()}
                                />
                            ) : (
                                <div className="flex items-center gap-1.5 mr-2">
                                    {isProcessing && (
                                        <Loader2 size={10} className="animate-spin text-blue-400 flex-shrink-0" />
                                    )}
                                    <span>{tab.name}</span>
                                </div>
                            )}

                            {/* Close Tab Button */}
                            <button
                                onClick={(e) => onRemoveTab(e, tab.id)}
                                className={`p-1 rounded-full hover:bg-red-900/50 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity ${tabs.length === 1 ? 'hidden' : ''}`}
                            >
                                <X size={12} />
                            </button>
                        </div>
                    );
                })}

                {/* New Tab Button */}
                <button
                    onClick={onAddTab}
                    className="h-full px-3 hover:bg-gray-800 text-gray-500 hover:text-white transition-colors border-r border-gray-800 flex-shrink-0"
                    title="New Playlist Tab"
                >
                    <Plus size={16} />
                </button>
            </div>

            {/* CONTENT AREA */}
            <div className="flex-1 flex overflow-hidden">
                {/* Left Control Column - Actions for current tab */}
                <div className="w-14 border-r border-gray-800 flex flex-col items-center justify-center gap-4 bg-gray-900/50">
                    <label
                        className="p-2 text-gray-400 hover:text-green-400 hover:bg-gray-800 rounded-lg transition-colors cursor-pointer"
                        title="Add Videos to Current Tab"
                    >
                        <FolderOpen size={18} />
                        <input
                            type="file"
                            accept=".mp4,.mkv,.webm,.avi,.mov,.wmv"
                            multiple
                            onChange={onBatchUpload}
                            className="hidden"
                        />
                    </label>

                    <button
                        onClick={onClearList}
                        className="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-800 rounded-lg transition-colors"
                        title="Clear Current Playlist"
                    >
                        <ListX size={18} />
                    </button>
                </div>

                {/* List Area */}
                <div
                    ref={listRef}
                    onWheel={handleListWheel}
                    className="flex-1 p-3 overflow-x-auto flex gap-3 items-center bg-gray-950 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-800 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-gray-700"
                >
                    {videoList.length === 0 ? (
                        <div className="text-sm text-gray-600 italic pl-4 flex items-center gap-2 select-none">
                            <span>Empty playlist.</span>
                            <span className="text-gray-700 text-xs">(Drag files here or click folder)</span>
                        </div>
                    ) : (
                        videoList.map((file, idx) => {
                            const isCurrent = currentVideoFile && currentVideoFile.name === file.name && currentVideoFile.size === file.size;
                            const isMp4 = file.name.toLowerCase().endsWith('.mp4');
                            const key = `${file.name}-${file.size}`;
                            const status = videoStatuses[key] || { converting: false, progress: 0, done: false, queued: false };
                            const isConvertingOrQueued = status.converting || status.queued;

                            const isGeneratingSubtitles = processingVideoKey === key;

                            return (
                                <div
                                    key={key}
                                    draggable
                                    onDragStart={(e) => onDragStart(e, idx)}
                                    onDragOver={onDragOver}
                                    onDrop={(e) => onDrop(e, idx)}
                                    onDragEnd={onDragEnd}
                                    className={`flex-shrink-0 w-48 h-full rounded-lg border p-3 cursor-pointer transition-all flex flex-col justify-between group relative overflow-hidden ${isCurrent
                                        ? 'bg-blue-900/20 border-blue-500 shadow-lg shadow-blue-900/10'
                                        : 'bg-gray-900 border-gray-800'
                                        } ${draggedVideoIndex === idx ? 'opacity-40 border-dashed border-gray-600' : ''} ${isGeneratingSubtitles ? 'ring-1 ring-blue-400/50' : ''}`}
                                    onClick={() => onLoadVideo(file)}
                                >
                                    {isGeneratingSubtitles && (
                                        <div className="absolute inset-0 bg-blue-500/5 z-0 animate-pulse pointer-events-none" />
                                    )}

                                    <div className="flex items-center gap-2 mb-2 relative z-10 pointer-events-none">
                                        <div className={`p-1.5 rounded-md transition-colors ${isCurrent ? 'bg-blue-500 text-white' : 'bg-gray-800 text-gray-400'}`}>
                                            {isGeneratingSubtitles ? <Loader2 size={16} className="animate-spin text-blue-200" /> : <FileVideo size={16} />}
                                        </div>
                                        <div className="flex flex-col overflow-hidden">
                                            <span className={`text-[10px] font-bold uppercase tracking-wider ${isCurrent ? 'text-blue-400' : 'text-gray-500'}`}>
                                                {(file.size / (1024 * 1024)).toFixed(1)} MB
                                            </span>
                                            {isGeneratingSubtitles && (
                                                <span className="text-[9px] text-blue-300 font-medium flex items-center gap-1 animate-pulse">
                                                    <Sparkles size={8} /> Generating...
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <p className="text-xs font-medium line-clamp-2 leading-tight relative z-10 pointer-events-none text-gray-300 group-hover:text-white transition-colors">
                                        {file.name}
                                    </p>

                                    {/* Conversion Progress Bar (Bottom) */}
                                    {status.converting && (
                                        <div className="absolute bottom-0 left-0 w-full h-1 bg-gray-800 z-10">
                                            <div
                                                className="h-full bg-blue-500 transition-all duration-300"
                                                style={{ width: `${status.progress}%` }}
                                            />
                                        </div>
                                    )}

                                    {/* Actions Overlay */}
                                    <div className="absolute inset-0 z-20 pointer-events-none">
                                        <div
                                            className={`absolute top-2 right-2 flex gap-2 pointer-events-auto transition-opacity duration-200 ${isConvertingOrQueued ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                                            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                                            onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                                        >
                                            {/* Queued Indicator */}
                                            {status.queued && (
                                                <div className="text-yellow-400 bg-black/50 p-1.5 rounded-lg border border-yellow-500/30 backdrop-blur-md shadow-sm cursor-help" title="Waiting in queue">
                                                    <Hourglass size={14} className="animate-pulse" />
                                                </div>
                                            )}

                                            {/* Progress Percentage Display (Left of Cancel) */}
                                            {status.converting && (
                                                <div className="text-[10px] font-bold text-blue-400 bg-black/80 px-2 py-1.5 rounded-lg border border-blue-500/30 shadow-sm backdrop-blur-md cursor-default flex items-center">
                                                    {status.progress}%
                                                </div>
                                            )}

                                            {!isMp4 && !status.done && !status.converting && !status.queued && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); onConvert(e, file); }}
                                                    className="p-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg shadow-lg transform hover:scale-105 transition-all"
                                                    title="Convert to MP4"
                                                >
                                                    <RefreshCw size={14} />
                                                </button>
                                            )}

                                            {/* Cancel button */}
                                            {(status.converting || status.queued) ? (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); onCancelConversion(e, file); }}
                                                    className="p-1.5 bg-gray-700 hover:bg-gray-600 text-red-400 hover:text-red-300 rounded-lg shadow-lg transform hover:scale-105 transition-all border border-red-900/30"
                                                    title="Cancel"
                                                >
                                                    <Ban size={14} />
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); onDeleteVideo(e, idx); }}
                                                    className="p-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg shadow-lg transform hover:scale-105 transition-all"
                                                    title="Remove"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
};
