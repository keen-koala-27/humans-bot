// shoot.mjs — renders this entry's two images with headless Chromium over CDP.
//
//   node shoot.mjs
//
// Produces, beside this file:
//   screenshot.png — a GitHub-style rendering of README.md (repo chrome + guide)
//   ad.png         — a full-page capture of index.html
//
// No dependencies: Node 22's built-in WebSocket drives the DevTools protocol.
// The Chromium binary is the one under ~/.cloakbrowser (override: CHROME_BIN).

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9355;

// ---------------------------------------------------------------- chromium ---
function findChrome() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const root = join(process.env.HOME, '.cloakbrowser');
  for (const dir of readdirSync(root)) {
    const base = join(root, dir);
    if (!statSync(base).isDirectory()) continue; // skip files like .last_update_check
    for (const sub of ['chrome', 'chrome-linux/chrome', 'Chromium.app/Contents/MacOS/Chromium']) {
      const p = join(root, dir, sub);
      if (existsSync(p)) return p;
    }
    // fall back: any executable-looking file one level down
    for (const f of readdirSync(base)) {
      const p = join(base, f);
      if (/chrom/i.test(f) && existsSync(p)) return p;
    }
  }
  throw new Error('no Chromium binary found under ~/.cloakbrowser; set CHROME_BIN');
}

// ------------------------------------------------------------- markdown -----
// A small GitHub-flavoured renderer for the subset README.md uses: headings,
// paragraphs, bold/italic/inline code, links, images, lists, blockquotes,
// fenced code, horizontal rules and raw-HTML lines.
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function inline(s) {
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  return s;
}
function renderMarkdown(md) {
  const lines = md.split('\n');
  const out = [];
  let i = 0, list = null;
  const closeList = () => { if (list) { out.push(list === 'ul' ? '</ul>' : '</ol>'); list = null; } };
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      closeList();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if (/^\s*$/.test(line)) { closeList(); i++; continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^---+\s*$/.test(line)) { closeList(); out.push('<hr>'); i++; continue; }
    if (/^>\s?/.test(line)) {
      closeList();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${buf.map(inline).join('<br>')}</blockquote>`);
      continue;
    }
    const ul = line.match(/^[-*]\s+(.*)$/);
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ul || ol) {
      const kind = ul ? 'ul' : 'ol';
      if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inline((ul || ol)[1])}</li>`);
      i++; continue;
    }
    closeList();
    if (/^</.test(line.trim())) { out.push(line); i++; continue; } // raw HTML line (badges use md images; the <sub> footer)
    const buf = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6}\s|```|---+\s*$|>\s?|[-*]\s|\d+\.\s)/.test(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  closeList();
  return out.join('\n');
}

// ------------------------------------------------------- github page shell --
function githubShell(readmeHtml) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box} body{margin:0;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;background:#fff;color:#1f2328}
  .gh-header{background:#010409;color:#fff;padding:14px 24px;display:flex;gap:16px;align-items:center;font-size:14px}
  .gh-header .logo{width:30px;height:30px;border-radius:50%;background:#fff;color:#010409;display:flex;align-items:center;justify-content:center;font-weight:700}
  .gh-header input{background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#7d8590;padding:5px 12px;width:300px;font-size:13px}
  .repo-bar{padding:18px 24px 0;border-bottom:1px solid #d1d9e0;background:#f6f8fa}
  .repo-name{font-size:20px;color:#0969da} .repo-name b{font-weight:600}
  .pill{border:1px solid #d1d9e0;border-radius:2em;padding:0 8px;font-size:12px;color:#59636e;margin-left:8px;background:#fff}
  .tabs{display:flex;gap:22px;margin-top:14px;font-size:14px}
  .tabs span{padding:8px 2px} .tabs .on{border-bottom:2px solid #fd8c73;font-weight:600}
  .page{max-width:1080px;margin:0 auto;padding:24px}
  .filebox{border:1px solid #d1d9e0;border-radius:6px}
  .filebox-head{background:#f6f8fa;border-bottom:1px solid #d1d9e0;padding:10px 16px;font-size:14px;font-weight:600}
  .md{padding:32px 40px;font-size:16px;line-height:1.6}
  .md h1{font-size:2em;border-bottom:1px solid #d1d9e0;padding-bottom:.3em;margin:.4em 0 .6em}
  .md h2{font-size:1.5em;border-bottom:1px solid #d1d9e0;padding-bottom:.3em;margin-top:1.2em}
  .md h3{font-size:1.25em;margin-top:1.2em}
  .md a{color:#0969da;text-decoration:none}
  .md code{background:rgba(129,139,152,.12);padding:.2em .4em;border-radius:6px;font-size:85%;font-family:ui-monospace,Menlo,Consolas,monospace}
  .md pre{background:#f6f8fa;border-radius:6px;padding:16px;overflow:auto}
  .md pre code{background:transparent;padding:0}
  .md blockquote{border-left:.25em solid #d1d9e0;color:#59636e;padding:0 1em;margin:0 0 16px}
  .md hr{height:.25em;background:#d1d9e0;border:0;margin:24px 0}
  .md img{max-width:100%}
  .md li{margin:.25em 0}
  </style></head><body>
  <div class="gh-header"><div class="logo">G</div><input value="Type / to search" readonly><span>Pull requests</span><span>Issues</span><span>Marketplace</span><span>Explore</span></div>
  <div class="repo-bar"><span class="repo-name">keen-koala-27 / <b>humans-bot</b></span><span class="pill">Public</span>
    <div class="tabs"><span class="on">Code</span><span>Issues</span><span>Pull requests</span><span>Actions</span><span>Projects</span><span>Security</span><span>Insights</span></div></div>
  <div class="page"><div class="filebox"><div class="filebox-head">README.md</div><article class="md">
${readmeHtml}
  </article></div></div></body></html>`;
}

// -------------------------------------------------------------------- CDP ---
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot(chrome, url, outFile, width) {
  const proc = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`, `--window-size=${width},1000`, 'about:blank',
  ], { stdio: 'ignore' });
  try {
    let wsUrl = null;
    for (let t = 0; t < 60 && !wsUrl; t++) {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
        wsUrl = (await r.json()).webSocketDebuggerUrl;
      } catch { await sleep(250); }
    }
    if (!wsUrl) throw new Error('devtools endpoint never came up');
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let seq = 0;
    const pending = new Map();
    const events = [];
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      else if (msg.method) events.push(msg.method);
    };
    const send = (method, params = {}, sessionId) => new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
    const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    await send('Emulation.setDeviceMetricsOverride',
      { width, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send('Page.navigate', { url }, sessionId);
    for (let t = 0; t < 40 && !events.includes('Page.loadEventFired'); t++) await sleep(250);
    await sleep(1200); // fonts, badge images
    const { result: shot } = await send('Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: true }, sessionId);
    if (!shot || !shot.data) throw new Error('captureScreenshot returned nothing');
    writeFileSync(outFile, Buffer.from(shot.data, 'base64'));
    ws.close();
    console.log('wrote', outFile);
  } finally {
    proc.kill('SIGKILL');
  }
}

// ------------------------------------------------------------------- main ---
const chrome = findChrome();
const readme = readFileSync(join(HERE, 'README.md'), 'utf8');
const preview = join(tmpdir(), 'humans-bot-readme-preview.html');
writeFileSync(preview, githubShell(renderMarkdown(readme)));
try {
  await shoot(chrome, 'file://' + preview, join(HERE, 'screenshot.png'), 1280);
  await shoot(chrome, 'file://' + join(HERE, 'index.html'), join(HERE, 'ad.png'), 1200);
} finally {
  unlinkSync(preview);
}
