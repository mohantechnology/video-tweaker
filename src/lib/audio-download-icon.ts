/** Headphones with a download arrow, matching the audio-save control. */
export function audioDownloadMarkup(_strokeWidth = 1.75): string {
  return `<g fill="currentColor"><path d="M12 3.15a7.15 7.15 0 0 0-7.15 7.15v1.45h2.45v-1.45a4.7 4.7 0 0 1 9.4 0v1.45h2.45v-1.45A7.15 7.15 0 0 0 12 3.15z"/><rect x="3.05" y="10.85" width="3.85" height="6.55" rx="1.15"/><rect x="17.1" y="10.85" width="3.85" height="6.55" rx="1.15"/><path d="M10.9 8.55h2.2v3.45h2.05L12 15.85 8.85 12h2.05z"/><rect x="8.55" y="17.7" width="6.9" height="1.35" rx="0.4"/></g>`
}

export function audioDownloadSvg(size: number | string = 16, strokeWidth = 1.75): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${audioDownloadMarkup(strokeWidth)}</svg>`
}
