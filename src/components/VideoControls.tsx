import React from 'react';
import {
  Play, Pause, Repeat, Repeat1,
  SkipBack, SkipForward, FastForward,
  Volume2, VolumeX, ChevronLeft, ChevronRight
} from 'lucide-react';
import { PlaybackMode } from '../types';

interface VideoControlsProps {
  isPlaying: boolean;
  onPlayPause: () => void;
  playbackMode: PlaybackMode;
  onToggleMode: () => void;
  playbackRate: number;
  onRateChange: (rate: number) => void;
  onPrevSentence: () => void;
  onNextSentence: () => void;
  onPrevFrame: () => void;
  onNextFrame: () => void;
  hasSubtitles: boolean;
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  volume: number;
  onVolumeChange: (val: number) => void;
  isMuted: boolean;
  onToggleMute: () => void;
}

const formatTime = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds * 1000) % 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
};

export const VideoControls: React.FC<VideoControlsProps> = ({
  isPlaying,
  onPlayPause,
  playbackMode,
  onToggleMode,
  playbackRate,
  onRateChange,
  onPrevSentence,
  onNextSentence,
  onPrevFrame,
  onNextFrame,
  hasSubtitles,
  currentTime,
  duration,
  onSeek,
  volume,
  onVolumeChange,
  isMuted,
  onToggleMute,
}) => {
  const rates = [0.3, 0.4, 0.5, 0.6, 0.75, 1.0, 1.25, 1.5, 2.0];

  return (
    <div className="bg-gray-900 border-t border-gray-800 p-4 flex flex-col gap-3 select-none">

      {/* Progress Bar */}
      <div className="flex items-center gap-3 text-xs text-gray-400 font-mono">
        <span className="min-w-[80px] text-right">{formatTime(currentTime)}</span>
        <input
          type="range"
          min={0}
          max={duration || 100}
          step={0.001} // Finer seek control
          value={currentTime}
          onChange={(e) => onSeek(parseFloat(e.target.value))}
          className="flex-1 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400 transition-all"
        />
        <span className="min-w-[80px]">{formatTime(duration)}</span>
      </div>

      {/* Controls Container - Split into 3 sections: Left (Loop), Center (Transport), Right (Speed) */}
      <div className="flex items-center justify-between gap-4">

        {/* 1. Far Left: Loop Mode */}
        <button
          onClick={onToggleMode}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${playbackMode === PlaybackMode.LOOP_SENTENCE
            ? 'bg-blue-900/50 border-blue-500 text-blue-200'
            : 'bg-transparent border-gray-700 text-gray-400 hover:text-white'
            }`}
          title={playbackMode === PlaybackMode.LOOP_SENTENCE ? "Looping Current Sentence (Q)" : "Continuous Play (Q)"}
        >
          {playbackMode === PlaybackMode.LOOP_SENTENCE ? <Repeat1 size={16} /> : <Repeat size={16} />}
          <span className="text-sm font-medium">
            {playbackMode === PlaybackMode.LOOP_SENTENCE ? 'Loop' : 'Cont.'}
          </span>
        </button>

        {/* 2. Center: Play/Prev/Next + Volume */}
        <div className="flex items-center gap-2 md:gap-4">

          {/* Frame Step Controls */}
          <div className="flex items-center gap-2 mr-2">
            <button
              onClick={onPrevFrame}
              className="p-2 text-gray-400 hover:text-white transition-colors"
              title="Previous Frame (<)"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              onClick={onNextFrame}
              className="p-2 text-gray-400 hover:text-white transition-colors"
              title="Next Frame (>)"
            >
              <ChevronRight size={20} />
            </button>
          </div>

          <button
            onClick={onPrevSentence}
            disabled={!hasSubtitles}
            className="p-2 text-gray-400 hover:text-white disabled:opacity-30 transition-colors"
            title="Previous Sentence (A)"
          >
            <SkipBack size={20} />
          </button>

          <button
            onClick={onPlayPause}
            className="p-4 bg-blue-600 rounded-full text-white hover:bg-blue-500 transition-colors shadow-lg shadow-blue-900/20"
            title={isPlaying ? "Pause (Space)" : "Play (Space)"}
          >
            {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
          </button>

          <button
            onClick={onNextSentence}
            disabled={!hasSubtitles}
            className="p-2 text-gray-400 hover:text-white disabled:opacity-30 transition-colors"
            title="Next Sentence (D)"
          >
            <SkipForward size={20} />
          </button>

          {/* Volume Control */}
          <div className="flex items-center gap-2 ml-1 md:ml-2">
            <button onClick={onToggleMute} className="text-gray-400 hover:text-white" title={isMuted ? "Unmute (E)" : "Mute (E)"}>
              {isMuted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
            <div className="w-20 flex items-center" title="Volume (- / =)">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                className="w-20 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-gray-400"
              />
            </div>
          </div>
        </div>

        {/* 3. Far Right: Speed Selector */}
        <div
          className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 rounded-lg px-3 py-1.5 transition-colors cursor-pointer relative group border border-gray-700 hover:border-gray-600"
          title="Playback Speed (S / W)"
        >
          <FastForward size={14} className="text-gray-400" />
          <select
            value={playbackRate}
            onChange={(e) => onRateChange(parseFloat(e.target.value))}
            className="bg-gray-800 text-sm font-medium text-gray-200 focus:outline-none appearance-none cursor-pointer text-center min-w-[32px] border-none"
          >
            {rates.map(r => (
              <option key={r} value={r} className="bg-gray-900 text-gray-200">{r}x</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};