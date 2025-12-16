import { LocalLLMConfig, WordDefinition } from "../types";
import { GoogleGenAI, Type } from "@google/genai";
import { lookupWord, speakText } from "../utils/dictionary";

// --- TTS ---
export const playAudio = async (text: string) => {
    speakText(text);
};

// --- DEFINITIONS ---

let aiInstance: GoogleGenAI | null = null;
const getAI = (apiKey?: string) => {
    if (apiKey) return new GoogleGenAI({ apiKey });
    if (!aiInstance) {
        // @ts-ignore
        const key = typeof process !== 'undefined' ? process.env.API_KEY : '';
        if (key) aiInstance = new GoogleGenAI({ apiKey: key });
    }
    return aiInstance || new GoogleGenAI({ apiKey: '' });
};

const getWordDefinitionOnline = async (word: string, context: string, apiKey?: string): Promise<WordDefinition> => {
    if (!apiKey && (!process.env.API_KEY || process.env.API_KEY === '')) {
        throw new Error("API Key is missing. Please enter your Gemini API Key in Settings.");
    }
    const response = await getAI(apiKey).models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Define the word "${word}" based on this context: "${context}".
                   Explain the meaning exhaustively using very simple vocabulary (A1/A2 level) suitable for a beginner language learner.
                   Return JSON with: word, phonetic (IPA), partOfSpeech, meaning, usage (short usage in context), example (a new example sentence).`,
        config: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    word: { type: Type.STRING },
                    phonetic: { type: Type.STRING },
                    partOfSpeech: { type: Type.STRING },
                    meaning: { type: Type.STRING },
                    usage: { type: Type.STRING },
                    example: { type: Type.STRING }
                }
            }
        }
    });
    if (response.text) {
        return JSON.parse(response.text) as WordDefinition;
    }
    throw new Error("Failed to parse definition");
};

export const fetchLocalModels = async (endpoint: string): Promise<string[]> => {
    try {
        const baseUrl = endpoint.replace(/\/$/, '');
        const response = await fetch(`${baseUrl}/api/tags`);
        if (!response.ok) throw new Error('Failed to connect to Local LLM');
        const data = await response.json();
        return data.models.map((m: any) => m.name);
    } catch (e) {
        throw e;
    }
};

const getLocalLLMDefinition = async (word: string, context: string, config: LocalLLMConfig): Promise<WordDefinition> => {
    const baseUrl = config.endpoint.replace(/\/$/, '');
    const prompt = `Define the word "${word}" based on this context: "${context}".
    Explain the meaning exhaustively using very simple vocabulary (A1/A2 level) suitable for a beginner language learner.
    Return a JSON object with exactly these keys:
    - word (string)
    - phonetic (string, IPA format)
    - partOfSpeech (string)
    - meaning (string)
    - usage (string, short usage based on context)
    - example (string, a new example sentence)
    
    Output valid JSON only. Do not include markdown or explanations.`;

    try {
        const response = await fetch(`${baseUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: config.model,
                prompt: prompt,
                stream: false,
                format: "json"
            })
        });

        const data = await response.json();
        const text = data.response;
        return JSON.parse(text) as WordDefinition;
    } catch (e) {
        throw new Error("Failed to get definition from Local LLM");
    }
};

export const getWordDefinition = async (word: string, context: string, isOffline: boolean, localLLMConfig: LocalLLMConfig, apiKey?: string): Promise<WordDefinition> => {
    if (isOffline) {
        if (localLLMConfig.enabled) {
            return await getLocalLLMDefinition(word, context, localLLMConfig);
        } else {
            return await lookupWord(word, context);
        }
    } else {
        return await getWordDefinitionOnline(word, context, apiKey);
    }
};
