# Local music architecture

The production music manager remains intentionally local:

`play/search -> maintained play-dl source -> FFmpeg/prism-media -> @discordjs/voice -> Discord`

Lavalink and yt-dlp are not part of this path. The existing command-facing manager API remains unchanged so play, playlist queueing, skip, stop, pause/resume, volume, shuffle and loop continue to work with the dashboard/module system.

The package name `@iamtraction/play-dl` is retained as an npm alias for compatibility with the existing code, but npm installs the maintained `@vookav2/play-dl` implementation.
