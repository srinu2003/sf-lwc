import readline from 'node:readline';

/**
 * Perform a real-time fuzzy match of pattern against text.
 * Returns { match: boolean, score: number }.
 */
export function fuzzyMatch(pattern, text) {
  if (!pattern) return { match: true, score: 0 };
  if (!text) return { match: false, score: -1 };

  const p = pattern.toLowerCase();
  const t = text.toLowerCase();

  // 1. Exact substring match gets highest score
  const subIdx = t.indexOf(p);
  if (subIdx !== -1) {
    return {
      match: true,
      score: 1000 - subIdx * 10 - (t.length - p.length)
    };
  }

  // 2. Subsequence match with word-boundary and consecutive bonuses
  let pIdx = 0;
  let score = 0;
  let prevIdx = -2;

  for (let tIdx = 0; tIdx < t.length && pIdx < p.length; tIdx++) {
    if (t[tIdx] === p[pIdx]) {
      score += 10;
      if (tIdx === prevIdx + 1) score += 15; // Consecutive bonus
      if (tIdx === 0 || t[tIdx - 1] === '-' || t[tIdx - 1] === '_' || t[tIdx - 1] === ' ') {
        score += 25; // Word boundary bonus
      }
      prevIdx = tIdx;
      pIdx++;
    }
  }

  return pIdx === p.length ? { match: true, score } : { match: false, score: -1 };
}

/**
 * Filter and sort components based on fuzzy search query against name and description.
 */
export function filterComponents(components, query) {
  if (!Array.isArray(components)) return [];
  if (!query || !query.trim()) {
    return [...components];
  }

  const q = query.trim();
  const scored = [];

  for (const comp of components) {
    const nameMatch = fuzzyMatch(q, comp.name);
    const descMatch = fuzzyMatch(q, comp.description || '');

    if (nameMatch.match || descMatch.match) {
      // Heavily weight name matches (+500) so name hits appear before description hits
      const score =
        (nameMatch.match ? nameMatch.score + 500 : 0) +
        (descMatch.match ? descMatch.score : 0);
      scored.push({ comp, score });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.comp.name.localeCompare(b.comp.name);
  });

  return scored.map((s) => s.comp);
}

/**
 * Deterministic check for interactive TTY session.
 */
export function isInteractiveSession(
  stdin = process.stdin,
  stdout = process.stdout,
  flags = {}
) {
  if (flags.json) return false;
  if (process.env.CI && !stdin.isTTY) return false;
  return Boolean(stdin && stdin.isTTY && stdout && stdout.isTTY);
}

/**
 * Zero-dependency interactive terminal component selector.
 * Real-time fuzzy filtering, arrow navigation, spacebar multi-select, enter confirmation.
 *
 * @param {Array<{name: string, description?: string, version?: string}>} components
 * @param {object} [options]
 * @param {stream.Readable} [options.stdin] - Injectable input stream for testing
 * @param {stream.Writable} [options.stdout] - Injectable output stream for testing
 * @param {number} [options.pageSize=8] - Max visible items
 * @param {string} [options.header] - Custom prompt title
 * @param {boolean} [options.forceInteractive] - Force interactive execution in test mode
 * @returns {Promise<string[]>} Selected component names
 */
export async function selectComponents(components, options = {}) {
  if (!Array.isArray(components) || components.length === 0) {
    return [];
  }

  const stdin = options.stdin || options.input || process.stdin;
  const stdout = options.stdout || options.output || process.stdout;

  if (!stdin.isTTY && !options.forceInteractive) {
    throw new Error('Terminal is non-interactive (stdin is not a TTY)');
  }

  const pageSize = Math.max(3, Math.min(options.pageSize || 8, (stdout.rows || 24) - 6));
  const header = options.header || 'Select LWC components to add: (Type to search, Space to toggle, Enter to confirm)';

  return new Promise((resolve, reject) => {
    let query = '';
    let cursor = 0;
    const selected = new Set();
    let startIndex = 0;
    let lastRenderLineCount = 0;
    let cleanedUp = false;

    // Put stdin in raw mode if supported
    if (typeof stdin.setRawMode === 'function') {
      try {
        stdin.setRawMode(true);
      } catch (err) {
        if (!options.forceInteractive) {
          return reject(new Error(`Failed to set raw mode: ${err.message}`));
        }
      }
    }
    if (typeof stdin.resume === 'function') {
      stdin.resume();
    }
    readline.emitKeypressEvents(stdin);

    // Hide cursor during interactive session
    stdout.write('\x1b[?25l');

    function cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;

      process.removeListener('SIGINT', onSigint);
      stdin.removeListener('keypress', onKeypress);

      if (typeof stdin.setRawMode === 'function') {
        try {
          stdin.setRawMode(false);
        } catch {}
      }
      if (typeof stdin.pause === 'function') {
        stdin.pause();
      }

      // Restore cursor
      stdout.write('\x1b[?25h');
    }

    function clearRender() {
      if (lastRenderLineCount > 0) {
        let buf = '\r';
        for (let i = 0; i < lastRenderLineCount; i++) {
          buf += '\x1b[2K\x1b[1A';
        }
        buf += '\x1b[2K\r';
        stdout.write(buf);
        lastRenderLineCount = 0;
      }
    }

    function finish(results) {
      clearRender();
      cleanup();
      if (results && results.length > 0) {
        stdout.write(`\x1b[32m✔\x1b[0m Selected ${results.length} component(s): ${results.join(', ')}\n`);
      }
      resolve(results);
    }

    function cancel() {
      clearRender();
      cleanup();
      resolve([]);
    }

    function onSigint() {
      cancel();
    }
    process.once('SIGINT', onSigint);

    function render() {
      const filtered = filterComponents(components, query);

      // Keep cursor in valid range
      if (filtered.length === 0) {
        cursor = 0;
        startIndex = 0;
      } else {
        if (cursor >= filtered.length) cursor = filtered.length - 1;
        if (cursor < 0) cursor = 0;

        // Adjust scroll window
        if (cursor < startIndex) {
          startIndex = cursor;
        } else if (cursor >= startIndex + pageSize) {
          startIndex = cursor - pageSize + 1;
        }
        startIndex = Math.max(0, Math.min(startIndex, Math.max(0, filtered.length - pageSize)));
      }

      const lines = [];

      // Header prompt line
      lines.push(`\x1b[36m?\x1b[0m \x1b[1m${header}\x1b[0m`);

      // Search input line
      lines.push(`\x1b[36m›\x1b[0m ${query}`);
      lines.push('');

      const cols = stdout.columns || 80;

      if (filtered.length === 0) {
        lines.push('  \x1b[33mNo matching components found.\x1b[0m');
      } else {
        const visibleItems = filtered.slice(startIndex, startIndex + pageSize);

        if (startIndex > 0) {
          lines.push(`\x1b[90m  ↑ ${startIndex} more above\x1b[0m`);
        }

        for (let i = 0; i < visibleItems.length; i++) {
          const item = visibleItems[i];
          const actualIndex = startIndex + i;
          const isHighlighted = actualIndex === cursor;
          const isSelected = selected.has(item.name);

          const pointer = isHighlighted ? '\x1b[36m❯\x1b[0m ' : '  ';
          const checkbox = isSelected ? '\x1b[32m[x]\x1b[0m ' : '\x1b[90m[ ]\x1b[0m ';
          const name = isHighlighted ? `\x1b[1m\x1b[36m${item.name}\x1b[0m` : `\x1b[1m${item.name}\x1b[0m`;
          const version = item.version ? ` \x1b[90m(${item.version})\x1b[0m` : '';

          let desc = '';
          if (item.description) {
            const prefixPlainLen = 2 + 4 + item.name.length + (item.version ? item.version.length + 3 : 0) + 3;
            const maxDescLen = Math.max(10, cols - prefixPlainLen);
            let d = item.description;
            if (d.length > maxDescLen) {
              d = d.slice(0, Math.max(0, maxDescLen - 3)) + '...';
            }
            desc = ` \x1b[90m- ${d}\x1b[0m`;
          }

          lines.push(`${pointer}${checkbox}${name}${version}${desc}`);
        }

        const remainingBelow = filtered.length - (startIndex + visibleItems.length);
        if (remainingBelow > 0) {
          lines.push(`\x1b[90m  ↓ ${remainingBelow} more below\x1b[0m`);
        }
      }

      lines.push('');
      lines.push(`\x1b[90m(${selected.size} of ${components.length} selected) • ↑/↓ navigate • space select • enter confirm • esc cancel\x1b[0m`);

      // Clear previous frame
      let buf = '';
      if (lastRenderLineCount > 0) {
        buf += '\r';
        for (let i = 0; i < lastRenderLineCount; i++) {
          buf += '\x1b[2K\x1b[1A';
        }
        buf += '\x1b[2K\r';
      }

      buf += lines.join('\n') + '\n';
      stdout.write(buf);
      lastRenderLineCount = lines.length;
    }

    function onKeypress(str, key = {}) {
      if (cleanedUp) return;

      // Ctrl+C
      if ((key.ctrl && (key.name === 'c' || key.sequence === '\x03')) || str === '\x03') {
        cancel();
        return;
      }

      // Escape
      if (key.name === 'escape' || str === '\x1b' || key.sequence === '\x1b') {
        cancel();
        return;
      }

      // Enter / Return
      if (key.name === 'return' || key.name === 'enter' || str === '\r' || str === '\n' || key.sequence === '\r' || key.sequence === '\n') {
        const filtered = filterComponents(components, query);
        let results = [];
        if (selected.size > 0) {
          results = components.filter((c) => selected.has(c.name)).map((c) => c.name);
        } else if (filtered.length > 0) {
          results = [filtered[cursor].name];
        } else {
          results = [];
        }
        finish(results);
        return;
      }

      // Up Arrow
      if (key.name === 'up' || str === '\x1b[A' || key.sequence === '\x1b[A') {
        const filtered = filterComponents(components, query);
        if (filtered.length > 0) {
          cursor = (cursor - 1 + filtered.length) % filtered.length;
          render();
        }
        return;
      }

      // Down Arrow
      if (key.name === 'down' || str === '\x1b[B' || key.sequence === '\x1b[B') {
        const filtered = filterComponents(components, query);
        if (filtered.length > 0) {
          cursor = (cursor + 1) % filtered.length;
          render();
        }
        return;
      }

      // Spacebar toggle
      if (key.name === 'space' || str === ' ' || key.sequence === ' ') {
        const filtered = filterComponents(components, query);
        if (filtered.length > 0 && cursor < filtered.length) {
          const item = filtered[cursor];
          if (selected.has(item.name)) {
            selected.delete(item.name);
          } else {
            selected.add(item.name);
          }
          render();
        }
        return;
      }

      // Backspace
      if (key.name === 'backspace' || str === '\x08' || str === '\x7f' || key.sequence === '\x08' || key.sequence === '\x7f') {
        if (query.length > 0) {
          query = query.slice(0, -1);
          cursor = 0;
          startIndex = 0;
          render();
        }
        return;
      }

      // Printable character typing (letters, numbers, symbols)
      if (str && str.length === 1 && !key.ctrl && !key.meta && str >= ' ') {
        query += str;
        cursor = 0;
        startIndex = 0;
        render();
        return;
      }
    }

    stdin.on('keypress', onKeypress);

    // Initial render
    render();
  });
}
