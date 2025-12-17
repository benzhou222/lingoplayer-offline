import { useState, useRef, useEffect, useCallback } from 'react';
import { PlaybackMode } from '../types';

export const useVideoPlayer = () => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [playbackRate, setPlaybackRate] = useState(1.0);
    const [playbackMode, setPlaybackMode] = useState<PlaybackMode>(PlaybackMode.CONTINUOUS);
    const [volume, setVolume] = useState(1.0);
    const [isMuted, setIsMuted] = useState(false);

    // Sync playbackRate to DOM whenever it changes
    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.playbackRate = playbackRate;
        }
    }, [playbackRate]);

    // Apply Volume/Mute effects
    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.volume = volume;
            videoRef.current.muted = isMuted;
        }
    }, [volume, isMuted]);

    // Handlers
    const togglePlayPause = useCallback(() => {
        if (videoRef.current) {
            if (isPlaying) videoRef.current.pause();
            else videoRef.current.play();
            setIsPlaying(!isPlaying);
        }
    }, [isPlaying]);

    const handleSeek = useCallback((time: number) => {
        if (videoRef.current) {
            videoRef.current.currentTime = time;
            setCurrentTime(time);
        }
    }, []);

    const handleRateChange = useCallback((rate: number) => {
        setPlaybackRate(rate);
        // Direct update for immediate feedback
        if (videoRef.current) videoRef.current.playbackRate = rate;
    }, []);

    const handleVolumeChange = useCallback((newVolume: number) => {
        setVolume(newVolume);
        if (newVolume > 0 && isMuted) setIsMuted(false);
    }, [isMuted]);

    const toggleMute = useCallback(() => {
        setIsMuted(!isMuted);
    }, [isMuted]);

    const togglePlaybackMode = useCallback(() => {
        setPlaybackMode(m => m === PlaybackMode.CONTINUOUS ? PlaybackMode.LOOP_SENTENCE : PlaybackMode.CONTINUOUS);
    }, []);

    const handleLoadedMetadata = useCallback(() => {
        if (videoRef.current) {
            setDuration(videoRef.current.duration);
            // CRITICAL FIX: Restore playback rate as loading a new source resets it to 1.0
            videoRef.current.playbackRate = playbackRate;
        }
    }, [playbackRate]);

    const stepFrame = useCallback((direction: 'prev' | 'next') => {
        if (videoRef.current) {
            videoRef.current.pause();
            setIsPlaying(false);
            const delta = 0.042; // Approx 1 frame at 24fps
            const newTime = direction === 'next'
                ? Math.min(duration, videoRef.current.currentTime + delta)
                : Math.max(0, videoRef.current.currentTime - delta);
            handleSeek(newTime);
        }
    }, [duration, handleSeek]);

    return {
        videoRef,
        isPlaying, setIsPlaying,
        currentTime, setCurrentTime,
        duration, setDuration,
        playbackRate, setPlaybackRate,
        playbackMode, setPlaybackMode,
        volume, setVolume,
        isMuted, setIsMuted,
        togglePlayPause,
        handleSeek,
        handleRateChange,
        handleVolumeChange,
        toggleMute,
        togglePlaybackMode,
        handleLoadedMetadata,
        stepFrame
    };
};
