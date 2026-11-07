// Run against a local v5 service after its fixed-case cache has been built.
// --candidate-preview skips the fixed cache check on an isolated preview.
// node experiments/body-lab/candidates/model-repair-20261106/browser-check.mjs
// --check-config reads local inputs only; it never opens a browser or the service.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const screenshots = path.join(here, 'screenshots');
const candidatePreview = process.argv.includes('--candidate-preview');
const elbowOnly = process.argv.includes('--elbow-filter-only');
const executablePath = process.env.BODYVISTA_CHROME || undefined;
const pageUrl = new URL('/experiments/body-lab/', process.env.BODYVISTA_URL || 'http://127.0.0.1:4192');
const expectedModel = 'ms740-shoulder-hand-franko-v5';
const previousModel = 'ms740-knee-rotation-bodyvista-research-v3';
const fixtureId = process.env.BODYVISTA_FIXTURE || 'custom_right_rotate_bend_make_fist';
assert.ok(['custom_right_rotate_bend_make_fist', 'custom_left_open_while_rotating'].includes(fixtureId), '只能选择预先固定的自定义动作');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(pageUrl.hostname), '验收仅使用本机服务');
assert.ok(process.argv.slice(2).every(arg => ['--check-config', '--candidate-preview', '--elbow-filter-only'].includes(arg)), '未知命令参数');
if (candidatePreview) assert.notEqual(pageUrl.port, '4192', '候选预览不能使用正式 4192 服务');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fixtureBytes = await fs.readFile(path.join(here, 'fingers', 'franko-native-candidate', 'custom-motion-inputs.json'));
assert.equal(sha256(fixtureBytes), '90d16350e77827d2014ca14f2df5159f9333c7ce60ecc1ed71165e7590a6e50c', '自定义动作偏离已固定输入');
const fixture = JSON.parse(fixtureBytes).cases.find(item => item.id === fixtureId);
assert.ok(fixture?.expectedFeasible === true && fixture.scene.keyframes.length === 3, '缺少三关键帧自定义动作');
const side = fixture.scene.hand === 'right' ? 'r' : 'l';
const fingerSuffix = side === 'r' ? '' : '_l';
const compoundAxes = [`flexion_${side}`, `pro_sup_${side}`,
  ...[2, 3, 4, 5].flatMap(digit => ['mcp', 'pm', 'md'].map(joint => `${digit}${joint}_flexion${fingerSuffix}`))];
const compoundChanges = Object.fromEntries(compoundAxes.map(name => {
  const values = fixture.scene.keyframes.map(key => key.q[name]);
  assert.ok(values.every(Number.isFinite) && values[0] !== values[1], `第一段缺少同步运动 ${name}`);
  return [name, values];
}));
const manifest = JSON.parse(await fs.readFile(path.join(here, '..', 'runtime', 'expanded-motion-repair-v5-manifest.json'), 'utf8'));
assert.equal(manifest.modelId, expectedModel);
assert.equal(manifest.transmissionStatus, 'selected');
if (process.argv.includes('--check-config')) {
  console.log(JSON.stringify({ status: 'configuration-only', candidatePreview, elbowOnly, fixtureId, expectedModel, pageUrl: pageUrl.href,
    fixtureSha256: sha256(fixtureBytes), keyframeTimes: fixture.scene.keyframes.map(key => key.t),
    compoundChanges, browserNotLaunched: true }, null, 2));
  process.exit(0);
}

async function loadChromium() {
  const require = createRequire(import.meta.url);
  const configured = process.env.BODYVISTA_PLAYWRIGHT_MODULE;
  let filename;
  if (configured) {
    const input = configured.startsWith('file:') ? fileURLToPath(configured)
      : configured.startsWith('.') ? path.resolve(configured) : configured;
    filename = require.resolve(input);
  } else {
    for (const name of ['playwright', 'playwright-core']) {
      try { filename = require.resolve(name); break; }
      catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
    }
  }
  assert.ok(filename, '找不到本地 Playwright。请用 BODYVISTA_PLAYWRIGHT_MODULE 指向已安装的 playwright 或 playwright-core。');
  const api = await import(pathToFileURL(filename).href);
  const chromium = api.chromium ?? api.default?.chromium;
  assert.equal(typeof chromium?.launch, 'function', '指定模块未提供 Playwright Chromium');
  return chromium;
}

async function launchBrowser() {
  if (executablePath) await fs.access(executablePath);
  const chromium = await loadChromium();
  return chromium.launch({ headless: true, executablePath,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
}

async function checkElbowFilter(browser) {
  const demo = JSON.parse(await fs.readFile(path.resolve(here, '../../../elbow-lab/demo.json'), 'utf8'));
  const cases = [
    { id: 'archived-demo', expected: [0, 1, 2, 3, 4, 5] },
    { id: 'ui-mixed-range', expected: [0, 4] }, { id: 'ui-constant', expected: [] },
  ];
  const results = [];
  for (const test of cases) {
    const context = await browser.newContext();
    try {
      const offlineInputs = structuredClone(demo);
      if (test.id !== 'archived-demo') {
        // Synthetic selector inputs only. Two controlled traces distinguish
        // the loaded/reference branches and the exact 0.01 N exclusion.
        offlineInputs.frames = [demo.frames[0], demo.frames.at(-1)].map((frame, i) => ({
          ...frame, forces: [test.id === 'ui-mixed-range' ? .04 * i : 0, 0, .01 * i, 0, 0, 0],
          referenceForces: [0, 0, 0, 0, test.id === 'ui-mixed-range' ? .03 * i : 0, 0],
        }));
      }
      let posts = 0;
      await context.route('**/api/**', async route => {
        if (route.request().method() === 'POST') posts += 1;
        await route.fulfill({ status: 503, body: 'Offline selector fixture' });
      });
      await context.route('**/experiments/elbow-lab/demo.json', route => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(offlineInputs),
      }));
      const page = await context.newPage();
      await page.goto(new URL('/experiments/elbow-lab/?demo=1', pageUrl).href, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => /仅列出整段张力|当前动作没有整段张力/.test(
        document.querySelector('#muscleFilterNote')?.textContent || ''), null, { timeout: 60000 });
      const select = page.locator('#muscle');
      const selected = await select.locator('option').evaluateAll(options =>
        options.filter(option => option.value !== '').map(option => Number(option.value)));
      assert.deepEqual(selected, test.expected);
      assert.equal(await select.isDisabled(), test.expected.length === 0);
      const enabled = await page.locator('#muscleRows button').evaluateAll(buttons =>
        buttons.flatMap((button, i) => button.disabled ? [] : [i]));
      assert.deepEqual(enabled, test.expected);
      assert.equal(posts, 0);
      results.push({ fixture: test.id, selectableIndices: selected, tableButtonsEnabled: enabled });
    } finally {
      await context.close();
    }
  }
  return results;
}

if (elbowOnly) {
  const browser = await launchBrowser();
  try {
    console.log(JSON.stringify({ scope: 'elbow-observer-ui-only', cases: await checkElbowFilter(browser) }, null, 2));
  } finally {
    await browser.close();
  }
  process.exit(0);
}

const startedAt = new Date().toISOString();
const runId = startedAt.replace(/[:.]/g, '-');
const reportPath = path.join(screenshots, `${runId}-${fixtureId}-browser-checks.json`);
const evidence = { status: 'running', candidatePreview, publicationValidated: false, startedAt, pageUrl: pageUrl.href, fixtureId,
  fixtureSha256: sha256(fixtureBytes), scriptSha256: sha256(await fs.readFile(fileURLToPath(import.meta.url))),
  expectedModel, compoundChanges, checks: [], pageErrors: [], network: [], screenshots: [] };
let browser, activePage, phase = 'launch';
await fs.mkdir(screenshots, { recursive: true });
const writeEvidence = () => fs.writeFile(reportPath, JSON.stringify(evidence, null, 2) + '\n');
async function record(name, data) {
  evidence.checks.push({ name, passed: true, at: new Date().toISOString(), ...data });
  await writeEvidence();
  console.log(JSON.stringify({ name, passed: true, ...data }));
}
async function screenshot(page, name) {
  const filename = `${runId}-${name}.png`;
  await page.screenshot({ path: path.join(screenshots, filename), fullPage: true });
  evidence.screenshots.push({ name, file: filename });
  return filename;
}
function observe(page, contextName) {
  page.on('pageerror', error => evidence.pageErrors.push({ context: contextName, message: error.message }));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/fullbody/') || /\/motion-cache\/[a-f0-9]{64}\.json$/.test(url.pathname))
      evidence.network.push({ context: contextName, method: request.method(), path: url.pathname, at: new Date().toISOString() });
  });
}
const isApi = (response, endpoint) => new URL(response.url()).pathname === `/api/fullbody/${endpoint}`;
const solveCount = () => evidence.network.filter(item => item.path === '/api/fullbody/solve').length;
const cacheRequests = () => evidence.network.filter(item => /\/motion-cache\/[a-f0-9]{64}\.json$/.test(item.path));
const solveCaptures = new WeakMap();
async function ready(page) {
  await page.waitForFunction(() => {
    const button = document.querySelector('#checkPose');
    return button && !button.disabled;
  }, null, { timeout: 180000 });
}
async function openPage(context, name) {
  const page = await context.newPage();
  // Full-body responses contain every sampled path as well as all forces.
  // Capture and read through the same inspector; Playwright's own session has
  // a different response cache. This observes the user's single real request.
  const inspector = await context.newCDPSession(page);
  await inspector.send('Network.enable', {
    maxTotalBufferSize: 128 * 1024 * 1024,
    maxResourceBufferSize: 64 * 1024 * 1024,
    maxPostDataSize: 2 * 1024 * 1024,
  });
  let finishCapture;
  const capture = { count: 0, request: null, status: null,
    completed: new Promise(resolve => { finishCapture = resolve; }) };
  solveCaptures.set(page, capture);
  inspector.on('Network.requestWillBeSent', ({ requestId, request }) => {
    if (new URL(request.url).pathname !== '/api/fullbody/solve') return;
    capture.count += 1;
    if (capture.count === 1) capture.request = { requestId, ...request };
  });
  inspector.on('Network.responseReceived', ({ requestId, response }) => {
    if (requestId === capture.request?.requestId) capture.status = response.status;
  });
  inspector.on('Network.loadingFinished', ({ requestId }) => {
    if (requestId !== capture.request?.requestId) return;
    inspector.send('Network.getResponseBody', { requestId }).then(
      value => finishCapture({ value }), error => finishCapture({ error }),
    );
  });
  inspector.on('Network.loadingFailed', ({ requestId, errorText }) => {
    if (requestId === capture.request?.requestId) finishCapture({ error: new Error(errorText) });
  });
  activePage = page;
  page.setDefaultTimeout(60000);
  observe(page, name);
  const modelResponse = page.waitForResponse(response => isApi(response, 'model'), { timeout: 120000 });
  await page.goto(pageUrl.href, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const response = await modelResponse;
  assert.equal(response.status(), 200, '页面模型 API 请求未成功');
  const model = await response.json();
  assert.equal(model.id, expectedModel, '本地服务尚未加载 v5 模型');
  assert.equal(model.sourceSha256, manifest.derivedSha256);
  assert.equal(model.transmissionStatus, 'selected');
  assert.deepEqual(model.effectiveTendonTransmission, manifest.effectiveTendonTransmission);
  assert.equal(model.muscles.length, 740, '模型必须保留 740 个肌腱单元');
  assert.equal(model.handReferenceCoordinates?.length, 24, '缺少手指参考被动项声明');
  assert.ok(model.compatiblePoseModels.includes(previousModel), 'v5 未声明 v3 姿势兼容');
  assert.match(model.sourceSha256, /^[a-f0-9]{64}$/);
  assert.match(model.computationSha256, /^[a-f0-9]{64}$/);
  await page.waitForFunction(() => document.querySelector('#connection')?.textContent.includes('模型已连接'), null, { timeout: 180000 });
  return { page, model };
}
async function readCapturedSolve(page, response, submitted) {
  const capture = solveCaptures.get(page);
  let timer;
  try {
    const result = await Promise.race([capture.completed, new Promise(resolve => {
      timer = setTimeout(() => resolve({ error: new Error('同一次求解响应读取超时') }), 60000);
    })]);
    if (result.error) throw result.error;
    assert.equal(capture.count, 1, '验收不应发送第二次求解请求');
    assert.equal(capture.request.url, response.url());
    assert.equal(capture.request.method, 'POST');
    assert.equal(capture.status, response.status());
    assert.deepEqual(JSON.parse(capture.request.postData), submitted, '捕获的请求与页面实际提交不一致');
    const bytes = Buffer.from(result.value.body, result.value.base64Encoded ? 'base64' : 'utf8');
    evidence.solveResponseCapture = { requestId: capture.request.requestId, bytes: bytes.length,
      decodedSha256: sha256(bytes), source: 'same-request-same-inspector-session' };
    return JSON.parse(bytes.toString('utf8'));
  } finally { clearTimeout(timer); }
}
async function readStoredScene(page, key) {
  return page.evaluate(storageKey => {
    const saved = localStorage.getItem(storageKey);
    return saved === null ? null : JSON.parse(saved);
  }, key);
}
function assertSolved(value, model) {
  assert.equal(value.model, expectedModel);
  assert.equal(value.computationSha256, model.computationSha256);
  assert.equal(value.status, 'solved');
  assert.equal(value.quantitativeValid, true);
  assert.equal(value.kinematicOnly, false);
  assert.deepEqual(value.failures, []);
  assert.ok(value.frames.length > 2, '必须实算整段动作，不能只返回首尾姿势');
  assert.equal(value.metrics.frames, value.frames.length);
  assert.equal(value.scene.keyframes.length, fixture.scene.keyframes.length);
  value.scene.keyframes.forEach((key, index) => {
    assert.equal(key.t, fixture.scene.keyframes[index].t);
    for (const [name, angle] of Object.entries(fixture.scene.keyframes[index].q))
      assert.equal(key.q[name], angle, `求解场景改变了 fixture 中的 ${name}`);
  });
  const expectedNames = model.muscles.map(muscle => muscle.name).sort();
  const definitions = new Map(model.muscles.map(muscle => [muscle.name, muscle.branches || []]));
  for (const frame of value.frames) {
    assert.equal(frame.quantitativeValid, true);
    assert.equal(frame.frameFeasible, true);
    assert.equal(frame.muscleValid, true);
    for (const [object, flag] of [['anatomy', 'valid'], ['support', 'feasible'], ['groundCheck', 'feasible']])
      assert.equal(frame[object]?.[flag], true, `${frame.t}s ${object} 未通过`);
    assert.deepEqual(frame.muscles.map(muscle => muscle.name).sort(), expectedNames);
    for (const key of ['torques', 'rawTorques', 'muscleTorques', 'passiveTorques', 'jointPassiveTorques', 'reserveTorques'])
      for (const coordinate of model.coordinates)
        assert.ok(Number.isFinite(frame[key]?.[coordinate.name]), `${frame.t}s 缺少 ${key}.${coordinate.name}`);
    assert.deepEqual(Object.keys(frame.handReferenceTorques).sort(), [...model.handReferenceCoordinates].sort());
    for (const name of model.handReferenceCoordinates)
      assert.ok(Number.isFinite(frame.handReferenceTorques[name]), `${frame.t}s 手指修正 ${name} 无有效数值`);
    for (const { name } of model.coordinates) {
      const hand = frame.handReferenceTorques[name] ?? 0;
      assert.ok(Number.isFinite(hand) && Number.isFinite(frame.otherJointPassiveTorques[name]) &&
        Number.isFinite(frame.externalTorques[name]));
      assert.ok(Math.abs(frame.jointPassiveTorques[name] - frame.otherJointPassiveTorques[name] - hand) < 1e-7);
      assert.ok(Math.abs(frame.rawTorques[name] - frame.jointPassiveTorques[name] -
        frame.externalTorques[name] - frame.torques[name]) < 1e-7);
    }
    for (const muscle of frame.muscles) {
      assert.ok(Number.isFinite(muscle.force) && muscle.force >= 0);
      assert.ok(Number.isFinite(muscle.activation) && muscle.activation >= 0 && muscle.activation <= 1);
      assert.ok(Number.isFinite(muscle.activeCapacity) && muscle.activeCapacity >= 0);
      assert.ok(Number.isFinite(muscle.passiveForce) && muscle.passiveForce >= 0);
      const branches = muscle.branches || [], expected = definitions.get(muscle.name);
      assert.equal(branches.length, expected.length, `${muscle.name} 分支不全`);
      branches.forEach((branch, index) => {
        assert.equal(branch.id, expected[index].id);
        assert.ok(Math.abs(branch.coefficient - expected[index].coefficient) < 1e-10);
        assert.ok(Number.isFinite(branch.force) && branch.force >= 0);
        assert.ok(Math.abs(branch.force - muscle.force * branch.coefficient) <= 1e-7 * Math.max(1, muscle.force));
        assert.ok(branch.path.length >= 2 && branch.path.every(point => point.length === 3 && point.every(Number.isFinite)));
      });
      if (branches.length) assert.deepEqual(branches[0].path, muscle.path);
    }
  }
  const times = value.frames.map(frame => frame.t);
  const duration = fixture.scene.keyframes.at(-1).t;
  const count = Math.min(121, Math.ceil(duration * 12) + 1);
  const expectedTimes = [...new Set([
    ...Array.from({ length: count }, (_, index) => Number((duration * index / (count - 1)).toFixed(8))),
    ...fixture.scene.keyframes.map(key => key.t),
  ])].sort((a, b) => a - b);
  assert.deepEqual(times, expectedTimes, '求解响应必须保留完整采样时刻，不能删除中间帧');
  assert.ok(times.every((time, index) => Number.isFinite(time) && (index === 0 || time > times[index - 1])));
  for (const key of fixture.scene.keyframes) assert.ok(times.includes(key.t), `缺少关键帧 ${key.t}s`);
  for (const key of fixture.scene.keyframes) {
    const frame = value.frames[times.indexOf(key.t)];
    for (const name of compoundAxes)
      assert.ok(Math.abs(frame.q[name] - key.q[name]) < 1e-7, `${key.t}s 实算姿势与自定义动作的 ${name} 不同`);
  }
  assert.equal(times[0], 0);
  assert.equal(times.at(-1), fixture.scene.keyframes.at(-1).t);
}
async function coordinateValue(page, model, name) {
  const coordinate = model.coordinates.find(item => item.name === name);
  assert.ok(coordinate, `模型缺少 ${name}`);
  await page.locator('#tab-selection').click();
  const details = page.locator('.precise-pose');
  if (!await details.evaluate(node => node.open)) await details.locator('summary').click();
  await page.locator('#coordinateRegion').selectOption(coordinate.region);
  await page.locator('#coordinate').selectOption(name);
  return Number(await page.locator('#coordinateValue').inputValue());
}

try {
  await writeEvidence();
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
  phase = 'v5_model_and_actual_surface';
  const { page, model } = await openPage(context, 'custom');
  evidence.model = { id: model.id, sourceSha256: model.sourceSha256, computationSha256: model.computationSha256 };
  await ready(page);
  assert.equal(await page.locator('#muscleDisplay').inputValue(), 'anatomy');
  await page.waitForFunction(() => /已载入精细解剖表面/.test(document.querySelector('#renderNote').textContent), null, { timeout: 180000 });
  assert.ok(await page.locator('#bodyView canvas').isVisible(), '真实表面画布不可见');
  await record('v5_actual_anatomical_surface', { ...evidence.model,
    renderNote: await page.locator('#renderNote').innerText(), screenshot: await screenshot(page, 'actual-anatomical-surface') });
  await page.locator('#muscleDisplay').selectOption('paths');
  await ready(page);

  phase = 'import_fixed_custom_scene_and_solve';
  const scene = { schema: 1, model: model.id, ...structuredClone(fixture.scene) };
  const importResponse = page.waitForResponse(response => isApi(response, 'pose'));
  await page.locator('#import').setInputFiles({ name: `${fixtureId}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(scene)) });
  assert.equal((await importResponse).status(), 200);
  await page.waitForFunction(() => document.querySelector('#import').files.length === 0, null, { timeout: 60000 });
  await ready(page);
  const storageKey = `bodyvista.body-lab.${model.id}.scene.v1`;
  const imported = await readStoredScene(page, storageKey);
  const expectedKeys = fixture.scene.keyframes.map(({ t, q }) => ({ t, q: { ...model.defaults, ...q } }));
  assert.deepEqual(imported.keyframes, expectedKeys, '导入的关键帧或未指定坐标的默认值发生了变化');
  assert.equal(await page.locator('#keyframes .keyframe-main').count(), scene.keyframes.length);
  assert.equal(solveCount(), 0, '点击计算前不应已有求解请求');
  const responsePromise = page.waitForResponse(response => isApi(response, 'solve'), { timeout: 600000 });
  await page.locator('#solve').click();
  const response = await responsePromise;
  assert.equal(response.status(), 200);
  const submitted = response.request().postDataJSON();
  assert.deepEqual(submitted.keyframes, imported.keyframes, '页面求解请求没有使用刚导入的关键帧');
  assert.equal(submitted.preview, false);
  const settings = { supportFeet: 'both', strengthScale: 1, ...fixture.scene };
  for (const setting of ['support', 'groundEnabled', 'supportFeet', 'loadKg', 'hand', 'strengthScale'])
    assert.equal(submitted[setting], settings[setting], `求解请求改变了 ${setting}`);
  assert.equal(submitted.equipment.type, fixture.scene.equipment.type);
  evidence.solveResponseBytes = Number(response.headers()['content-length']);
  await writeEvidence();
  const solved = await readCapturedSolve(page, response, submitted);
  assertSolved(solved, model);
  await ready(page);
  await page.locator('#tab-forces').click();
  await page.waitForFunction(() => document.querySelector('#muscleCount').textContent === '740', null, { timeout: 60000 });
  assert.match(await page.locator('#status').innerText(), new RegExp(`整段 ${solved.frames.length}/${solved.frames.length} 帧通过`));
  assert.equal(solveCount(), 1);
  await record('imported_custom_motion_real_solve', { frames: solved.frames.length, musclesPerFrame: 740, solveRequests: 1,
    status: await page.locator('#status').innerText(), screenshot: await screenshot(page, 'custom-motion-solved') });

  phase = 'changing_hand_muscle_branch_table';
  await page.locator('#muscleRegion').selectOption(`hand_${side}`);
  const available = await page.locator('#muscleSelect option').evaluateAll(options => options.map(option => option.value).filter(Boolean));
  assert.ok(available.length, '运动手的观察列表没有张力变化的肌束');
  const candidates = available.map(name => {
    const samples = solved.frames.map(frame => frame.muscles.find(muscle => muscle.name === name));
    const change = Math.max(...samples.map(muscle => muscle.force)) - Math.min(...samples.map(muscle => muscle.force));
    const index = samples.reduce((best, muscle, current) => muscle.force > samples[best].force ? current : best, 0);
    return { name, samples, change, index };
  }).filter(item => item.change > 0.01 && item.samples[item.index].branches?.length > 1 &&
    item.samples[item.index].branches.slice(1).some(branch => branch.force >= 0.0001));
  assert.ok(candidates.length, '可观察的右手肌束中没有张力变化且分支非零的单元');
  candidates.sort((a, b) => b.change - a.change);
  const chosen = candidates[0], expectedMuscle = chosen.samples[chosen.index], selectedTime = solved.frames[chosen.index].t;
  await page.locator('#muscleSelect').selectOption(chosen.name);
  await page.locator('#timeline').evaluate((input, index) => {
    input.value = String(index);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, chosen.index);
  await page.waitForFunction(time => document.querySelector('#clock').textContent.startsWith(`${time} /`), selectedTime.toFixed(2), { timeout: 60000 });
  await ready(page);
  const branchPanel = page.locator('#tendonBranchDetails');
  assert.equal(await branchPanel.isVisible(), true);
  if (!await branchPanel.evaluate(node => node.open)) await branchPanel.locator(':scope > summary').click();
  await branchPanel.scrollIntoViewIfNeeded();
  assert.equal(await page.locator('#tendonBranchRows tr').first().isVisible(), true);
  const rows = await page.locator('#tendonBranchRows tr').evaluateAll(elements => elements.map(row => [...row.cells].map(cell => cell.textContent)));
  assert.equal(rows.length, expectedMuscle.branches.length);
  rows.forEach((row, index) => {
    assert.equal(row[0], expectedMuscle.branches[index].label || (index === 0 ? '主干' : expectedMuscle.branches[index].id));
    assert.ok(Math.abs(Number(row[2]) - expectedMuscle.branches[index].force) <= 0.000051, '页面分支力与实际求解不一致');
  });
  assert.ok(rows.slice(1).some(row => Number(row[2]) > 0), '只有主干力非零，未验证分支力');
  await record('changing_hand_branch_forces', { muscle: chosen.name, changeN: chosen.change, time: selectedTime,
    rows, screenshot: await screenshot(page, 'hand-tendon-branch-forces') });

  phase = 'hand_passive_torque_table';
  const torquePanel = page.locator('.torque-panel');
  if (!await torquePanel.evaluate(node => node.open)) await torquePanel.locator(':scope > summary').click();
  const passivePanel = page.locator('#handPassiveDetails');
  assert.equal(await passivePanel.isVisible(), true);
  if (!await passivePanel.evaluate(node => node.open)) await passivePanel.locator('summary').click();
  const selectedRegion = await page.locator('#coordinateRegion').inputValue();
  const expectedCoordinates = model.coordinates.filter(coordinate =>
    model.handReferenceCoordinates.includes(coordinate.name) &&
    (selectedRegion === 'all' || coordinate.region === selectedRegion));
  const passiveRows = await page.locator('#handPassiveRows tr').evaluateAll(elements =>
    elements.map(row => [...row.cells].map(cell => cell.textContent)));
  assert.equal(passiveRows.length, expectedCoordinates.length);
  assert.ok(passiveRows.length > 0);
  passiveRows.forEach((row, index) => {
    const name = expectedCoordinates[index].name, frame = solved.frames[chosen.index];
    for (const text of row.slice(1))
      assert.ok(text.trim().length > 0 && Number.isFinite(Number(text)), '被动作用单元格未显示有限数值');
    assert.ok(Math.abs(Number(row[1]) - frame.otherJointPassiveTorques[name]) <= .000051);
    assert.ok(Math.abs(Number(row[2]) - frame.handReferenceTorques[name]) <= .000051);
  });
  await record('hand_passive_terms_reported_separately', { time: selectedTime, rows: passiveRows,
    screenshot: await screenshot(page, 'hand-passive-torques') });

  phase = 'editing_clears_branch_values';
  const elbowAxis = `elbow_flexion_${side}`;
  const beforeAngle = await coordinateValue(page, model, elbowAxis);
  const nextAngle = beforeAngle > 1 ? beforeAngle - 1 : beforeAngle + 1;
  await page.locator('#coordinateValue').fill(String(nextAngle));
  const poseResponse = page.waitForResponse(reply => isApi(reply, 'pose'));
  await page.locator('#applyCoordinate').click();
  const changed = await poseResponse;
  assert.equal(changed.status(), 200);
  assert.ok(Math.abs((await changed.json()).q[elbowAxis] - nextAngle) < 1e-6);
  await ready(page);
  await page.locator('#tab-forces').click();
  assert.equal(await page.locator('#tendonBranchDetails').isVisible(), false);
  assert.equal(await page.locator('#tendonBranchRows tr').count(), 0);
  assert.equal(await page.locator('#handPassiveDetails').isVisible(), false);
  assert.equal(await page.locator('#handPassiveRows tr').count(), 0);
  assert.equal(await page.locator('#muscleValue').innerText(), '— N');
  assert.equal(await page.locator('#muscleSelect').isDisabled(), true);
  assert.equal(solveCount(), 1, '编辑角度不应自行触发整段求解');
  await record('edit_invalidates_old_branch_forces', { beforeAngle, nextAngle, screenshot: await screenshot(page, 'edited-branch-values-cleared') });

  if (!candidatePreview) {
    phase = 'fixed_case_load_without_solving';
    await page.locator('#tab-motions').click();
    await page.waitForFunction(() => document.querySelectorAll('#verifiedMotionList button').length > 0, null, { timeout: 60000 });
    const caseButton = page.locator('#verifiedMotionList button').first();
    const caseId = await caseButton.getAttribute('data-motion');
    const beforeSolves = solveCount(), beforeCache = cacheRequests().length;
    const [cacheModelReply, cached] = await Promise.all([
      page.waitForResponse(reply => isApi(reply, 'model'), { timeout: 180000 }),
      page.waitForResponse(reply => /\/motion-cache\/[a-f0-9]{64}\.json$/.test(new URL(reply.url()).pathname), { timeout: 180000 }),
      caseButton.click(),
    ]);
    assert.equal(cacheModelReply.status(), 200);
    const cacheModel = await cacheModelReply.json();
    for (const field of ['id', 'sourceSha256', 'computationSha256'])
      assert.equal(cacheModel[field], model[field], `读取固定缓存时 ${field} 已改变`);
    assert.equal(cached.status(), 200);
    assert.equal(await cached.finished(), null);
    await page.waitForFunction(() => document.querySelector('#verifiedSelection').textContent.startsWith('已载入：') &&
      document.querySelector('#draftState').textContent.includes('当前停在首帧'), null, { timeout: 180000 });
    await ready(page);
    await page.locator('#tab-forces').click();
    await page.waitForFunction(() => document.querySelector('#muscleCount').textContent === '740', null, { timeout: 60000 });
    assert.match(await page.locator('#resultKind').innerText(), /固定缓存/);
    assert.equal(cacheRequests().length - beforeCache, 1, '一次案例选择应读取一个完整结果缓存');
    assert.equal(solveCount() - beforeSolves, 0, '载入固定案例意外调用了 solve');
    await record('fixed_case_reads_cache_without_solve', { caseId, cacheUrl: cached.url(), cacheRequests: 1, solveRequests: 0,
      model: cacheModel.id, modelSha256: cacheModel.sourceSha256, computationSha256: cacheModel.computationSha256,
      note: await page.locator('#verifiedSelection').innerText(), screenshot: await screenshot(page, 'fixed-case-cache') });
  } else {
    await record('candidate_cache_publication_not_tested', {
      publicationValidated: false, reason: '隔离预览不发布固定动作缓存，不能据此宣称正式页面和动作库已验收。',
    });
  }
  await context.close();
  activePage = null;

  phase = 'v3_saved_scene_compatibility';
  const legacyQ = { ...fixture.scene.keyframes[0].q, knee_angle_r: 30, knee_rotation_r: 10 };
  const legacyScene = { schema: 1, model: previousModel, ...structuredClone(fixture.scene),
    keyframes: [{ t: 0, q: legacyQ }, { t: 2, q: structuredClone(legacyQ) }], draft: structuredClone(legacyQ) };
  const legacyKey = `bodyvista.body-lab.${previousModel}.scene.v1`, legacyText = JSON.stringify(legacyScene);
  const migrationContext = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
  await migrationContext.addInitScript(({ origin, key, text }) => {
    if (location.origin === origin && localStorage.getItem(key) === null) localStorage.setItem(key, text);
  }, { origin: pageUrl.origin, key: legacyKey, text: legacyText });
  const migrated = await openPage(migrationContext, 'migration');
  assert.equal(migrated.model.sourceSha256, model.sourceSha256, '验收期间模型发生变化');
  assert.equal(migrated.model.computationSha256, model.computationSha256, '验收期间计算代码发生变化');
  await migrated.page.locator('#muscleDisplay').selectOption('paths');
  await ready(migrated.page);
  const migrationNote = await migrated.page.locator('#draftState').innerText();
  assert.match(migrationNote, /兼容升级并恢复/);
  assert.equal(await migrated.page.evaluate(key => localStorage.getItem(key), legacyKey), legacyText, 'v3 原存储被覆盖或删除');
  const restored = await readStoredScene(migrated.page, storageKey);
  assert.equal(restored.model, model.id);
  assert.equal(restored.keyframes.length, 2);
  for (const pose of [restored.draft, ...restored.keyframes.map(key => key.q)]) {
    assert.equal(pose.knee_angle_r, 30);
    assert.equal(pose.knee_rotation_r, 10);
  }
  assert.equal(await coordinateValue(migrated.page, migrated.model, 'knee_angle_r'), 30);
  assert.equal(await coordinateValue(migrated.page, migrated.model, 'knee_rotation_r'), 10);
  assert.equal(evidence.network.filter(item => item.context === 'migration' && item.path === '/api/fullbody/solve').length, 0);
  await record('v3_pose_migration_preserves_knee_and_old_storage', { note: migrationNote, kneeFlexion: 30, kneeRotation: 10,
    oldStorageUnchanged: true, newStorageModel: restored.model, screenshot: await screenshot(migrated.page, 'v3-knee-scene-restored') });
  assert.deepEqual(evidence.pageErrors, [], '浏览器出现未处理异常');
  await record('no_unhandled_browser_errors', { count: 0 });
  await migrationContext.close();
  activePage = null;
  evidence.status = candidatePreview ? 'preview-passed' : 'passed';
  evidence.fixedCacheValidated = !candidatePreview;
  evidence.completedAt = new Date().toISOString();
  await writeEvidence();
} catch (error) {
  evidence.status = 'failed';
  evidence.publicationValidated = false;
  evidence.failedPhase = phase;
  evidence.error = { message: error.message, stack: error.stack };
  if (activePage && !activePage.isClosed()) {
    try {
      evidence.failureScreenshot = await screenshot(activePage, 'failure');
      evidence.visibleStatus = await activePage.locator('#status').innerText({ timeout: 5000 });
    } catch (captureError) { evidence.failureCaptureError = captureError.message; }
  }
  await writeEvidence();
  throw error;
} finally {
  if (browser) await browser.close();
}
