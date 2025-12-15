import React, { useEffect, useRef } from 'react';
import { ListVideo, WifiOff, Wifi, Square, PlayCircle, FileUp, FileDown, Edit3, Trash2, Clock, AlertCircle } from 'lucide-react';
import { SubtitleSegment } from '../types';

interface SubtitlePanelProps {
    width: number;
    subtitles: SubtitleSegment[];
    currentSegmentIndex: number;
    isProcessing: boolean;
    isAnyProcessing: boolean;
    isOffline: boolean;
    setIsOffline: (val: boolean) => void;
    videoSrc: string | null;
    isConverting: boolean;
    onGenerate: () => void;
    onImport: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onExport: (format: 'srt' | 'vtt') => void;

    // Editing
    editingSegmentIndex: number;
    editText: string;
    editStart: string;
    editEnd: string;
    onStartEdit: (index: number, text: string, start: number, end: number) => void;
    onSaveEdit: () => void;
    onCancelEdit: () => void;
    setEditText: (s: string) => void;
    setEditStart: (s: string) => void;
    setEditEnd: (s: string) => void;
    onDelete: (e: React.MouseEvent, index: number) => void;
    onJumpTo: (index: number) => void;
    currentTime: number;
    formatTime: (s: number) => string;
}

export const SubtitlePanel: React.FC<SubtitlePanelProps> = ({
    width, subtitles, currentSegmentIndex, isProcessing, isAnyProcessing, isOffline, setIsOffline,
    videoSrc, isConverting, onGenerate, onImport, onExport,
    editingSegmentIndex, editText, editStart, editEnd,
    onStartEdit, onSaveEdit, onCancelEdit, setEditText, setEditStart, setEditEnd,
    onDelete, onJumpTo, currentTime, formatTime
}) => {
    const subtitleListRef = useRef<HTMLDivElement>(null);

    // Auto-scroll effect
    useEffect(() => {
        if (currentSegmentIndex >= 0 && subtitleListRef.current && editingSegmentIndex === -1) {
            const activeElement = document.getElementById(`subtitle-segment-${currentSegmentIndex}`);
            if (activeElement) {
                const container = subtitleListRef.current;
                const elementTop = activeElement.offsetTop;
                const elementHeight = activeElement.clientHeight;
                const containerHeight = container.clientHeight;

                // Calculate center position
                const targetScrollTop = elementTop - (containerHeight / 2) + (elementHeight / 2);

                container.scrollTo({
                    top: targetScrollTop,
                    behavior: 'smooth'
                });
            }
        }
    }, [currentSegmentIndex, editingSegmentIndex]);

    const isGenerateDisabled = !videoSrc || (isAnyProcessing && !isProcessing);
    const generateButtonTitle = !videoSrc
        ? "Load a video first"
        : (isAnyProcessing && !isProcessing)
            ? "Another video is currently generating subtitles. Please wait."
            : "";

    return (
        <div
            style={{ width }}
            className="bg-gray-950 border-r border-gray-800 flex flex-col flex-shrink-0 hidden md:flex transition-none relative"
        >
            <div className="p-4 border-b border-gray-800 bg-gray-900/50">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <ListVideo className="text-blue-500" />
                        <h2 className="font-bold text-lg">Transcript</h2>
                    </div>
                    <button
                        onClick={() => setIsOffline(!isOffline)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${isOffline ? 'bg-green-900/20 border-green-800 text-green-400' : 'bg-blue-900/20 border-blue-800 text-blue-400'}`}
                    >
                        {isOffline ? <WifiOff size={14} /> : <Wifi size={14} />}
                        <span>{isOffline ? 'Offline' : 'Online'}</span>
                    </button>
                </div>

                {/* GENERATE / IMPORT / EXPORT TOOLBAR */}
                <div className="grid grid-cols-2 gap-2 mb-2">
                    <button
                        onClick={onGenerate}
                        disabled={isGenerateDisabled}
                        title={generateButtonTitle}
                        className={`flex items-center justify-center gap-2 py-2 px-3 text-xs font-bold rounded transition-colors ${isProcessing
                                ? 'bg-red-600 hover:bg-red-500 text-white'
                                : isGenerateDisabled
                                    ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                                    : 'bg-blue-600 hover:bg-blue-500 text-white'
                            }`}
                    >
                        {isProcessing ? <Square size={14} fill="currentColor" /> : <PlayCircle size={14} />}
                        <span>{isProcessing ? 'Stop' : 'Generate'}</span>
                    </button>

                    <label className="flex items-center justify-center gap-2 py-2 px-3 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-bold rounded cursor-pointer border border-gray-700 transition-colors">
                        <FileUp size={14} />
                        <span>Import</span>
                        <input type="file" accept=".srt,.vtt" onChange={onImport} className="hidden" />
                    </label>
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={() => onExport('srt')}
                        disabled={subtitles.length === 0}
                        className="flex-1 flex items-center justify-center gap-2 py-1.5 px-3 bg-gray-900/50 hover:bg-gray-800 text-gray-400 hover:text-white text-[10px] font-bold rounded border border-gray-800 disabled:opacity-30 transition-colors"
                    >
                        <FileDown size={12} /> SRT
                    </button>
                    <button
                        onClick={() => onExport('vtt')}
                        disabled={subtitles.length === 0}
                        className="flex-1 flex items-center justify-center gap-2 py-1.5 px-3 bg-gray-900/50 hover:bg-gray-800 text-gray-400 hover:text-white text-[10px] font-bold rounded border border-gray-800 disabled:opacity-30 transition-colors"
                    >
                        <FileDown size={12} /> VTT
                    </button>
                </div>
            </div>

            <div
                ref={subtitleListRef}
                className="flex-1 overflow-y-auto p-0 scroll-smooth relative"
            >
                {subtitles.length === 0 && isProcessing ? (
                    <div className="p-8 flex flex-col items-center gap-3 text-gray-500 text-sm">
                        <div className="w-5 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                        <span>Generating subtitles...</span>
                    </div>
                ) : subtitles.length === 0 && !isProcessing ? (
                    <div className="p-8 text-center text-gray-500 text-sm opacity-60">
                        {videoSrc ? "Generate or Import subtitles to start." : "Load a video to start."}
                    </div>
                ) : (
                    subtitles.map((sub, idx) => {
                        const isEditing = editingSegmentIndex === idx;
                        const isActive = currentSegmentIndex === idx;

                        return (
                            <div
                                key={sub.id}
                                id={`subtitle-segment-${idx}`}
                                onClick={() => onJumpTo(idx)}
                                className={`group p-4 border-b border-gray-800 transition-all duration-200 hover:bg-gray-800 relative ${isActive
                                    ? 'bg-blue-900/30 border-l-4 border-l-blue-500'
                                    : 'border-l-4 border-l-transparent text-gray-400'
                                    }`}
                            >
                                <div className="flex justify-between mb-1">
                                    <span className="text-xs text-gray-500 font-mono">{formatTime(sub.start)}</span>
                                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        {!isEditing && (
                                            <>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); onStartEdit(idx, sub.text, sub.start, sub.end); }}
                                                    className="text-gray-500 hover:text-blue-400 p-1 rounded hover:bg-gray-700"
                                                    title="Edit text"
                                                >
                                                    <Edit3 size={12} />
                                                </button>
                                                <button
                                                    onClick={(e) => onDelete(e, idx)}
                                                    className="text-gray-500 hover:text-red-400 p-1 rounded hover:bg-gray-700"
                                                    title="Delete line"
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {isEditing ? (
                                    <div className="mt-1 space-y-2" id={`subtitle-edit-container-${idx}`}>
                                        <div className="flex gap-2">
                                            <div className="flex-1 flex gap-1">
                                                <div className="flex-1">
                                                    <label className="text-[10px] text-gray-500 block mb-0.5">Start</label>
                                                    <div className="flex gap-1">
                                                        <input
                                                            type="text"
                                                            value={editStart}
                                                            onChange={(e) => setEditStart(e.target.value)}
                                                            className="w-full bg-gray-900 text-white text-xs p-1 rounded border border-gray-700 focus:border-blue-500 outline-none"
                                                            placeholder="00:00:00.000"
                                                        />
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setEditStart(formatTime(currentTime)); }}
                                                            className="px-2 bg-gray-800 border border-gray-700 rounded hover:bg-gray-700 text-gray-400 hover:text-blue-400 transition-colors"
                                                            title="Use current video time"
                                                        >
                                                            <Clock size={12} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex-1 flex gap-1">
                                                <div className="flex-1">
                                                    <label className="text-[10px] text-gray-500 block mb-0.5">End</label>
                                                    <div className="flex gap-1">
                                                        <input
                                                            type="text"
                                                            value={editEnd}
                                                            onChange={(e) => setEditEnd(e.target.value)}
                                                            className="w-full bg-gray-900 text-white text-xs p-1 rounded border border-gray-700 focus:border-blue-500 outline-none"
                                                            placeholder="00:00:00.000"
                                                        />
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setEditEnd(formatTime(currentTime)); }}
                                                            className="px-2 bg-gray-800 border border-gray-700 rounded hover:bg-gray-700 text-gray-400 hover:text-blue-400 transition-colors"
                                                            title="Use current video time"
                                                        >
                                                            <Clock size={12} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <textarea
                                            autoFocus
                                            value={editText}
                                            onChange={(e) => setEditText(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && !e.shiftKey) {
                                                    e.preventDefault();
                                                    onSaveEdit();
                                                } else if (e.key === 'Escape') {
                                                    onCancelEdit();
                                                }
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                            className="w-full bg-gray-900 text-white text-sm p-2 rounded border border-blue-500 focus:outline-none resize-none"
                                            rows={Math.max(2, Math.ceil(editText.length / 40))}
                                        />
                                        <div className="flex justify-end gap-2 mt-1">
                                            <button onClick={(e) => { e.stopPropagation(); onCancelEdit(); }} className="text-[10px] bg-gray-700 px-2 py-0.5 rounded text-white hover:bg-gray-600">Cancel</button>
                                            <button onClick={(e) => { e.stopPropagation(); onSaveEdit(); }} className="text-[10px] bg-blue-600 px-2 py-0.5 rounded text-white hover:bg-blue-500">Save</button>
                                        </div>
                                    </div>
                                ) : (
                                    <p
                                        onDoubleClick={(e) => { e.stopPropagation(); onStartEdit(idx, sub.text, sub.start, sub.end); }}
                                        className={`text-sm leading-relaxed ${isActive ? 'text-white' : 'text-gray-400'}`}
                                    >
                                        {sub.text}
                                    </p>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};