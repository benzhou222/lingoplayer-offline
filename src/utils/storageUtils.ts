
import { SubtitleSegment, PlaylistTab } from "../types";

const DB_NAME = 'LingoPlayerDB';
const DB_VERSION = 3;
const STORE_NAME = 'playlist_rich';

// Schema for rich persistence
export interface PlaylistEntry {
    name: string;
    size: number;
    type: string;
    path: string | null;
    lastModified: number;
    progress: number;
    subtitles: SubtitleSegment[];
    tabId?: string;
    tabName?: string;
}

const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: ['name', 'size'] });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

// We save flattened files with their Tab ID. 
// Note: We deliberately do NOT save the File object (Blob) to IDB to keep it lightweight.
// We only save metadata. On Web, files will be placeholders on reload. On Electron, 'path' is used.
export const saveFullPlaylistToDB = async (
    allFilesAcrossTabs: { file: File, tabId: string, tabName: string }[],
    subtitlesMap: Record<string, SubtitleSegment[]>,
    progressMap: Record<string, number>
) => {
    try {
        const db = await openDB();
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);

        // Clear existing files to sync current state
        await new Promise((resolve, reject) => {
            const req = store.clear();
            req.onsuccess = resolve;
            req.onerror = reject;
        });

        // Batch add
        for (const item of allFilesAcrossTabs) {
            const f = item.file;
            const key = `${f.name}-${f.size}`;

            const entry: PlaylistEntry = {
                name: f.name,
                size: f.size,
                type: f.type,
                lastModified: f.lastModified,
                // @ts-ignore
                path: f.path || null,
                progress: progressMap[key] || 0,
                subtitles: subtitlesMap[key] || [],
                tabId: item.tabId,
                tabName: item.tabName
            };
            store.put(entry);
        }

        return new Promise<void>((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    } catch (e) {
        console.error("Error saving playlist files to DB:", e);
    }
};

// Return flat entries. App.tsx will distribute them into tabs.
export const loadFullPlaylistFromDB = async (): Promise<{
    entries: PlaylistEntry[],
    subtitlesMap: Record<string, SubtitleSegment[]>,
    progressMap: Record<string, number>
}> => {
    try {
        const db = await openDB();
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                const data = request.result as PlaylistEntry[];
                const subtitlesMap: Record<string, SubtitleSegment[]> = {};
                const progressMap: Record<string, number> = {};

                if (!data || data.length === 0) {
                    resolve({ entries: [], subtitlesMap: {}, progressMap: {} });
                    return;
                }

                data.forEach(item => {
                    const key = `${item.name}-${item.size}`;
                    if (item.subtitles && item.subtitles.length > 0) {
                        subtitlesMap[key] = item.subtitles;
                    }
                    if (item.progress > 0) {
                        progressMap[key] = item.progress;
                    }
                });

                resolve({ entries: data, subtitlesMap, progressMap });
            };
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        console.error("Error loading playlist from DB:", e);
        return { entries: [], subtitlesMap: {}, progressMap: {} };
    }
};
