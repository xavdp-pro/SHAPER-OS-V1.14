import { useMemo, useRef, useEffect } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import CopyCodeButton from './CopyCodeButton.jsx';
import MermaidDiagram from './MermaidDiagram.jsx';
import { stripEmotionTagsForDisplay } from '../lib/emotionTags.js';
import { buildImageGalleryCatalog } from '../lib/imageGallery.js';
import { enrichMarkdownMedia } from '../lib/richContent.js';
import { stabilizeStreamingMarkdown } from '../lib/streamingMarkdown.js';
import { ImageGalleryProvider, RichImage, RichLink } from './RichMedia.jsx';

function detectLanguage(text, hint) {
  if (hint) {
    const h = hint.toLowerCase();
    if (h === 'js') return 'javascript';
    return h;
  }
  const trimmed = String(text || '').trim();
  if (!trimmed) return 'text';
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      /* not json */
    }
  }
  if (trimmed.startsWith('#!/')) return 'bash';
  if (/^(import |export |const |let |function |class |async )/m.test(trimmed)) return 'javascript';
  if (trimmed.includes('=>') && /[{;}]/.test(trimmed)) return 'javascript';
  return 'text';
}

export function formatMaybeJson(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return '';
  if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }
  return raw;
}

function markdownUrlTransform(url) {
  const raw = String(url || '').trim();
  if (/^data:image\//i.test(raw)) return raw;
  return defaultUrlTransform(raw);
}

function CodeFence({ language, children, title, streaming = false }) {
  const code = String(children).replace(/\n$/, '');
  const lang = detectLanguage(code, language);
  const prismLang = lang === 'text' ? undefined : lang;

  if (lang === 'mermaid') {
    if (streaming) {
      return (
        <div className="my-2 rounded-lg overflow-hidden border border-white/10 bg-black/30">
          <div className="flex items-center gap-2 px-2.5 py-1 bg-black/50 border-b border-white/10">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">mermaid</span>
            <span className="text-[10px] text-violet-300/70 animate-pulse">…</span>
          </div>
          <pre className="px-3 py-2 text-xs text-slate-400 font-mono whitespace-pre-wrap">{code}</pre>
        </div>
      );
    }
    return (
      <div className="my-2 rounded-lg overflow-hidden border border-white/10 bg-black/30">
        <div className="flex items-center gap-2 px-2.5 py-1 bg-black/50 border-b border-white/10">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">mermaid</span>
        </div>
        <MermaidDiagram code={code} />
      </div>
    );
  }

  return (
    <div className="code-sunk my-2 rounded-lg overflow-hidden border border-white/10 text-left group/code max-w-full min-w-0">
      <div className="flex items-center gap-2 px-2.5 py-1 bg-black/50 border-b border-white/10">
        {title ? (
          <span className="text-[10px] uppercase tracking-wider text-slate-500">{title}</span>
        ) : null}
        {lang !== 'text' && (
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">
            {title ? '· ' : ''}{lang}
          </span>
        )}
        <CopyCodeButton text={code} className="ml-auto" />
      </div>
      <div className="overflow-x-auto theme-scrollbar max-w-full">
        {/* min-w-max: background spans full code width on horizontal scroll */}
        <div className="code-sunk-scroll min-w-full w-max">
          <SyntaxHighlighter
            language={prismLang}
            style={oneDark}
            PreTag="div"
            customStyle={{
              margin: 0,
              padding: '0.75rem',
              fontSize: '0.75rem',
              lineHeight: 1.5,
              background: 'transparent',
              overflow: 'visible',
              minWidth: '100%',
            }}
            codeTagProps={{ style: { fontFamily: 'ui-monospace, monospace' } }}
          >
            {code}
          </SyntaxHighlighter>
        </div>
      </div>
    </div>
  );
}

/** Plain text of a React child (for counting words across formatted parts). */
function nodeText(child) {
  if (child == null || child === false) return '';
  if (typeof child === 'string' || typeof child === 'number') return String(child);
  if (Array.isArray(child)) return child.map(nodeText).join('');
  if (child?.props?.children != null) return nodeText(child.props.children);
  return '';
}
function cleanMarkdownForWordCount(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/^>\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '');
}

const countWords = (s) => (cleanMarkdownForWordCount(s).match(/\S+/g) || []).length;

/**
 * Highlights the active word WITHIN prose (karaoke integrated into read text),
 * without altering code or tables.
 */
function proseWithKaraoke(children, node, source, karaoke) {
  if (!karaoke?.enabled || karaoke.activeIndex < 0 || !node?.position) return children;
  const targetIdx = karaoke.activeIndex;
  const activeWord = karaoke.words?.[targetIdx];
  const rangeStart = targetIdx;
  const rangeEnd = targetIdx + 1;

  let idx = countWords(String(source || '').slice(0, node.position.start.offset));
  const arr = Array.isArray(children) ? children : [children];
  return arr.map((child, i) => {
    if (typeof child === 'string') {
      const parts = child.split(/(\s+)/);
      return (
        <span key={`k-${i}`}>
          {parts.map((tok, j) => {
            if (!tok || /^\s+$/.test(tok)) return tok;
            const wi = idx;
            idx += 1;
            const inRange = wi >= rangeStart && wi < rangeEnd;
            return inRange ? (
              <span
                key={j}
                className="bg-emerald-400/40 text-white font-medium rounded px-0.5 shadow-[0_0_10px_rgba(52,211,153,0.4)] transition-colors duration-100"
                data-karaoke-active="true"
              >
                {tok}
              </span>
            ) : tok;
          })}
        </span>
      );
    }
    idx += countWords(nodeText(child));
    return child;
  });
}

const markdownComponents = (conversation, cwd, streaming, imageRenderIndexRef, imageCatalog, source, karaoke) => ({
  p({ node, children }) {
    return <p>{proseWithKaraoke(children, node, source, karaoke)}</p>;
  },
  li({ node, children }) {
    return <li>{proseWithKaraoke(children, node, source, karaoke)}</li>;
  },
  h1({ node, children }) {
    return <h1>{proseWithKaraoke(children, node, source, karaoke)}</h1>;
  },
  h2({ node, children }) {
    return <h2>{proseWithKaraoke(children, node, source, karaoke)}</h2>;
  },
  h3({ node, children }) {
    return <h3>{proseWithKaraoke(children, node, source, karaoke)}</h3>;
  },
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '');
    const text = String(children).replace(/\n$/, '');
    const isBlock = Boolean(match) || text.includes('\n');
    if (isBlock) {
      return (
        <CodeFence language={match?.[1]} streaming={streaming}>
          {text}
        </CodeFence>
      );
    }
    return (
      <code
        className="bg-black/40 px-1 py-0.5 rounded text-[0.85em] font-mono text-amber-200/90"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre({ children }) {
    return <>{children}</>;
  },
  img({ src, alt }) {
    const renderIndex = imageRenderIndexRef.current;
    imageRenderIndexRef.current += 1;
    const catalogEntry = imageCatalog.entries[renderIndex] || null;
    return (
      <RichImage
        src={src}
        alt={alt}
        conversation={conversation}
        cwd={cwd}
        catalogEntry={catalogEntry}
      />
    );
  },
  a({ href, children }) {
    return <RichLink href={href} conversation={conversation} cwd={cwd}>{children}</RichLink>;
  },
});

export default function MarkdownContent({
  text,
  streaming = false,
  className = '',
  stripEmotions = true,
  conversation = '',
  workspaceCwd = '',
  cursorVariant = 'emerald',
  karaoke = null,
}) {
  const source = useMemo(() => {
    const raw = String(text || '');
    const cleaned = stripEmotions ? stripEmotionTagsForDisplay(raw, { streaming }) : raw;
    const enriched = enrichMarkdownMedia(cleaned);
    return stabilizeStreamingMarkdown(enriched, { streaming });
  }, [text, streaming, stripEmotions]);
  const imageCatalog = useMemo(
    () => buildImageGalleryCatalog(source),
    [source],
  );
  const imageRenderIndexRef = useRef(0);
  imageRenderIndexRef.current = 0;
  const components = useMemo(
    () => markdownComponents(
      conversation,
      workspaceCwd,
      streaming,
      imageRenderIndexRef,
      imageCatalog,
      source,
      karaoke,
    ),
    [conversation, workspaceCwd, streaming, imageCatalog, source, karaoke],
  );

  useEffect(() => {
    if (!karaoke?.enabled || karaoke.activeIndex < 0) return;
    document.querySelector('[data-karaoke-active]')?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    });
  }, [karaoke?.activeIndex, karaoke?.enabled]);

  if (!source && !streaming) return null;

  const cursorClass = cursorVariant === 'violet'
    ? 'bg-violet-400/80'
    : 'bg-emerald-400/80';

  return (
    <ImageGalleryProvider
      catalog={imageCatalog}
      conversation={conversation}
      cwd={workspaceCwd}
    >
      <div className={`md-prose ${className}`.trim()}>
        {source ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={components}
            urlTransform={markdownUrlTransform}
          >
            {source}
          </ReactMarkdown>
        ) : null}
        {streaming && (
          <span className={`inline-block w-2 h-4 ml-0.5 ${cursorClass} animate-pulse align-text-bottom`} />
        )}
      </div>
    </ImageGalleryProvider>
  );
}

export function CodePanel({ title, text, language }) {
  const formatted = useMemo(() => formatMaybeJson(text), [text]);
  if (!formatted) return null;
  return (
    <div className="mt-2">
      <CodeFence language={language} title={title}>{formatted}</CodeFence>
    </div>
  );
}
