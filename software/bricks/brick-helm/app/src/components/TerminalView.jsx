import { Terminal } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import CopyCodeButton from './CopyCodeButton.jsx';

const monoStyle = {
  margin: 0,
  padding: 0,
  fontSize: '0.75rem',
  lineHeight: 1.55,
  background: 'transparent',
};

/** Terminal panel — command + output with syntax highlighting. */
export default function TerminalView({ command, cwd, output, running }) {
  const cmd = command || '';
  const out = output || '';
  const copyAll = [cmd ? `$ ${cmd}` : '', out].filter(Boolean).join('\n\n');

  return (
    <div className="ide-terminal code-sunk rounded-lg overflow-hidden border border-white/10 font-mono text-xs max-w-full min-w-0">
      <div className="ide-terminal-bar px-2.5 py-1.5 flex items-center gap-2 bg-black/50 border-b border-white/10">
        <Terminal size={12} className="text-emerald-500 shrink-0" />
        <span className="text-slate-400 text-[10px] uppercase tracking-wider">Terminal</span>
        {cwd ? (
          <span className="text-slate-600 truncate text-[10px] max-w-[40%]" title={cwd}>{cwd}</span>
        ) : null}
        <CopyCodeButton text={copyAll} label="Copier commande et sortie" className="ml-auto" />
      </div>
      <div className="p-3 bg-[#0d1117] min-h-[3rem] overflow-x-auto theme-scrollbar max-w-full">
        <div className="flex gap-2 items-start text-emerald-400/95">
          <span className="select-none shrink-0 text-emerald-600 pt-0.5">$</span>
          <SyntaxHighlighter
            language="bash"
            style={oneDark}
            PreTag="div"
            customStyle={monoStyle}
            codeTagProps={{ style: { fontFamily: 'ui-monospace, monospace' } }}
          >
            {command || '…'}
          </SyntaxHighlighter>
        </div>
        {running && !output && (
          <div className="mt-3 flex items-center gap-2 text-slate-500">
            <span className="stream-tool-spinner" aria-hidden />
            <span>Exécution en cours…</span>
          </div>
        )}
        {output ? (
          <div className="mt-3 border-t border-white/5 pt-3 relative">
            <div className="absolute top-1 right-0 z-10">
              <CopyCodeButton text={out} label="Copier la sortie" />
            </div>
            <SyntaxHighlighter
              language="bash"
              style={oneDark}
              PreTag="div"
              customStyle={{ ...monoStyle, background: 'rgba(0,0,0,0.25)', padding: '0.5rem', borderRadius: '0.375rem' }}
              codeTagProps={{ style: { fontFamily: 'ui-monospace, monospace' } }}
            >
              {output}
            </SyntaxHighlighter>
          </div>
        ) : null}
        {running && output && (
          <span className="inline-block w-2 h-3.5 ml-0.5 mt-1 bg-emerald-400/70 animate-pulse align-text-bottom" />
        )}
      </div>
    </div>
  );
}
