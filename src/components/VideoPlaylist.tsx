import React, { useRef } from 'react';
import { FolderOpen, Trash2, FileVideo, Hourglass, RefreshCw, Ban, Loader2, Sparkles } from 'lucide-react';

interface VideoPlaylistProps {
    show: boolean;
    videoList: File[];
    currentVideoFile: File | null;
    videoStatuses: Record<string, { converting: boolean, progress: number, done: boolean, queued?: boolean }>;
    draggedVideoIndex: number | null;
    processingVideoKey: string | null;
    onLoadVideo: (file: File) => void;
    onBatchUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
    onClearList: () => void;
    onDelete: (e: React.MouseEvent, index: number) => void;
    onConvert: (e: React.MouseEvent, file: File) => void;
    onCancelConversion: (e: React.MouseEvent, file: File) => void;
    onDragStart: (e: React.DragEvent<HTMLDivElement>, index: number) => void;
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
    onDrop: (e: React.DragEvent<HTMLDivElement>, index: number) => void;
    onDragEnd: () => void;
}

export const VideoPlaylist: React.FC<VideoPlaylistProps> = ({
    show,
    videoList,
    currentVideoFile,
    videoStatuses,
    draggedVideoIndex,
    processingVideoKey,
    onLoadVideo,
    onBatchUpload,
    onClearList,
    onDelete,
    onConvert,
    onCancelConversion,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd
}) => {
    const listRef = useRef<HTMLDivElement>(null);

    const handleWheel = (e: React.WheelEvent) => {
        if (listRef.current && e.deltaY !== 0) {
            listRef.current.scrollLeft += e.deltaY;
        }
    };

    if (!show) return null;

    return (
        <div className="h-32 bg-gray-950 border-b border-gray-800 flex flex-shrink-0 animate-in slide-in-from-top-2 duration-200">
            {/* Left Control Column */}
            <div className="w-14 border-r border-gray-800 flex flex-col items-center py-3 gap-3 bg-gray-900/50">
                <label
                    className="p-2 text-gray-400 hover:text-green-400 hover:bg-gray-800 rounded-lg transition-colors cursor-pointer"
                    title="Add Videos to List"
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
                    title="Clear List"
                >
                    <Trash2 size={18} />
                </button>
            </div>

            {/* List Area */}
            <div
                ref={listRef}
                onWheel={handleWheel}
                className="flex-1 p-3 overflow-x-auto flex gap-3 items-center scrollbar-hide"
            >
                {videoList.length === 0 ? (
                    <div className="text-sm text-gray-500 italic pl-2">No videos in list. Click folder icon to add.</div>
                ) : (
                    videoList.map((file, idx) => {
                        const isCurrent = currentVideoFile && currentVideoFile.name === file.name && currentVideoFile.size === file.size;
                        const isMp4 = file.name.toLowerCase().endsWith('.mp4');
                        const key = `${file.name}-${file.size}`;
                        const status = videoStatuses[key] || { converting: false, progress: 0, done: false, queued: false };
                        const isConvertingOrQueued = status.converting || status.queued;
                        
                        // Check if this specific video is the one generating subtitles
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
                                                onClick={(e) => { e.stopPropagation(); e.preventDefault(); onDelete(e, idx); }}
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
    );
};