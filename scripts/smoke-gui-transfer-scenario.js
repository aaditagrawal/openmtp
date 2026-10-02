// Real-device scenario for smoke-electron.cjs. Never run alongside another MTP
// client. Only Settings fixture setup uses Redux dispatch; navigation, folder
// creation, selection, copy/paste and deletion use the rendered app controls.
(async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const crypto = require('node:crypto');
  const appWindow = require('@electron/remote').getCurrentWindow();
  const store = window.__OPENMTP_TEST_STORE__;
  const runName = `OpenMTP-GUI-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  const localRoot = path.join(os.homedir(), runName);
  const source = path.join(localRoot, 'source');
  const downloaded = path.join(localRoot, 'downloaded');
  const remoteRoot = `/Download/${runName}`;
  const output = path.dirname(process.env.OPENMTP_PROFILE_DIR);
  const report = {
    runName,
    localRoot,
    remoteRoot,
    startedAt: new Date().toISOString(),
    steps: [],
    inputEvents: [],
    progressUpdates: 0,
    progressTitles: [],
    remoteCleanup: 'not-created',
    localCleanup: 'not-created',
  };
  const persist = () =>
    fs.writeFileSync(
      path.join(output, 'gui-transfer.json'),
      JSON.stringify(report, null, 2),
    );
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const frame = () =>
    new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  const home = () => store.getState().Home;
  const listing = (device) => home().directoryLists[device];
  const pane = (device) =>
    document.getElementById(`file-explorer-body-wrapper-${device}`);
  const wait = async (predicate, label, timeout = 20000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (predicate()) {
        await frame();
        return;
      }
      assert(
        !document.querySelector('img[alt="Some Error Occured!"]'),
        `ErrorBoundary during ${label}`,
      );
      await delay(50);
    }
    throw new Error(`Timed out: ${label}`);
  };
  const step = async (name, action) => {
    const started = performance.now();
    await action();
    report.steps.push({ name, durationMs: performance.now() - started });
    persist();
  };
  const toolbarButton = (device, label) => {
    for (
      let ancestor = pane(device);
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      const button = [...ancestor.querySelectorAll('button[aria-label]')].find(
        (item) => item.getAttribute('aria-label') === label,
      );
      if (button) return button;
    }
    throw new Error(`Missing ${device} ${label} toolbar button`);
  };
  const toolbar = async (device, label) => {
    const button = toolbarButton(device, label);
    assert(!button.disabled, `${device} ${label} button is disabled`);
    report.inputEvents.push(`${device}: click ${label}`);
    button.click();
    await frame();
  };
  const shortcut = async (device, keyCode) => {
    const target = pane(device);
    target.click();
    target.focus();
    await frame();
    assert(
      home().focussedFileExplorerDeviceType.value === device,
      `Could not focus ${device} pane`,
    );
    appWindow.focus();
    report.inputEvents.push(`${device}: Command+${keyCode}`);
    appWindow.webContents.sendInputEvent({
      type: 'keyDown',
      keyCode,
      modifiers: ['meta'],
    });
    appWindow.webContents.sendInputEvent({
      type: 'keyUp',
      keyCode,
      modifiers: ['meta'],
    });
    await frame();
  };
  const waitDirectory = (device, expected) =>
    wait(
      () =>
        home().currentBrowsePath[device] === expected &&
        listing(device).isLoaded,
      `${device} directory ${expected}`,
    );
  const findNameCell = async (device, name) => {
    assert(
      listing(device).nodes.some((node) => node.name === name),
      `${device} listing lacks ${name}`,
    );
    const scroller = pane(device);
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event('scroll'));
    await frame();
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const image = [
        ...scroller.querySelectorAll('tbody tr[role="checkbox"] img'),
      ].find((item) => item.alt === name);
      if (image) return image.closest('tr').querySelector('.nameCell');
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight)
        break;
      scroller.scrollTop += Math.max(100, scroller.clientHeight - 100);
      scroller.dispatchEvent(new Event('scroll'));
      await frame();
    }
    throw new Error(`Could not scroll to ${device} ${name}`);
  };
  const openFolder = async (device, name, expected) => {
    const cell = await findNameCell(device, name);
    report.inputEvents.push(`${device}: double-click ${name}`);
    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await waitDirectory(device, expected);
  };
  const up = async (device, expected) => {
    await toolbar(device, 'Folder Up');
    await waitDirectory(device, expected);
  };
  const selectAllAndCopy = async (device, count) => {
    const checkbox = pane(device).querySelector('thead input[type="checkbox"]');
    assert(checkbox, `No ${device} select-all checkbox`);
    if (!checkbox.checked) checkbox.click();
    await wait(
      () => listing(device).queue.selected.length === count,
      `${device} select all`,
    );
    await shortcut(device, 'C');
    await wait(
      () =>
        home().fileTransfer.clipboard.source === device &&
        home().fileTransfer.clipboard.queue.length === count,
      `${device} copy clipboard`,
    );
  };
  const deleteRemoteFixture = async () => {
    if (report.remoteCleanup !== 'pending') return;
    await wait(
      () => !home().fileTransfer.progress.toggle,
      'transfer to settle before cleanup',
      30000,
    );
    if (home().currentBrowsePath.mtp === remoteRoot)
      await up('mtp', '/Download');
    assert(
      home().currentBrowsePath.mtp === '/Download',
      'Refusing cleanup outside /Download',
    );
    const node = listing('mtp').nodes.find(
      (entry) => entry.path === remoteRoot && entry.name === runName,
    );
    assert(
      node?.isFolder,
      'Refusing cleanup without exact owned directory match',
    );
    const checkbox = pane('mtp').querySelector('thead input[type="checkbox"]');
    if (listing('mtp').queue.selected.length) {
      // Select-all then clear produces an empty selection regardless of its prior state.
      if (!checkbox.checked) checkbox.click();
      await frame();
      checkbox.click();
      await frame();
    }
    (await findNameCell('mtp', runName)).click();
    await wait(
      () =>
        listing('mtp').queue.selected.length === 1 &&
        listing('mtp').queue.selected[0] === remoteRoot,
      'exclusive owned-folder selection',
    );
    await toolbar('mtp', 'Delete');
    await wait(
      () =>
        Boolean(
          document.querySelector('[aria-labelledby="confirm-dialogbox"]'),
        ),
      'delete confirmation',
    );
    const dialog = document.querySelector(
      '[aria-labelledby="confirm-dialogbox"]',
    );
    const yes = [...dialog.querySelectorAll('button')].find(
      (button) => button.textContent.trim() === 'Yes',
    );
    assert(yes, 'No Yes button on delete confirmation');
    assert(
      listing('mtp').queue.selected.length === 1 &&
        listing('mtp').queue.selected[0] === remoteRoot,
      'Selection changed before delete confirmation',
    );
    yes.click();
    await wait(
      () =>
        listing('mtp').isLoaded &&
        !listing('mtp').nodes.some((entry) => entry.path === remoteRoot),
      'owned remote directory deletion',
    );
    report.remoteCleanup = 'removed';
    persist();
  };
  let failure;
  let previousProgress;
  const unsubscribe = store.subscribe(() => {
    const progress = home()?.fileTransfer.progress;
    if (progress && progress !== previousProgress && progress.toggle) {
      report.progressUpdates += 1;
      if (!report.progressTitles.includes(progress.titleText))
        report.progressTitles.push(progress.titleText);
    }
    previousProgress = progress;
  });
  try {
    const onboarding = document.querySelector(
      '[aria-labelledby="onboaring-dialogbox"]',
    );
    [...(onboarding?.querySelectorAll('button') || [])]
      .find((button) => button.textContent.trim() === 'Close')
      ?.click();
    store.dispatch({
      type: '@@Settings/COPY_JSON_FILE_TO_SETTINGS',
      payload: {
        ...store.getState().Settings,
        freshInstall: 0,
        toggleSettings: false,
        fileExplorerListingType: { local: 'list', mtp: 'list' },
      },
    });
    await delay(250);
    await wait(
      () => home().mtpDevice.isAvailable && listing('mtp').isLoaded,
      'connected device',
    );
    report.deviceModel = home().mtpDevice.info?.mtpDeviceInfo?.Model;
    assert(
      home().currentBrowsePath.local === os.homedir(),
      'Scenario requires a disposable profile starting in the home directory',
    );
    assert(
      home().currentBrowsePath.mtp === '/',
      'Scenario requires device root at startup',
    );
    assert(!fs.existsSync(localRoot), 'Refusing to reuse a local fixture');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(downloaded);
    report.localCleanup = 'pending';
    const files = [
      { name: 'gui-small.bin', bytes: 1024 * 1024 },
      { name: 'gui-large.bin', bytes: 8 * 1024 * 1024 },
    ];
    for (const file of files) {
      fs.writeFileSync(
        path.join(source, file.name),
        crypto.randomBytes(file.bytes),
      );
      file.sha256 = crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(source, file.name)))
        .digest('hex');
    }
    report.files = files;
    persist();
    await step('navigate-local-source-through-ui', async () => {
      await toolbar('local', 'Refresh');
      await wait(
        () =>
          listing('local').isLoaded &&
          listing('local').nodes.some((node) => node.name === runName),
        'new local fixture listing',
      );
      await openFolder('local', runName, localRoot);
      await openFolder('local', 'source', source);
    });
    await step('create-remote-directory-through-ui', async () => {
      await openFolder('mtp', 'Download', '/Download');
      assert(
        !listing('mtp').nodes.some((node) => node.name === runName),
        'Refusing to reuse an existing remote directory',
      );
      await shortcut('mtp', 'N');
      await wait(
        () => Boolean(document.getElementById('newFolderDialog')),
        'New Folder input',
      );
      const input = document.getElementById('newFolderDialog');
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      ).set.call(input, runName);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.focus();
      input.blur();
      const dialog = input.closest('[role="dialog"]');
      const create = [...dialog.querySelectorAll('button')].find(
        (button) => button.textContent.trim() === 'Create',
      );
      assert(create, 'Missing Create button');
      create.click();
      report.remoteCleanup = 'pending';
      persist();
      await wait(
        () =>
          listing('mtp').isLoaded &&
          listing('mtp').nodes.some((node) => node.path === remoteRoot),
        'created remote directory',
      );
      await delay(200);
      await openFolder('mtp', runName, remoteRoot);
    });
    await step('gui-upload', async () => {
      await selectAllAndCopy('local', files.length);
      await shortcut('mtp', 'V');
      await wait(
        () =>
          !home().fileTransfer.progress.toggle &&
          listing('mtp').isLoaded &&
          files.every((file) =>
            listing('mtp').nodes.some(
              (node) => node.name === file.name && node.size === file.bytes,
            ),
          ),
        'GUI upload completion',
        45000,
      );
      assert(
        listing('mtp').nodes.length === files.length,
        'Remote fixture contains unexpected entries',
      );
    });
    await step('gui-download', async () => {
      await up('local', localRoot);
      await openFolder('local', 'downloaded', downloaded);
      await selectAllAndCopy('mtp', files.length);
      await shortcut('local', 'V');
      await wait(
        () =>
          !home().fileTransfer.progress.toggle &&
          listing('local').isLoaded &&
          files.every((file) =>
            listing('local').nodes.some(
              (node) => node.name === file.name && node.size === file.bytes,
            ),
          ),
        'GUI download completion',
        45000,
      );
      for (const file of files) {
        file.downloadedSha256 = crypto
          .createHash('sha256')
          .update(fs.readFileSync(path.join(downloaded, file.name)))
          .digest('hex');
        assert(
          file.downloadedSha256 === file.sha256,
          `SHA256 mismatch: ${file.name}`,
        );
      }
      assert(
        report.progressUpdates > 0,
        'GUI transfer progress state never updated',
      );
    });
  } catch (error) {
    failure = error;
    report.failure = error.stack || String(error);
  } finally {
    try {
      await step(
        'cleanup-owned-remote-directory-through-ui',
        deleteRemoteFixture,
      );
      if (report.localCleanup === 'pending') {
        const current = home().currentBrowsePath.local;
        if (current === source || current === downloaded)
          await up('local', localRoot);
        if (home().currentBrowsePath.local === localRoot)
          await up('local', os.homedir());
        assert(
          path.dirname(localRoot) === os.homedir() &&
            path.basename(localRoot) === runName,
          'Refusing unsafe local cleanup',
        );
        fs.rmSync(localRoot, { recursive: true });
        report.localCleanup = 'removed';
        if (home().currentBrowsePath.local === os.homedir()) {
          await toolbar('local', 'Refresh');
          await wait(
            () =>
              listing('local').isLoaded &&
              !listing('local').nodes.some((node) => node.name === runName),
            'local fixture removal',
          );
        }
      }
    } catch (error) {
      report.cleanupFailure = error.stack || String(error);
      failure ||= error;
    }
    unsubscribe();
    report.ok = !failure;
    persist();
  }
  if (failure)
    throw new Error(
      `GUI transfer failed. See ${path.join(output, 'gui-transfer.json')}: ${failure.message}`,
    );
  return report;
})();
