#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.resolve(ROOT, '..', '.cache', 'prompt-flow');
const PY = process.env.PYTHON || 'python';
const NODE = process.execPath;
const args = process.argv.slice(2);
const value = (name, fallback = '') => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const mode = (args[0] || 'help').replace(/^--/, '');
const provider = value('--provider', 'all');
const profile = value('--profile', '');
const allowSend = args.includes('--allow-send');
const maxMessages = Number(value('--max-messages', '4')) || 4;
const onlySuite = value('--suite', '');

const suites = [
  { id: 'unit', providers: ['all'], kind: 'fixtures', entry: 'node unit tests', command: [NODE, '--test', 'tests/*.test.cjs'] },
  { id: 'multi-attachment', providers: ['all'], kind: 'fixtures', entry: '5-file model, receipt, ChatGPT/Gemini/DeepSeek attach, conflicts and recovery', command: [NODE, '--test', 'tests/multi-attachment.test.cjs'] },
  { id: 'multi-attachment.dom', providers: ['all'], kind: 'fixtures', entry: 'Chromium local DOM five-card identity fixtures', command: [PY, 'tests/multi-attachment-dom.py'] },
  { id: 'chatgpt.identity', providers: ['chatgpt'], kind: 'fixtures', entry: 'content scripts + local DOM', command: [PY, 'tests/chatgpt-attachment-identity.py'], reports: ['chatgpt-attachment-identity-report.json'] },
  { id: 'chatgpt.dom', providers: ['chatgpt'], kind: 'fixtures', entry: 'content scripts + local DOM', command: [PY, 'tests/chatgpt-attachment-dom.py'], reports: ['chatgpt-attachment-dom-report.json'] },
  { id: 'chatgpt.basic', providers: ['chatgpt'], kind: 'fixtures', entry: 'workflow page Run button', command: [PY, 'tests/basic-flow-smoke.py', '--provider', 'chatgpt'], reports: ['basic-chatgpt-report.json'], images: ['basic-chatgpt-failure.png','basic-chatgpt-panel.png','basic-chatgpt-needs-user.png'] },
  { id: 'chatgpt.project', providers: ['chatgpt'], kind: 'fixtures', entry: 'workflow page Run button', command: [PY, 'tests/chatgpt-project-smoke.py'], reports: ['chatgpt-project-report.json'] },
  { id: 'chatgpt.multi', providers: ['chatgpt'], kind: 'fixtures', entry: 'workflow page Run / Pause / Resume', command: [PY, 'tests/chatgpt-multi-attachment-smoke.py'], reports: ['chatgpt-multi-attachment-report.json'] },
  { id: 'chatgpt.steps20', providers: ['chatgpt'], kind: 'fixtures', entry: 'workflow page Run / Pause / Resume', command: [PY, 'tests/chatgpt-20-step-smoke.py'], reports: ['chatgpt-20-step-report.json'] },
  { id: 'chatgpt.counter', providers: ['chatgpt'], kind: 'fixtures', entry: 'workflow page Run button', command: [PY, 'tests/chatgpt-counter-rename-smoke.py'], reports: ['chatgpt-counter-rename-report.json'] },
  { id: 'chatgpt.upload', providers: ['chatgpt'], kind: 'fixtures', entry: 'workflow page Run / Pause / Resume', command: [PY, 'tests/chatgpt-upload-resume-smoke.py'], reports: ['chatgpt-upload-resume-report.json'] },
  { id: 'chatgpt.upload-truncated', providers: ['chatgpt'], kind: 'fixtures', entry: 'workflow page Run / Pause / Resume', command: [PY, 'tests/chatgpt-upload-resume-smoke.py', '--truncated'], reports: ['chatgpt-truncated-upload-report.json'] },
  { id: 'chatgpt.unrelated-preview', providers: ['chatgpt'], kind: 'fixtures', entry: 'workflow page Run / Pause', command: [PY, 'tests/chatgpt-upload-resume-smoke.py', '--truncated', '--unrelated-preview'] },
  { id: 'chatgpt.folded', providers: ['chatgpt'], kind: 'fixtures', entry: 'workflow page Run / Resume', command: [PY, 'tests/folded-attachment-smoke.py'], reports: ['folded-attachment-report.json'] },
  { id: 'chatgpt.split-name', providers: ['chatgpt'], kind: 'fixtures', entry: 'workflow page Run button', command: [PY, 'tests/chatgpt-split-name-smoke.py'], reports: ['chatgpt-split-name-report.json'] },
  { id: 'gemini.basic', providers: ['gemini'], kind: 'fixtures', entry: 'workflow page Run button', command: [PY, 'tests/basic-flow-smoke.py', '--provider', 'gemini'], reports: ['basic-gemini-report.json'], images: ['basic-gemini-failure.png','basic-gemini-panel.png','basic-gemini-needs-user.png'] },
  { id: 'gemini.folded', providers: ['gemini'], kind: 'fixtures', entry: 'workflow page Run / Resume', command: [PY, 'tests/gemini-folded-smoke.py'], reports: ['gemini-folded-report.json'] },
  { id: 'gemini.upload', providers: ['gemini'], kind: 'fixtures', entry: 'workflow page Run button', command: [PY, 'tests/gemini-upload-smoke.py'], reports: ['gemini-upload-report.json'] },
  { id: 'deepseek.basic', providers: ['deepseek'], kind: 'fixtures', entry: 'workflow page Run button', command: [PY, 'tests/basic-flow-smoke.py', '--provider', 'deepseek'], reports: ['basic-deepseek-report.json'], images: ['basic-deepseek-failure.png','basic-deepseek-panel.png','basic-deepseek-needs-user.png'] },
  { id: 'deepseek.attachment', providers: ['deepseek'], kind: 'fixtures', entry: 'workflow page Run / Resume', command: [PY, 'tests/deepseek-attachment-smoke.py', '--recover'], reports: ['deepseek-attachment-report.json'] },
  { id: 'single-prompt', providers: ['all'], kind: 'fixtures', entry: 'extension sidepanel.html (single prompt)', command: [PY, 'tests/single-prompt-smoke.py', '--truncated'], reports: ['single-prompt-truncated-report.json'] },
  { id: 'self-test-chain', providers: ['all'], kind: 'fixtures', entry: 'extension side panel', command: [PY, 'tests/self-test-chain-smoke.py'], reports: ['self-test-chain-report.json'] },
  { id: 'native-panel', providers: ['all'], kind: 'fixtures', entry: 'native side panel (Edge)', command: [PY, 'tests/native-sidepanel-smoke.py'], reports: ['native-sidepanel-report.json'] },
  { id: 'connection', providers: ['all'], kind: 'fixtures', entry: 'workflow page connection light', command: [PY, 'tests/connection-state-smoke.py'], reports: ['connection-state-report.json'] },
];

function stamp() {
  const now = new Date();
  const pad = (v) => String(v).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function statusOf(exitCode, output) {
  if (exitCode === 0) return 'PASS';
  if (exitCode === 3 || /NEEDS_USER:/.test(output)) return 'NEEDS_USER';
  if (exitCode === 4 || /BLOCKED:/.test(output)) return 'BLOCKED';
  return 'FAIL';
}

function run(command, cwd, logPath) {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), { cwd, env: process.env, shell: false });
    let output = '';
    const write = (chunk) => { output += chunk.toString(); process.stdout.write(chunk); };
    child.stdout.on('data', write);
    child.stderr.on('data', write);
    child.on('error', (error) => { output += `\n${error.message}`; fs.writeFileSync(logPath, output); resolve({ code: 127, output }); });
    child.on('close', (code) => { fs.writeFileSync(logPath, output); resolve({ code: code ?? 1, output }); });
  });
}

function selectedSuites() {
  return suites.filter((suite) => {
    if (onlySuite && suite.id !== onlySuite) return false;
    if (provider === 'all') return true;
    return suite.providers.includes(provider) || suite.providers.includes('all');
  });
}

function printList() {
  for (const suite of suites) console.log(`${suite.id.padEnd(24)} ${suite.kind.padEnd(8)} ${suite.providers.join(',').padEnd(20)} ${suite.entry}`);
}

async function setup() {
  if (!profile) { console.log('NEEDS_USER: pass --profile <dedicated edge profile directory>'); process.exit(3); }
  const result = await run([PY, 'tests/verify-setup.py', '--profile', profile], ROOT, path.join(CACHE, 'verify-setup.log'));
  process.exit(result.code);
}

async function fixtures() {
  const dir = path.join(CACHE, 'verification', stamp());
  fs.mkdirSync(dir, { recursive: true });
  const results = [];
  const startedAt = new Date().toISOString();
  for (const suite of selectedSuites()) {
    const suiteDir = path.join(dir, suite.id);
    fs.mkdirSync(suiteDir, { recursive: true });
    for (const file of [...(suite.reports || []), ...(suite.images || [])]) {
      const stale = path.join(CACHE, file);
      if (fs.existsSync(stale)) fs.rmSync(stale);
    }
    console.log(`\n=== ${suite.id} (${suite.entry}) ===`);
    const start = Date.now();
    const { code, output } = await run(suite.command, ROOT, path.join(suiteDir, 'console.log'));
    if (suite.reports) {
      for (const report of suite.reports) {
        const source = path.join(CACHE, report);
        if (fs.existsSync(source)) fs.copyFileSync(source, path.join(suiteDir, report));
      }
    }
    for (const image of suite.images || []) {
      const source = path.join(CACHE, image);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(suiteDir, image));
    }
    const status = statusOf(code, output);
    results.push({ id: suite.id, status, exitCode: code, durationMs: Date.now() - start, entry: suite.entry, kind: suite.kind, artifacts: suiteDir, reports: suite.reports || [] });
    console.log(`[${status}] ${suite.id} (${Date.now() - start} ms)`);
  }
  const summary = results.reduce((acc, item) => { acc[item.status] = (acc[item.status] || 0) + 1; return acc; }, {});
  const report = { startedAt, finishedAt: new Date().toISOString(), mode: 'fixtures', provider, extensionVersion: JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version, git: gitHead(), summary, results };
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
  const lines = ['# Prompt Chain fixtures verification', '', `- started: ${startedAt}`, `- finished: ${report.finishedAt}`, `- provider: ${provider}`, `- extension: ${report.extensionVersion}`, `- git: ${report.git}`, '', '| suite | status | ms | entry |', '|---|---|---|---|', ...results.map((item) => `| ${item.id} | ${item.status} | ${item.durationMs} | ${item.entry} |`)];
  fs.writeFileSync(path.join(dir, 'report.md'), lines.join('\n'));
  console.log(`\n${JSON.stringify(summary)}`);
  console.log(`report: ${path.join(dir, 'report.md')}`);
  if (summary.FAIL) process.exit(1);
  if (summary.NEEDS_USER || summary.BLOCKED) process.exit(2);
}

async function live() {
  if (!['chatgpt', 'gemini', 'deepseek'].includes(provider)) {
    console.log('NEEDS_USER: live requires --provider chatgpt|gemini|deepseek'); process.exit(3);
  }
  if (!profile) { console.log('NEEDS_USER: pass --profile <dedicated edge profile prepared with setup>'); process.exit(3); }
  if (!allowSend) { console.log('NEEDS_USER: live sends require --allow-send and a dedicated test conversation'); process.exit(3); }
  const dir = path.join(CACHE, 'verification', `live-${stamp()}`);
  fs.mkdirSync(dir, { recursive: true });
  const command = [PY, 'tests/basic-flow-smoke.py', '--live', '--provider', provider, '--profile', profile, '--out', dir, '--max-messages', String(maxMessages), '--allow-send'];
  console.log(`\n=== live ${provider} (max ${maxMessages} messages) ===`);
  const { code, output } = await run(command, ROOT, path.join(dir, 'console.log'));
  const status = statusOf(code, output);
  fs.writeFileSync(path.join(dir, 'report.md'), `# Prompt Chain live verification\n\n- provider: ${provider}\n- status: ${status}\n- maxMessages: ${maxMessages}\n- profile: ${profile}\n`);
  console.log(`[${status}] live ${provider}`);
  process.exit(code === 0 ? 0 : status === 'FAIL' ? 1 : 2);
}

function gitHead() {
  try {
    const head = fs.readFileSync(path.join(ROOT, '.git', 'HEAD'), 'utf8').trim();
    if (head.startsWith('ref: ')) return fs.readFileSync(path.join(ROOT, '.git', head.slice(5)), 'utf8').trim();
    return head;
  } catch { return ''; }
}

if (mode === 'list') printList();
else if (mode === 'setup') await setup();
else if (mode === 'fixtures') await fixtures();
else if (mode === 'live') await live();
else {
  console.log('usage: node verify.mjs <list|setup|fixtures|live> [--provider chatgpt|gemini|deepseek|all] [--suite id] [--profile DIR] [--allow-send] [--max-messages N]');
  process.exit(2);
}
