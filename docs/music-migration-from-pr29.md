# Migration from experimental PR #29

PR #29 was closed without merging. This repair branch is based directly on current `master`, so it does not include `src/music/ytdlp.js`, `YTDLP_PATH`, `YTDLP_COOKIES_FILE`, or the yt-dlp/FFmpeg stdout pipeline that produced silent Discord playback during testing.

The bot remains on its existing local `@discordjs/voice` manager and refreshes only the source implementation used by that manager.
