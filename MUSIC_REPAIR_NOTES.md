# Music repair

This branch restores the post-Lavalink local music architecture and removes the need for the experimental yt-dlp PR.

## Changes

- Keeps `@discordjs/voice` as the Discord voice backend.
- Keeps the existing Kryndexa music manager and command API intact.
- Replaces the stale `@iamtraction/play-dl` package implementation with the maintained `@vookav2/play-dl` fork through an npm alias, so existing imports continue to work.
- Keeps bundled FFmpeg/prism-media playback.
- Keeps YouTube Data API playlist resolution already present on master.
- Adds dependency and source smoke-test scripts for Windows troubleshooting.
- Does not require Lavalink.
- Does not require yt-dlp.

## Windows update

After pulling the branch, run:

```powershell
Remove-Item -Recurse -Force node_modules\@iamtraction\play-dl -ErrorAction SilentlyContinue
npm install
npm run check:music
npm run test:music
npm start
```

Then test `/play` in Discord.
