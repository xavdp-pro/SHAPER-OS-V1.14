import { Component } from 'react';

/** Prevents full blank screen if HMR or runtime crashes. */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[helm] render error', error, info);
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div className="min-h-screen mesh-bg flex items-center justify-center p-6">
          <div className="max-w-md rounded-2xl border border-red-500/30 bg-red-950/30 p-6 text-center space-y-3">
            <p className="text-red-200 font-semibold">Erreur d&apos;affichage</p>
            <p className="text-sm text-slate-400 break-words">{error.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="btn-secondary text-sm"
            >
              Recharger la page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
