# Kryndexa local music backend

Kryndexa uses `@discordjs/voice` for Discord voice playback and does not require Lavalink or yt-dlp.

## Runtime

- Node.js 22.12+
- `@discordjs/voice`
- the maintained `@vookav2/play-dl` implementation installed through the existing `@iamtraction/play-dl` package alias
- bundled `ffmpeg-static`
- `prism-media`

The npm alias intentionally preserves the existing `require('@iamtraction/play-dl')` integration so the bot's queue, playlist, pause/resume, skip, shuffle, loop, volume and dashboard integrations do not need to be rewritten.

## Configuration

```env
MUSIC_ENABLED=true
MUSIC_DEFAULT_SEARCH_ENGINE=youtube
YOUTUBE_API_KEY=your_key_here
```

`YOUTUBE_API_KEY` is used to resolve YouTube playlists through the official YouTube Data API. Text search and direct video playback use the local music source library.

## Updating an existing Windows install

After pulling this branch, reinstall dependencies so npm replaces the old play-dl package with the maintained fork:

```powershell
Remove-Item -Recurse -Force node_modules\@iamtraction\play-dl -ErrorAction SilentlyContinue
npm install
npm start
```

If npm has retained an old dependency tree, run `npm install --force` once and then start the bot normally.

## Commands retained

The existing play, stop, skip, pause, resume, queue, volume, shuffle and loop commands continue to use the same local music manager and Discord voice connection lifecycle.
