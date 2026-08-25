import React, { useState, useEffect } from 'react';
import { useI18n } from '../../i18n/index.jsx';

export default function AdminMaestro() {
  const { t } = useI18n();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [msg, setMsg] = useState(null);

  const fetchTasks = async () => {
    try {
      const res = await fetch('/api/maestro/tasks');
      const data = await res.json();
      if (data.ok) {
        setTasks(data.tasks || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
    const timer = setInterval(fetchTasks, 5000);
    return () => clearInterval(timer);
  }, []);

  const handleRunNow = async (slug) => {
    setExecuting(true);
    setMsg(null);
    try {
      const res = await fetch('/api/maestro/run-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      const data = await res.json();
      if (data.ok) {
        setMsg(`✓ ${data.message}`);
        fetchTasks();
      }
    } catch (err) {
      setMsg(`✗ Erreur: ${err.message}`);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto text-slate-200">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            ⏱️ {t('maestro.title')}
          </h1>
          <p className="text-sm text-slate-400">{t('maestro.subtitle')}</p>
        </div>
        <button
          onClick={() => handleRunNow('')}
          disabled={executing}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-4 py-2 rounded-lg transition shadow flex items-center gap-2"
        >
          ⚡ {executing ? 'Exécution...' : t('maestro.runNow')}
        </button>
      </div>

      {msg && (
        <div className="mb-4 p-3 bg-indigo-950/80 border border-indigo-500/30 rounded-lg text-sm text-indigo-300">
          {msg}
        </div>
      )}

      <div className="bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-800/80 text-slate-400 uppercase text-xs">
            <tr>
              <th className="p-4">{t('maestro.taskName')}</th>
              <th className="p-4">Bridge</th>
              <th className="p-4">{t('maestro.cadence')}</th>
              <th className="p-4">{t('maestro.status')}</th>
              <th className="p-4 text-right">{t('maestro.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {tasks.map((task) => (
              <tr key={task.slug} className="hover:bg-slate-800/40">
                <td className="p-4 font-medium text-white">
                  <div>{task.title}</div>
                  <div className="text-xs text-slate-500 font-mono">{task.slug}</div>
                </td>
                <td className="p-4">
                  <span className="bg-slate-800 border border-slate-700 px-2 py-0.5 rounded text-xs text-slate-300">
                    {task.bridgeType}
                  </span>
                </td>
                <td className="p-4 text-slate-300">{task.cadenceHuman}</td>
                <td className="p-4">
                  <span className="inline-flex items-center gap-1.5 text-emerald-400 font-medium text-xs bg-emerald-950/50 border border-emerald-500/20 px-2.5 py-1 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    {task.lastStatus}
                  </span>
                </td>
                <td className="p-4 text-right">
                  <button
                    onClick={() => handleRunNow(task.slug)}
                    disabled={executing}
                    className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-3 py-1.5 rounded border border-slate-700 transition"
                  >
                    Exécuter
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
