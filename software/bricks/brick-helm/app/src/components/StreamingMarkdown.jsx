import MarkdownContent from './MarkdownContent.jsx';
import { stripEmotionTagsForDisplay } from '../lib/emotionTags.js';

/**
 * Assistant/thinking stream — markdown rendered live (no raw # ** | during stream).
 */
export default function StreamingMarkdown({
  text,
  streaming = false,
  className = '',
  cursorVariant = 'emerald',
  conversation = '',
  workspaceCwd = '',
  karaoke = null,
}) {
  const source = stripEmotionTagsForDisplay(text, { streaming });
  if (!source && !streaming) return null;

  return (
    <MarkdownContent
      text={source}
      streaming={streaming}
      stripEmotions={false}
      className={className}
      cursorVariant={cursorVariant}
      conversation={conversation}
      workspaceCwd={workspaceCwd}
      karaoke={karaoke}
    />
  );
}
