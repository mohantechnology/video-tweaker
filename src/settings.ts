/** Wait before applying a light control, such as volume or playback speed. */
export const LIGHT_APPLY_DELAY_MS = 10

/**
 * Wait before applying a heavy visual control.
 * Filters, blur, zoom, rotate, stretch, and crop repaint the video.
 */
export const HEAVY_APPLY_DELAY_MS = 10

/** How often a playing video writes its resume position. */
export const PROGRESS_SAVE_INTERVAL_MS = 3000
