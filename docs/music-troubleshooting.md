# Music troubleshooting

Run `npm run check:music` first. It verifies the Discord voice package, music source adapter, FFmpeg executable and prism-media installation.

Run `npm run test:music -- "song name"` to test YouTube search and opening a stream without joining Discord voice.

If the smoke test works but Discord is silent, verify the bot has View Channel, Connect and Speak permissions in the target voice channel and verify the bot is not server-muted.

If npm still loads an old play-dl implementation after pulling this branch, run `powershell -ExecutionPolicy Bypass -File scripts/music-install.ps1` to refresh the music dependency.
