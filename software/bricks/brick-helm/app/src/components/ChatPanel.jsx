import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Loader2, X } from 'lucide-react';
import RunTimeline from './RunTimeline.jsx';
import { isStreaming } from '../lib/runStream.js';

const MAX_IMAGES = 6;
const MAX_BYTES = 8 * 1024 * 1024;
const INPUT_MAX_ROWS = 3;

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Fichier non image'));
      return;
    }
    if (file.size > MAX_BYTES) {
      reject(new Error('Image trop volumineuse (max 8 Mo)'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve({
      id: crypto.randomUUID(),
      name: file.name || `image-${Date.now()}.png`,
      dataUrl: reader.result,
    });
    reader.onerror = () => reject(new Error('Lecture image échouée'));
    reader.readAsDataURL(file);
  });
}

export default function ChatPanel({
  draft,
  setDraft,
  timeline,
  sending,
  stopping = false,
  onSend,
  onEditHuman,
  activePath,
  viewFilters,
}) {
  const [attachments, setAttachments] = useState([]);
  const bottomRef = useRef(null);
  const formRef = useRef(null);
  const textareaRef = useRef(null);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const style = getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight) || 20;
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const maxHeight = lineHeight * INPUT_MAX_ROWS + padding;
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [draft, resizeTextarea]);

  const addImage = async (file) => {
    if (attachments.length >= MAX_IMAGES) return;
    try {
      const img = await readImageFile(file);
      setAttachments((prev) => [...prev, img]);
    } catch {
      /* ignore invalid paste */
    }
  };

  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageItems = [...items].filter((it) => it.type.startsWith('image/'));
    if (!imageItems.length) return;
    e.preventDefault();
    imageItems.forEach((item) => {
      const file = item.getAsFile();
      if (file) addImage(file);
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const text = draft.trim();
    if ((!text && !attachments.length) || sending) return;
    onSend(text, attachments);
    setAttachments([]);
  };

  const handleKeyDown = (e) => {
    if (e.key !== 'Enter') return;
    if (e.ctrlKey || e.metaKey) return; // Ctrl+Enter = new line (textarea behavior)
    e.preventDefault();
    if (canSend) formRef.current?.requestSubmit();
  };

  const canSend = Boolean(activePath) && !sending && !stopping && (draft.trim() || attachments.length);
  const disabled = sending || stopping || !activePath;
  const streaming = isStreaming(timeline);

  useEffect(() => {
    const el = bottomRef.current;
    if (!el) return undefined;
    const scroll = () => {
      el.scrollTop = el.scrollHeight;
    };
    scroll();
    if (!streaming) return undefined;
    const id = setInterval(scroll, 48);
    return () => clearInterval(id);
  }, [timeline, streaming]);

  return (
    <div className={`flex flex-col h-full min-h-0 glass rounded-2xl overflow-hidden ${streaming ? 'stream-chat-active' : ''}`}>
      <div
        ref={bottomRef}
        className="flex-1 min-h-0 overflow-y-auto theme-scrollbar p-3 sm:p-4"
      >
        <RunTimeline
          items={timeline}
          filters={viewFilters}
          editable={Boolean(activePath) && !sending && !stopping && !streaming}
          onEditHuman={onEditHuman}
        />
      </div>

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="shrink-0 p-3 sm:p-4 border-t border-white/10 bg-gradient-to-t from-black/60 via-black/40 to-transparent"
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {attachments.map((img) => (
              <div key={img.id} className="relative group">
                <img
                  src={img.dataUrl}
                  alt={img.name}
                  className="h-16 w-16 object-cover rounded-xl border border-white/20 shadow-md"
                />
                <button
                  type="button"
                  onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== img.id))}
                  className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-red-600 text-white opacity-90 hover:opacity-100 shadow"
                  aria-label="Retirer l'image"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div
          className={`relative rounded-2xl border bg-black/50 shadow-inner transition ${
            disabled
              ? 'border-white/5 opacity-60'
              : 'border-white/15 focus-within:border-brand-500/50 focus-within:ring-2 focus-within:ring-brand-500/25 focus-within:shadow-brand-600/10'
          }`}
        >
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            rows={1}
            className="w-full bg-transparent border-0 rounded-2xl px-4 py-2.5 pr-14 text-sm text-white placeholder:text-slate-500 focus:outline-none resize-none overflow-hidden theme-scrollbar leading-relaxed"
            placeholder={activePath ? 'Écris ton message…' : 'Sélectionne une conversation'}
            disabled={disabled}
          />
          <button
            type="submit"
            disabled={!canSend}
            className={`absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-9 h-9 rounded-xl transition cursor-pointer ${
              canSend
                ? 'bg-brand-600 hover:bg-brand-500 text-white shadow-lg shadow-brand-600/30'
                : 'bg-white/5 text-slate-600'
            } disabled:cursor-not-allowed`}
            title="Envoyer (Entrée)"
            aria-label="Envoyer"
          >
            {sending ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={18} strokeWidth={2.5} />}
          </button>
        </div>
      </form>
    </div>
  );
}
