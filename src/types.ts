
export interface SubtitleSegment {
  id: number;
  start: number; // seconds
  end: number;   // seconds
  text: string;
}

export interface WordDefinition {
  word: string;
  phonetic: string;
  partOfSpeech: string;
  meaning: string;
  usage: string;
  example: string;
}

export interface VocabularyItem extends WordDefinition {
  id: string;
  addedAt: number;
}

export enum PlaybackMode {
  CONTINUOUS = 'CONTINUOUS',
  LOOP_SENTENCE = 'LOOP_SENTENCE'
}

export interface LocalLLMConfig {
  enabled: boolean;
  endpoint: string;
  model: string;
}

export interface LocalASRConfig {
  enabled: boolean;
  endpoint: string;
  model: string;
  timeScale?: number;
}

export interface GeminiConfig {
  apiKey: string;
}

export type SegmentationMethod = 'fixed' | 'vad';

export interface VADSettings {
  batchSize: number;
  minSilence: number;
  silenceThreshold: number;
  filteringEnabled: boolean;
}

export interface PlaylistTab {
  id: string;
  name: string;
  files: File[];
}

// 解决 Property 'electron' does not exist on type 'Window'
declare global {
  interface Window {
    electron?: {
      isElectron: boolean;
      extractAudio: (filePath: string) => Promise<any>;
      convertVideo: (filePath: string, jobId: string) => Promise<string>;
      cancelConversion: (jobId: string) => Promise<void>;
      onConversionProgress: (callback: (data: any) => void) => (() => void);
    };
    require: any;
  }
}
