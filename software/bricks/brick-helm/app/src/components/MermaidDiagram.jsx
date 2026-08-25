import { useEffect, useId, useRef, useState } from 'react';

export default function MermaidDiagram({ code }) {
  const containerRef = useRef(null);
  const reactId = useId();
  const [error, setError] = useState('');
  const source = String(code || '').trim();

  useEffect(() => {
    if (!source || !containerRef.current) return undefined;
    let cancelled = false;

    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          securityLevel: 'strict',
        });
        const id = `mmd-${reactId.replace(/:/g, '')}`;
        const { svg } = await mermaid.render(id, source);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setError('');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => { cancelled = true; };
  }, [source, reactId]);

  if (!source) return null;

  if (error) {
    return (
      <pre className="text-xs text-red-300/90 whitespace-pre-wrap break-words p-2 bg-red-950/30 rounded-lg border border-red-500/20">
        {error}
      </pre>
    );
  }

  return (
    <div
      ref={containerRef}
      className="mermaid-diagram my-2 overflow-x-auto rounded-lg border border-white/10 bg-black/30 p-3 [&_svg]:max-w-full"
      aria-label="Diagramme mermaid"
    />
  );
}
