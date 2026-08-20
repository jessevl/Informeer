/**
 * Kill switch for podcast (Audio tab) and YouTube (Video tab) functionality.
 *
 * The code for these features stays in the codebase — views, players, the
 * Add Feed dialog tabs, inline play buttons, etc. — but every entry point
 * into it checks this flag, and the heavy components (PodcastsView,
 * VideosView, AudioPlayer, VideoPlayer, react-player) are only ever
 * dynamically imported when it's true, so the browser never downloads
 * their JS while it's false.
 *
 * Flip to true to bring the feature back.
 */
export const PODCASTS_YOUTUBE_ENABLED = false;
