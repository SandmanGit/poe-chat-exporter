const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(`  ${err.message}`);
    process.exitCode = 1;
  }
}

test('normal export buttons request auto_export instead of visible-only extraction', () => {
  const popup = read('poe-exporter/popup/popup.js');
  assert(
    popup.includes("action: 'auto_export'") || popup.includes('action: "auto_export"'),
    'popup export flow must send an auto_export message before downloading'
  );
  assert(
    !popup.includes('手动滚动到对话最顶部'),
    'popup copy must not tell users manual top scrolling is required'
  );
});

test('batch extraction waits for loaded messages without a fixed 3.5 second delay', () => {
  const background = read('poe-exporter/background.js');
  assert(
    !background.includes('3500'),
    'background batch extraction must not depend on a fixed 3500ms timeout'
  );
  assert(
    background.includes('wait_for_messages'),
    'background must explicitly wait for messages to be ready before extraction'
  );
});

test('scroll export uses a stable full-message deduplication key', () => {
  const content = read('poe-exporter/content.js');
  assert(
    content.includes('createMessageKey'),
    'content script must centralize message deduplication in createMessageKey'
  );
  assert(
    !content.includes("substring(0, 100)") && !content.includes('substring(0,100)'),
    'deduplication must not use only the first 100 characters'
  );
});

test('scroll export triggers Poe history loading through message anchors and multiple scroll targets', () => {
  const content = read('poe-exporter/content.js');
  const background = read('poe-exporter/background.js');
  const manifest = read('poe-exporter/manifest.json');
  assert(
    content.includes('findScrollTargets'),
    'auto_export must evaluate multiple scroll targets, not a single assumed container'
  );
  assert(
    content.includes('getTrustedScrollPoint'),
    'auto_export must calculate trusted wheel coordinates from the active scroll target'
  );
  assert(
    !content.includes('scrollIntoView'),
    'auto_export must not call scrollIntoView during trusted wheel scrolling because it causes flicker'
  );
  assert(
    content.includes('if (trusted) return;'),
    'auto_export must skip DOM scroll fallback after trusted wheel events are sent'
  );
  assert(
    background.includes('attachedDebuggerTabs'),
    'background must keep debugger sessions attached during repeated wheel dispatches'
  );
  assert(
    background.includes("message.action === 'trusted_scroll_end'"),
    'background must detach debugger sessions after auto_export completes'
  );
  assert(
    content.includes('WheelEvent'),
    'auto_export must dispatch wheel events to trigger virtualized history loading'
  );
  assert(
    content.includes('document.scrollingElement'),
    'auto_export must include the document scrolling element as a fallback target'
  );
  assert(
    content.includes('probeScrollableTargets'),
    'auto_export must probe which targets actually move before the scroll loop'
  );
  assert(
    content.includes('describeScrollTarget'),
    'auto_export must log scroll target summaries for live debugging'
  );
  assert(
    content.includes('findHistoryEventTargets'),
    'auto_export must build fallback wheel event targets when no scrollTop target moves'
  );
  assert(
    content.includes('dispatchHistoryWheel'),
    'auto_export must dispatch upward wheel events even when no movable target is detected'
  );
  assert(
    manifest.includes('"debugger"'),
    'manifest must request debugger permission for trusted wheel events'
  );
  assert(
    content.includes('requestTrustedHistoryScroll'),
    'content script must request trusted background scrolling during auto_export'
  );
  assert(
    background.includes("message.action === 'trusted_scroll'"),
    'background must handle trusted_scroll messages'
  );
  assert(
    background.includes('Input.dispatchMouseEvent'),
    'background must dispatch Chrome DevTools Protocol mouseWheel events'
  );
});

test('project has README acceptance criteria for extension fixes', () => {
  const readmePath = path.join(root, 'README.md');
  assert(fs.existsSync(readmePath), 'root README.md must exist');

  const readme = fs.readFileSync(readmePath, 'utf8');
  assert(readme.includes('Acceptance Criteria'), 'README must include acceptance criteria');
  assert(readme.includes('node --check'), 'README must document JavaScript syntax verification');
});
