import React, { useState, useEffect } from 'react';
import { useI18n } from '../../i18n/index.jsx';

export default function AdminSocle() {
  const { t } = useI18n();
  const [bricks, setBricks] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchSocle = async () => {
    try {
      const res = await fetch('/api/socle/health');
      const data = await res.json();
      if (data.ok) {
        setBricks(data.bricks || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSocle();
    const timer = setInterval(fetchSocle, 4000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="p-6 max-w-5xl mx-auto text-slate-200">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          🧩 {t('socle.title')}
        </h1>
        <p className="text-sm text-slate-400">
          Supervision en direct des briques et services du socle conteneurisé
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {bricks.map((b) => (
          <div
            key={b.id}
            className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col justify-between"
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-white text-base">{b.name}</h3>
                <span className="text-xs font-mono text-slate-500">Port :{b.port}</span>
              </div>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1.5 ${
                  b.ok
                    ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/20'
                    : 'bg-rose-950/60 text-rose-400 border border-rose-500/20'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    b.ok ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'
                  }`}
                ></span>
                {b.status}
              </span>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-800/80 text-xs text-slate-400 flex justify-between">
              <span>Rôle Socle</span>
              <span className="text-slate-300 font-medium">{t(`socle.${b.id}`)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
