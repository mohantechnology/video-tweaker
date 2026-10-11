/** Wait before applying a light control, such as volume or playback speed. */
export const LIGHT_APPLY_DELAY_MS = 10

/**
 * Wait before applying a heavy visual control.
 * Filters, blur, zoom, position, rotate, stretch, and crop repaint the video.
 */
export const HEAVY_APPLY_DELAY_MS = 10

/** How often a playing video writes its resume position. */
export const PROGRESS_SAVE_INTERVAL_MS = 3000

/**
 * How long the minimized bar stays up after the pointer stops.
 * The bar stays visible while the pointer is over it.
 */
export const MINIBAR_HIDE_DELAY_MS = 3000

/**
 * How long the on-video progress bar and its controls stay up
 * after the pointer stops moving. Move over the picture to show them again.
 */
export const PLAYER_CHROME_HIDE_MS = 3000

/** How often to look again for a player while none is selected. */
export const VIDEO_DETECT_INTERVAL_MS = 5000

/**
 * Wait after the player disappears before showing "No video detected".
 * A short preview, such as a search thumbnail, can come and go inside this window.
 */
export const NO_VIDEO_NOTICE_DELAY_MS = 5000
