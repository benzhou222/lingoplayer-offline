
import { SubtitleSegment } from "../types";

// --- FORMATTERS (Export) ---

const formatTimeSRT = (seconds: number): string => {
  const date = new Date(0);
  date.setUTCMilliseconds(seconds * 1000);
  const iso = date.toISOString();
  // ISO is YYYY-MM-DDTHH:mm:ss.sssZ -> we need HH:mm:ss,sss
  return iso.substr(11, 12).replace('.', ',');
};

const formatTimeVTT = (seconds: number): string => {
  const date = new Date(0);
  date.setUTCMilliseconds(seconds * 1000);
  const iso = date.toISOString();
  // ISO is YYYY-MM-DDTHH:mm:ss.sssZ -> we need HH:mm:ss.sss
  return iso.substr(11, 12);
};

export const segmentsToSRT = (segments: SubtitleSegment[]): string => {
  return segments
    .map((seg, index) => {
      return `${index + 1}\n${formatTimeSRT(seg.start)} --> ${formatTimeSRT(seg.end)}\n${seg.text}`;
    })
    .join('\n\n');
};

export const segmentsToVTT = (segments: SubtitleSegment[]): string => {
  return 'WEBVTT\n\n' + segments
    .map((seg) => {
      return `${formatTimeVTT(seg.start)} --> ${formatTimeVTT(seg.end)}\n${seg.text}`;
    })
    .join('\n\n');
};

// --- PARSERS (Import) ---

const parseTimestamp = (timeStr: string): number => {
  // Handles 00:00:10,500 (SRT) and 00:00:10.500 (VTT)
  if (!timeStr) return 0;
  const normalized = timeStr.replace(',', '.');
  const parts = normalized.split(':');
  
  if (parts.length === 3) {
    // HH:MM:SS.ms
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  } else if (parts.length === 2) {
    // MM:SS.ms
    return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return 0;
};

/**
 * Parses raw subtitle text content (SRT or VTT) into segments.
 */
export const parseSubtitleContent = (text: string): SubtitleSegment[] => {
  const segments: SubtitleSegment[] = [];
  
  // Normalize line endings
  const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  // Regex strategies
  // SRT: Number\nTimestamp --> Timestamp\nText
  // VTT: (Optional ID\n)Timestamp --> Timestamp\nText
  
  // Split by double newlines to get blocks
  const blocks = normalizedText.split(/\n\n+/);

  blocks.forEach((block, index) => {
    const lines = block.trim().split('\n');
    if (lines.length < 2) return;

    let timeLineIndex = -1;
    
    // Find the line with "-->"
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('-->')) {
            timeLineIndex = i;
            break;
        }
    }

    if (timeLineIndex !== -1) {
        const timeLine = lines[timeLineIndex];
        const [startStr, endStr] = timeLine.split('-->').map(s => s.trim());
        
        // Text is everything after the time line
        const textLines = lines.slice(timeLineIndex + 1).join(' ').trim();
        
        // Clean tags like <b>, <i>, <v Voice> etc for VTT
        const cleanText = textLines.replace(/<[^>]*>/g, '');

        if (startStr && endStr && cleanText) {
            segments.push({
                id: index,
                start: parseTimestamp(startStr),
                end: parseTimestamp(endStr),
                text: cleanText
            });
        }
    }
  });

  return segments;
}

export const parseSubtitleFile = async (file: File): Promise<SubtitleSegment[]> => {
  const text = await file.text();
  return parseSubtitleContent(text);
};
