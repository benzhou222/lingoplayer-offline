import React from 'react';
import { Loader2 } from 'lucide-react';

interface ConversionModalProps {
    conversionProgress: number;
    onCancel: () => void;
}

export const ConversionModal: React.FC<ConversionModalProps> = ({ conversionProgress, onCancel }) => {
    return (
        <div className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-sm p-8 text-center relative animate-in zoom-in-95 duration-200">
                <Loader2 size={48} className="animate-spin text-blue-500 mx-auto mb-4" />
                <h3 className="text-xl font-bold text-white mb-2">Converting Video...</h3>
                <p className="text-gray-400 text-sm mb-6">Creating a browser-friendly MP4.</p>

                <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden mb-2">
                    <div
                        className="h-full bg-blue-500 transition-all duration-300"
                        style={{ width: `${conversionProgress > 0 ? conversionProgress : 5}%` }}
                    />
                </div>
                <div className="flex justify-between text-xs text-gray-500 mb-6 font-mono">
                    <span>{conversionProgress > 0 ? `${conversionProgress}%` : 'Starting...'}</span>
                </div>

                <button
                    onClick={onCancel}
                    className="text-red-400 hover:text-red-300 text-sm font-medium border border-red-900/30 bg-red-900/10 hover:bg-red-900/20 px-4 py-2 rounded-lg transition-colors"
                >
                    Cancel Conversion
                </button>
            </div>
        </div>
    );
};