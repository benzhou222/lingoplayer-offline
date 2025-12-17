
import { useRef, useEffect } from 'react';

export const useKeyboardShortcuts = (
    player: any,
    handlePrevSentence: () => void,
    handleNextSentence: () => void
) => {
    const shortcutsRef = useRef({ 
        player, 
        handlePrevSentence, 
        handleNextSentence 
    });

    useEffect(() => {
        shortcutsRef.current = { 
            player, 
            handlePrevSentence, 
            handleNextSentence
        };
    });

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            // Disable shortcuts if typing in input/textarea/contenteditable
            if (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable) {
                return;
            }

            const { player, handlePrevSentence, handleNextSentence } = shortcutsRef.current;
            const rates = [0.3, 0.4, 0.5, 0.6, 0.75, 1.0, 1.25, 1.5, 2.0];

            switch (e.key.toLowerCase()) {
                case ' ':
                case 'k':
                    e.preventDefault();
                    player.togglePlayPause();
                    break;
                case 'a':
                    handlePrevSentence();
                    break;
                case 'd':
                    handleNextSentence();
                    break;
                case 'w':
                    const currW = player.playbackRate;
                    const indexW = rates.indexOf(currW);
                    let nextRate = rates[rates.length - 1];
                    if (indexW !== -1) {
                         nextRate = rates[Math.min(rates.length - 1, indexW + 1)];
                    } else {
                         const found = rates.find(r => r > currW);
                         if (found) nextRate = found;
                    }
                    player.handleRateChange(nextRate);
                    break;
                case 's':
                    const currS = player.playbackRate;
                    const indexS = rates.indexOf(currS);
                    let prevRate = rates[0];
                    if (indexS !== -1) {
                        prevRate = rates[Math.max(0, indexS - 1)];
                    } else {
                        const found = [...rates].reverse().find(r => r < currS);
                        if (found) prevRate = found;
                    }
                    player.handleRateChange(prevRate);
                    break;
                case 'q':
                    player.togglePlaybackMode();
                    break;
                case 'e':
                    player.toggleMute();
                    break;
                case ',':
                case '<':
                    player.stepFrame('prev');
                    break;
                case '.':
                case '>':
                    player.stepFrame('next');
                    break;
                case '-':
                case '_':
                    player.handleVolumeChange(Math.max(0, parseFloat((player.volume - 0.05).toFixed(2))));
                    break;
                case '=':
                case '+':
                    player.handleVolumeChange(Math.min(1, parseFloat((player.volume + 0.05).toFixed(2))));
                    break;
                case 'arrowleft':
                    if (player.videoRef.current) {
                        player.handleSeek(Math.max(0, player.videoRef.current.currentTime - 5));
                    }
                    break;
                case 'arrowright':
                    if (player.videoRef.current) {
                        player.handleSeek(Math.min(player.duration, player.videoRef.current.currentTime + 5));
                    }
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);
};
