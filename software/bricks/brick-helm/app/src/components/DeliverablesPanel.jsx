import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ChevronDown,
  Download,
  FileCode,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
  Package,
  RefreshCw,
} from 'lucide-react';
import { getDeliverables, deliverableDownloadUrl, setActiveConversation } from '../api/client.js';
import { useLocale } from '../context/LocaleContext.jsx';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const SPREADSHEET_EXT = new Set(['.xlsx', '.xls', '.csv', '.tsv', '.parquet']);
const ARCHIVE_EXT = new Set(['.zip', '.tar.gz', '.tgz', '.7z', '.rar']);
const CODE_EXT = new Set(['.json', '.sql', '.py', '.js', '.ts', '.sh', '.html', '.css']);

function formatBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} o`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} Ko`;
  return `${(b / (1024 * 1024)).toFixed(1)} Mo`;
}

function fileMeta(ext) {
  if (IMAGE_EXT.has(ext)) return { Icon: ImageIcon, color: 'text-purple-400 bg-purple-500/10' };
  if (SPREADSHEET_EXT.has(ext)) return { Icon: FileSpreadsheet, color: 'text-emerald-400 bg-emerald-500/10' };
  if (ARCHIVE_EXT.has(ext)) return { Icon: Archive, color: 'text-amber-400 bg-amber-500/10' };
  if (CODE_EXT.has(ext)) return { Icon: FileCode, color: 'text-cyan-400 bg-cyan-500/10' };
  return { Icon: FileText, color: 'text-sky-400 bg-sky-500/10' };
}

/**
 * "Deliverables" panel — lists files produced by the agent in the
 * workspace (docs/, assets/, data/) with direct download. Refreshes
 * at the end of each run (streaming → false).
 */
export default function DeliverablesPanel({ conversation, streaming }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [activeFolder, setActiveFolder] = useState('all');
  const prevStreamingRef = useRef(streaming);

  const refresh = useCallback(async () => {
    if (!conversation) return;
    setLoading(true);
    const prev = conversation;
    setActiveConversation(conversation);
    const { ok, data } = await getDeliverables();
    setActiveConversation(prev);
    if (ok && Array.isArray(data?.files)) setFiles(data.files);
    setLoaded(true);
    setLoading(false);
  }, [conversation]);

  // Refetch when a run finishes (files may have been produced).
  useEffect(() => {
    const was = prevStreamingRef.current;
    prevStreamingRef.current = streaming;
    if (was && !streaming && (open || loaded)) void refresh();
  }, [streaming, open, loaded, refresh]);

  // First open triggers a load.
  useEffect(() => {
    if (open && !loaded) void refresh();
  }, [open, loaded, refresh]);

  // Reset when switching conversation.
  useEffect(() => {
    setFiles([]);
    setLoaded(false);
    setOpen(false);
    setActiveFolder('all');
  }, [conversation]);

  const filteredFiles = useMemo(() => {
    if (activeFolder === 'all') return files;
    return files.filter((f) => f.folder === activeFolder);
  }, [files, activeFolder]);

  if (!conversation) return null;
  const count = files.length;

  return (
    <div className="shrink-0 border-b border-white/10 bg-[#0a0f1a]/80">
      <div className="max-w-3xl mx-auto w-full px-2 sm:px-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center gap-2 py-1.5 text-left text-slate-400 hover:text-slate-200 transition"
        >
          <Package size={14} className="shrink-0 text-brand-400" />
          <span className="text-xs font-medium">
            {t('deliverables.title')}{count ? ` · ${count}` : ''}
          </span>
          {loading && <Loader2 size={12} className="animate-spin text-brand-400" />}
          <ChevronDown
            size={14}
            className={`ml-auto transition-transform text-slate-400 ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {open && (
          <div className="pb-2.5 pt-1">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-1">
                {['all', 'docs', 'data', 'assets'].map((folder) => {
                  const active = activeFolder === folder;
                  const label = folder === 'all' ? 'Tous' : `${folder}/`;
                  return (
                    <button
                      key={folder}
                      type="button"
                      onClick={() => setActiveFolder(folder)}
                      className={`text-[10px] px-2 py-0.5 rounded-md font-medium transition cursor-pointer ${
                        active
                          ? 'bg-brand-500/20 text-brand-300 ring-1 ring-brand-400/40'
                          : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={refresh}
                disabled={loading}
                className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300 disabled:opacity-50"
              >
                <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> {t('deliverables.refresh')}
              </button>
            </div>

            {!filteredFiles.length && !loading && (
              <p className="text-[11px] text-slate-600 py-3 text-center">
                {count ? 'Aucun fichier dans ce dossier' : t('deliverables.empty')}
              </p>
            )}

            <ul className="space-y-1 max-h-56 overflow-y-auto theme-scrollbar">
              {filteredFiles.map((f) => {
                const { Icon, color } = fileMeta(f.ext);
                return (
                  <li key={f.path}>
                    <a
                      href={deliverableDownloadUrl(f.path)}
                      className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-white/5 transition group"
                      title={f.path}
                    >
                      <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${color}`}>
                        <Icon size={14} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-slate-200 truncate">{f.name}</div>
                        <div className="text-[10px] text-slate-500">{f.folder ? `${f.folder}/` : ''} · {formatBytes(f.size)}</div>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-slate-400 uppercase font-mono shrink-0">
                        {f.ext.replace(/^\./, '')}
                      </span>
                      <Download
                        size={14}
                        className="shrink-0 text-slate-500 group-hover:text-brand-300"
                      />
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
