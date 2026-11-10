import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { broadcastsApi } from '../../lib/api';
import AnalysisPanel from './AnalysisPanel';

export default function PgnImport({ isLoggedIn }) {
  const [pgn, setPgn] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      setPgn(text);
      setFileName(file.name);
    } catch (e) {
      setError('Could not read that file.');
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!pgn.trim()) {
      setError('Paste a PGN or choose a PGN file first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await broadcastsApi.importPgn(pgn);
      setResult(res);
    } catch (e) {
      setError(e.message || 'PGN import failed.');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setResult(null);
    setPgn('');
    setFileName('');
    setError(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  if (!isLoggedIn) {
    return (
      <div className="ev-import glass-panel">
        <h3 className="ev-import-title">Import a PGN</h3>
        <p className="ev-empty-note">
          Use this when an event is not covered by Lichess. Paste any PGN and the same free
          Stockfish pipeline will analyse it.
        </p>
        <p className="ev-login-hint">
          <Link to="/login">Log in</Link> to import a PGN and request analysis.
        </p>
      </div>
    );
  }

  if (result) {
    return (
      <div className="ev-import-result">
        <div className="ev-import-result-head">
          <div>
            <p className="ev-kicker">PGN import</p>
            <h3 className="ev-import-title">Analysis in progress</h3>
          </div>
          <button type="button" className="ev-text-btn interactive" onClick={reset}>
            Import another
          </button>
        </div>
        <AnalysisPanel
          roundId={result.round_id}
          gameId={result.game_id}
          isLoggedIn={isLoggedIn}
        />
      </div>
    );
  }

  return (
    <form className="ev-import glass-panel" onSubmit={submit}>
      <h3 className="ev-import-title">Import a PGN</h3>
      <p className="ev-empty-note">
        Use this when an event is not covered by Lichess. Paste a PGN or choose a file, and the
        free local Stockfish pipeline will analyse it.
      </p>
      <textarea
        className="ev-import-textarea"
        value={pgn}
        onChange={(e) => setPgn(e.target.value)}
        placeholder={'[Event "My tournament"]\n[White "Player A"]\n[Black "Player B"]\n\n1. e4 e5 2. Nf3 Nc6 ...'}
        rows={10}
        spellCheck={false}
      />
      <div className="ev-import-actions">
        <label className="ev-file-btn interactive">
          <input
            ref={fileRef}
            type="file"
            accept=".pgn,.txt,application/x-chess-pgn,text/plain"
            onChange={handleFile}
          />
          {fileName ? fileName : 'Choose PGN file'}
        </label>
        <button type="submit" className="btn-neon interactive" disabled={busy}>
          {busy ? 'Importing…' : 'Import & analyze'}
        </button>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
    </form>
  );
}
