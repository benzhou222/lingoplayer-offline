
import { useState, useEffect } from 'react';
import { WordDefinition, VocabularyItem } from '../types';
import { getWordDefinition } from '../services/geminiService';
import { useVideoPlayer } from './useVideoPlayer';

export const useVocabulary = (
    settings: any,
    player: ReturnType<typeof useVideoPlayer>
) => {
    const [vocabulary, setVocabulary] = useState<VocabularyItem[]>(() => {
        try {
            const saved = localStorage.getItem('lingo_vocabulary');
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            console.error("Failed to load vocabulary", e);
            return [];
        }
    });

    const [selectedWord, setSelectedWord] = useState<WordDefinition | null>(null);
    const [loadingWord, setLoadingWord] = useState(false);
    const [showVocabSidebar, setShowVocabSidebar] = useState(false);

    useEffect(() => {
        localStorage.setItem('lingo_vocabulary', JSON.stringify(vocabulary));
    }, [vocabulary]);

    const handleWordClick = async (word: string, currentContext: string) => {
        const cleanWord = word.replace(/[.,!?;:"()]/g, "").trim();
        if (!cleanWord) return;
        
        setLoadingWord(true);
        try {
            const definition = await getWordDefinition(
                cleanWord, 
                currentContext, 
                settings.isOffline, 
                settings.localLLMConfig, 
                settings.geminiConfig.apiKey
            );
            setSelectedWord(definition);
            
            if (player.videoRef.current && player.isPlaying) {
                player.videoRef.current.pause();
                player.setIsPlaying(false);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoadingWord(false);
        }
    };

    const addToVocab = (wordDef: WordDefinition) => {
        if (!vocabulary.some(v => v.word === wordDef.word)) {
            setVocabulary(prev => [{ ...wordDef, id: crypto.randomUUID(), addedAt: Date.now() }, ...prev]);
        }
    };

    const handleExportVocab = () => {
        if (vocabulary.length === 0) {
            alert("Vocabulary list is empty.");
            return;
        }
        const dataStr = JSON.stringify(vocabulary, null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `lingoplayer_vocab_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const handleImportVocab = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const json = JSON.parse(event.target?.result as string);
                if (Array.isArray(json)) {
                    setVocabulary(prev => {
                        const existingWords = new Set(prev.map(v => v.word.toLowerCase()));
                        const newItems = json.filter((item: any) => item.word && !existingWords.has(item.word.toLowerCase())).map((item: any) => ({ ...item, id: item.id || crypto.randomUUID(), addedAt: item.addedAt || Date.now() }));
                        if (newItems.length === 0) { alert("No new words found in file."); return prev; }
                        alert(`Imported ${newItems.length} new words.`);
                        return [...newItems, ...prev];
                    });
                } else { alert("Invalid file format. Expected a JSON array."); }
            } catch (error) { console.error("Import failed", error); alert("Failed to parse the vocabulary file."); }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    return {
        vocabulary, setVocabulary,
        selectedWord, setSelectedWord,
        loadingWord,
        showVocabSidebar, setShowVocabSidebar,
        handleWordClick,
        addToVocab,
        handleExportVocab,
        handleImportVocab
    };
};
