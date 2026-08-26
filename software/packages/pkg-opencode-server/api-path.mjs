export function withDirectory(pathname, directory) {
  if (!directory) return pathname;
  const separator = pathname.includes('?') ? '&' : '?';
  return `${pathname}${separator}directory=${encodeURIComponent(directory)}`;
}

export function unwrapGlobalEvent(event) {
  if (event?.payload && typeof event.payload === 'object') return event.payload;
  return event;
}
