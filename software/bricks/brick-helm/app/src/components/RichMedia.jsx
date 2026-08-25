import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { FileText, ExternalLink, ZoomIn } from 'lucide-react';
import { fetchWorkspacePreview } from '../api/client.js';
import ImageLightbox from './ImageLightbox.jsx';
import {
  classifyMediaPath,
  isExternalUrl,
  resolveMediaPath,
  workspaceFileApiUrl,
} from '../lib/richContent.js';

const ImageGalleryContext = createContext(null);

function resolveGalleryImages(group, conversation, cwd) {
  if (!group?.images?.length) return [];
  return group.images.map((entry) => ({
    url: resolveMarkdownMediaSrc(entry.src, conversation, cwd),
    alt: entry.alt || '',
  })).filter((item) => item.url);
}

export function ImageGalleryProvider({
  catalog,
  conversation = '',
  cwd = '',
  children,
}) {
  const [lightbox, setLightbox] = useState(null);

  const openLightbox = useCallback((groupId, indexInGroup) => {
    setLightbox({ groupId, indexInGroup });
  }, []);

  const closeLightbox = useCallback(() => {
    setLightbox(null);
  }, []);

  const value = useMemo(
    () => ({ catalog, openLightbox }),
    [catalog, openLightbox],
  );

  const lightboxImages = useMemo(() => {
    if (!lightbox || !catalog?.groups?.length) return [];
    const group = catalog.groups[lightbox.groupId];
    return resolveGalleryImages(group, conversation, cwd);
  }, [lightbox, catalog, conversation, cwd]);

  return (
    <ImageGalleryContext.Provider value={value}>
      {children}
      {lightbox && lightboxImages.length ? (
        <ImageLightbox
          images={lightboxImages}
          initialIndex={lightbox.indexInGroup}
          onClose={closeLightbox}
        />
      ) : null}
    </ImageGalleryContext.Provider>
  );
}

function useImageGallery() {
  return useContext(ImageGalleryContext);
}

export function resolveMarkdownMediaSrc(src, conversation, cwd = '') {
  const raw = String(src || '').trim();
  if (!raw) return '';
  if (isExternalUrl(raw)) return raw;
  const abs = resolveMediaPath(raw, cwd);
  if (!abs || !conversation) return raw;
  return workspaceFileApiUrl(conversation, abs);
}

export function RichImage({ src, alt, conversation, cwd, catalogEntry = null }) {
  const [failed, setFailed] = useState(false);
  const gallery = useImageGallery();
  const url = useMemo(
    () => resolveMarkdownMediaSrc(src, conversation, cwd),
    [src, conversation, cwd],
  );

  const openPreview = useCallback(() => {
    if (!url || failed) return;
    if (gallery?.openLightbox && catalogEntry != null) {
      gallery.openLightbox(catalogEntry.groupId, catalogEntry.indexInGroup);
    }
  }, [url, failed, gallery, catalogEntry]);

  if (!url || failed) {
    return (
      <span className="text-xs text-slate-500 font-mono break-all">
        {alt || src}
      </span>
    );
  }

  return (
    <figure className="rich-image my-3" data-rich-content="image">
      <button
        type="button"
        className="rich-image-trigger group relative block max-w-full cursor-zoom-in rounded-xl border border-white/10 bg-black/20 overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
        aria-label={alt ? `Open image: ${alt}` : 'Open image preview'}
        onClick={openPreview}
      >
        <img
          src={url}
          alt={alt || 'image'}
          loading="lazy"
          className="max-w-full max-h-[min(70vh,560px)] object-contain transition duration-200 group-hover:brightness-110"
          onError={() => setFailed(true)}
          draggable={false}
        />
        <span className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/55 px-2 py-1 text-[10px] text-slate-200 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
          <ZoomIn size={12} />
          Agrandir
        </span>
      </button>
      {alt ? (
        <figcaption className="mt-1.5 text-[11px] text-slate-500">{alt}</figcaption>
      ) : null}
    </figure>
  );
}

function previewIframeSrc(url) {
  if (!url) return '';
  const base = String(url).split('#')[0];
  return `${base}#page=1&view=FitH`;
}

export function PdfPreview({ url, title }) {
  if (!url) return null;
  const iframeSrc = previewIframeSrc(url);
  const openInTab = () => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };
  return (
    <div
      className="rich-pdf my-3 rounded-xl border border-white/10 overflow-hidden bg-black/20 cursor-pointer"
      data-rich-content="pdf"
      role="button"
      tabIndex={0}
      onClick={openInTab}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openInTab();
        }
      }}
    >
      <div className="flex items-center gap-2 px-3 py-2 bg-black/40 border-b border-white/10 text-xs text-slate-300">
        <FileText size={14} className="text-red-300 shrink-0" />
        <span className="truncate font-medium">{title || 'PDF'}</span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-brand-400 hover:text-brand-300 shrink-0 cursor-pointer"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink size={12} />
          Ouvrir
        </a>
      </div>
      <iframe
        title={title || 'PDF preview'}
        src={iframeSrc}
        className="w-full h-[min(42vh,420px)] bg-white pointer-events-none"
      />
    </div>
  );
}

export function DocxPreview({ fileUrl, previewUrl, title, conversation, filePath }) {
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setHtml('');
    (async () => {
      const { ok, data } = await fetchWorkspacePreview({
        conversation,
        path: filePath,
      });
      if (cancelled) return;
      if (!ok || !data?.html) {
        setError(data?.error || 'Aperçu indisponible');
        setLoading(false);
        return;
      }
      setHtml(String(data.html));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [conversation, filePath]);

  const openInTab = () => {
    if (fileUrl) window.open(fileUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      className="rich-docx my-3 rounded-xl border border-white/10 overflow-hidden bg-black/20 cursor-pointer"
      data-rich-content="docx"
      role="button"
      tabIndex={0}
      onClick={openInTab}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openInTab();
        }
      }}
    >
      <div className="flex items-center gap-2 px-3 py-2 bg-black/40 border-b border-white/10 text-xs text-slate-300">
        <FileText size={14} className="text-blue-300 shrink-0" />
        <span className="truncate font-medium">{title || 'Word'}</span>
        <a
          href={fileUrl || previewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-brand-400 hover:text-brand-300 shrink-0 cursor-pointer"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink size={12} />
          Ouvrir
        </a>
      </div>
      <div className="rich-docx-body w-full max-h-[min(42vh,420px)] overflow-hidden bg-white text-slate-900 px-4 py-3 text-sm leading-relaxed pointer-events-none">
        {loading && <p className="text-slate-500 text-xs">Chargement de l’aperçu…</p>}
        {!loading && error && (
          <p className="text-slate-500 text-xs">{error}</p>
        )}
        {!loading && html && (
          <div
            className="prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  );
}

export function RichLink({ href, children, conversation, cwd }) {
  const url = useMemo(
    () => resolveMarkdownMediaSrc(href, conversation, cwd),
    [href, conversation, cwd],
  );
  const absPath = useMemo(
    () => resolveMediaPath(href, cwd),
    [href, cwd],
  );
  const kind = classifyMediaPath(href || url);
  if (kind === 'pdf' && url) {
    return <PdfPreview url={url} title={String(children || href || 'PDF')} />;
  }
  if (kind === 'docx' && url && conversation && absPath) {
    return (
      <DocxPreview
        fileUrl={url}
        title={String(children || href || 'Document')}
        conversation={conversation}
        filePath={absPath}
      />
    );
  }
  return (
    <a href={url || href} target="_blank" rel="noopener noreferrer" className="text-brand-400 underline hover:text-brand-300 break-all">
      {children}
    </a>
  );
}
