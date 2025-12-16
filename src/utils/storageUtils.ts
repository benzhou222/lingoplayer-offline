
import { SubtitleSegment } from "../types";

const DB_NAME = 'LingoPlayerDB';
const DB_VERSION = 2; // Incremented for schema change
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
}

const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            // Create new store if needed, or clear old one if version bumped
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: ['name', 'size'] });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

export const saveFullPlaylistToDB = async (
    videoList: File[],
    subtitlesMap: Record<string, SubtitleSegment[]>,
    progressMap: Record<string, number>
) => {
    try {
        const db = await openDB();
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);

        // Clear existing to avoid stale entries
        await new Promise((resolve, reject) => {
             const req = store.clear();
             req.onsuccess = resolve;
             req.onerror = reject;
        });

        const entries: PlaylistEntry[] = videoList.map(f => {
            const key = `${f.name}-${f.size}`;
            return {
                name: f.name,
                size: f.size,
                type: f.type,
                lastModified: f.lastModified,
                // @ts-ignore
                path: f.path || null,
                progress: progressMap[key] || 0,
                subtitles: subtitlesMap[key] || []
            };
        });

        // Batch add
        for (const entry of entries) {
            store.put(entry);
        }
        
        return new Promise<void>((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    } catch (e) {
        console.error("Error saving playlist to DB:", e);
    }
};

export const loadFullPlaylistFromDB = async (): Promise<{ 
    files: File[], 
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
                
                const files: File[] = [];
                const subtitlesMap: Record<string, SubtitleSegment[]> = {};
                const progressMap: Record<string, number> = {};

                if (!data) {
                    resolve({ files: [], subtitlesMap: {}, progressMap: {} });
                    return;
                }

                data.forEach(item => {
                    const key = `${item.name}-${item.size}`;
                    
                    // Reconstruct File
                    const f = new File([""], item.name, { type: item.type, lastModified: item.lastModified });
                    try { Object.defineProperty(f, 'size', { value: item.size, writable: false }); } catch(e) {}

                    if (item.path) {
                        try {
                            Object.defineProperty(f, 'path', { value: item.path, writable: false, enumerable: false, configurable: true });
                        } catch(e) {}
                    } else {
                         try {
                            Object.defineProperty(f, 'isPlaceholder', { value: true, writable: false, enumerable: false, configurable: true });
                        } catch(e) {}
                    }

                    files.push(f);
                    if (item.subtitles && item.subtitles.length > 0) {
                        subtitlesMap[key] = item.subtitles;
                    }
                    if (item.progress > 0) {
                        progressMap[key] = item.progress;
                    }
                });
                
                resolve({ files, subtitlesMap, progressMap });
            };
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        console.error("Error loading playlist from DB:", e);
        return { files: [], subtitlesMap: {}, progressMap: {} };
    }
};

// Deprecated legacy wrappers if needed, but App.tsx will switch to new ones
export const savePlaylistToDB = async (files: File[]) => { /* No-op, use saveFullPlaylistToDB */ };
export const loadPlaylistFromDB = async () => [];
