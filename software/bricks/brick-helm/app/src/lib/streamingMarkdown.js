/** Close open fenced code blocks so partial streams render as markdown, not raw ```. */
export function stabilizeStreamingMarkdown(markdown, { streaming = false } = {}) {
  const raw = String(markdown || '');
  if (!streaming || !raw.trim()) return raw;

  const fenceCount = (raw.match(/```/g) || []).length;
  if (fenceCount % 2 === 1) {
    return `${raw}\n\`\`\``;
  }
  return raw;
}
