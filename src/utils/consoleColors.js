const util = require('node:util');

const ANSI = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

let installed = false;

function installConsoleColors() {
  if (installed || process.env.NO_COLOR !== undefined) return;
  installed = true;

  const original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };

  const config = {
    log: { color: ANSI.green, icon: '✓' },
    info: { color: ANSI.cyan, icon: 'ℹ' },
    warn: { color: ANSI.yellow, icon: '⚠' },
    error: { color: ANSI.red, icon: '✖' },
    debug: { color: ANSI.gray, icon: '•' },
  };

  for (const level of Object.keys(config)) {
    console[level] = (...args) => {
      const { color, icon } = config[level];
      const text = util.format(...args);
      original[level](`${color}${icon} ${text}${ANSI.reset}`);
    };
  }

  // Expose the original methods for modules that already add their own ANSI colors.
  console._kryndexaOriginal = original;
}

module.exports = { installConsoleColors, ANSI };
