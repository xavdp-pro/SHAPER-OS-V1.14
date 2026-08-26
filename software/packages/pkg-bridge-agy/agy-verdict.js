/**
 * Read agy JSON output — judge the response, not only status (AGENT-CLIS §3).
 * write_to_file failures often end with ERROR even when shell edits succeeded.
 */
export function interpretAgyVerdict(raw) {
  const d = JSON.parse(raw);
  const note = d.error || '';
  const artifactOnly = /not a valid artifact path/i.test(note);
  const substantive = Boolean(d.response && String(d.response).trim().length > 80);
  const ok = d.status === 'SUCCESS' || (artifactOnly && substantive);
  const status = d.status === 'SUCCESS'
    ? 'SUCCESS'
    : (artifactOnly && substantive ? 'SUCCESS_WITH_ARTIFACT_WARN' : d.status);
  return {
    ok,
    status,
    note,
    tokens: d.usage?.total_tokens ?? 0,
  };
}
