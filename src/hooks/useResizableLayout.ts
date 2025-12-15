import { useState, useRef, useCallback, useEffect } from 'react';

export const useResizableLayout = () => {
    const [leftPanelWidth, setLeftPanelWidth] = useState(320);
    const [rightPanelWidth, setRightPanelWidth] = useState(320);
    const [videoHeight, setVideoHeight] = useState(450);
    const [subtitleHeight, setSubtitleHeight] = useState(200);

    const isResizingLeft = useRef(false);
    const isResizingRight = useRef(false);
    const isResizingVideo = useRef(false);
    const isResizingSubtitle = useRef(false);

    const startResizingLeft = useCallback(() => { isResizingLeft.current = true; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; }, []);
    const startResizingRight = useCallback(() => { isResizingRight.current = true; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; }, []);
    const startResizingVideo = useCallback(() => { isResizingVideo.current = true; document.body.style.cursor = 'row-resize'; document.body.style.userSelect = 'none'; }, []);
    const startResizingSubtitle = useCallback(() => { isResizingSubtitle.current = true; document.body.style.cursor = 'row-resize'; document.body.style.userSelect = 'none'; }, []);

    const stopResizing = useCallback(() => {
        isResizingLeft.current = false;
        isResizingRight.current = false;
        isResizingVideo.current = false;
        isResizingSubtitle.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }, []);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        const CHROME_HEIGHT = 250;
        const availableHeight = windowHeight - CHROME_HEIGHT;

        if (isResizingLeft.current) setLeftPanelWidth(Math.max(250, Math.min(e.clientX, windowWidth * 0.4)));
        if (isResizingRight.current) setRightPanelWidth(Math.max(250, Math.min(windowWidth - e.clientX, windowWidth * 0.4)));
        if (isResizingVideo.current) setVideoHeight(Math.min(Math.max(200, videoHeight + e.movementY), Math.max(200, availableHeight - subtitleHeight - 150)));
        if (isResizingSubtitle.current) setSubtitleHeight(Math.min(Math.max(100, subtitleHeight + e.movementY), Math.max(100, availableHeight - videoHeight - 150)));
    }, [videoHeight, subtitleHeight]);

    useEffect(() => {
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', stopResizing);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', stopResizing);
        };
    }, [handleMouseMove, stopResizing]);

    return {
        leftPanelWidth, rightPanelWidth, videoHeight, subtitleHeight,
        startResizingLeft, startResizingRight, startResizingVideo, startResizingSubtitle
    };
};