const { spawn } = require('node:child_process');
const fs = require('node:fs');

function ytDlpExecutable() {
  return String(process.env.YTDLP_PATH || 'yt-dlp').trim() || 'yt-dlp';
}

function buildArgs(url) {
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--quiet',
    '--js-runtimes', 'node',
    '-f', 'bestaudio/best',
    '-o', '-',
  ];

  const cookiesFile = String(process.env.YTDLP_COOKIES_FILE || '').trim();
  if (cookiesFile) {
    if (!fs.existsSync(cookiesFile)) {
      throw new Error(`YTDLP_COOKIES_FILE does not exist: ${cookiesFile}`);
    }
    args.push('--cookies', cookiesFile);
  }

  // Keep arbitrary command-line injection out of the environment. Add supported
  // yt-dlp options explicitly here as they are needed.
  args.push(url);
  return args;
}

function friendlyYtDlpError(stderr, error) {
  const detail = String(stderr || error?.message || error || '').trim();
  if (/sign in to confirm you.?re not a bot|login_required/i.test(detail)) {
    return new Error(
      'YouTube rejected the playback request as automated. Update yt-dlp first. ' +
      'If this server/IP is challenged by YouTube, configure YTDLP_COOKIES_FILE with a valid Netscape cookies file or use a different clean server IP. ' +
      'Do not commit cookies to GitHub.'
    );
  }
  if (/javascript runtime|js runtime/i.test(detail)) {
    return new Error('yt-dlp requires a supported JavaScript runtime. Kryndexa uses Node; ensure Node 22+ is installed and available in PATH.');
  }
  if (/not recognized|enoent|no such file|cannot find/i.test(detail)) {
    return new Error('yt-dlp was not found. Install the current yt-dlp executable and add it to PATH, or set YTDLP_PATH to yt-dlp.exe.');
  }
  return new Error(`yt-dlp could not open this YouTube track${detail ? `: ${detail.slice(-700)}` : '.'}`);
}

/**
 * Starts yt-dlp and exposes its media output as a Node readable stream.
 * The caller pipes this into FFmpeg, so no temporary audio files are created.
 */
function createYouTubeAudioStream(url) {
  const target = String(url || '').trim();
  if (!/^https?:\/\//i.test(target)) throw new Error('A valid YouTube URL is required.');

  const child = spawn(ytDlpExecutable(), buildArgs(target), {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  let settled = false;
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-8000);
  });

  // Surface startup/extractor failures through the readable stream so the
  // existing music-player failure path can skip the bad track cleanly.
  child.on('error', (error) => {
    if (settled) return;
    settled = true;
    child.stdout.destroy(friendlyYtDlpError(stderr, error));
  });
  child.on('close', (code) => {
    if (code === 0) return;
    if (settled) return;
    settled = true;
    child.stdout.destroy(friendlyYtDlpError(stderr, new Error(`yt-dlp exited with code ${code}`)));
  });

  return {
    stream: child.stdout,
    destroy() {
      settled = true;
      if (!child.killed) child.kill();
    },
  };
}

module.exports = { createYouTubeAudioStream };
