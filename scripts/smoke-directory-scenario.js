// Evaluated inside the real Electron renderer by smoke-electron.cjs.
(async () => {
  const store = window.__OPENMTP_TEST_STORE__;
  const onboarding = document.querySelector(
    '[aria-labelledby="onboaring-dialogbox"]',
  );
  [...(onboarding?.querySelectorAll('button') || [])]
    .find((button) => button.textContent.trim() === 'Close')
    ?.click();
  const frame = () =>
    new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const count = 10000;
  const nodes = Array.from({ length: count }, (_, i) => ({
    name: `benchmark-${String(i).padStart(5, '0')}.txt`,
    path: `/openmtp-benchmark/benchmark-${String(i).padStart(5, '0')}.txt`,
    extension: '.txt',
    size: i + 1,
    isFolder: false,
    dateAdded: '2026-10-02 12:00:00',
    mtimeMs: 1790942400000,
    symlink: null,
  }));
  store.dispatch({
    type: '@@Settings/COPY_JSON_FILE_TO_SETTINGS',
    payload: {
      ...store.getState().Settings,
      freshInstall: 0,
      onboarding: { lastFiredVersion: '3.2.20' },
      toggleSettings: false,
      fileExplorerListingType: { local: 'list', mtp: 'list' },
    },
  });
  store.dispatch({
    type: '@@Home/SET_CURRENT_BROWSE_PATH',
    deviceType: 'local',
    payload: '/openmtp-benchmark',
  });
  const started = performance.now();
  store.dispatch({
    type: '@@Home/LIST_DIRECTORY',
    deviceType: 'local',
    payload: { nodes, isLoaded: true },
  });
  await frame();
  const renderMs = performance.now() - started;
  const scroller = document.getElementById('file-explorer-body-wrapper-local');
  assert(scroller, 'Local explorer is missing');
  const mounted = () =>
    scroller.querySelectorAll('tbody tr[role="checkbox"]').length;
  const mountedAtTop = mounted();
  assert(
    mountedAtTop > 0 && mountedAtTop < 100,
    `List mounted ${mountedAtTop} rows`,
  );
  const first = scroller.querySelector('tbody .nameCell');
  assert(first, 'First filename cell missing');
  const font = getComputedStyle(first).fontFamily;
  assert(font.includes('DM Mono'), `Fork font was lost: ${font}`);
  first.click();
  await frame();
  assert(
    store.getState().Home.directoryLists.local.queue.selected.length === 1,
    'Click selection failed',
  );
  scroller
    .querySelectorAll('tbody .nameCell')[2]
    .dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
  await frame();
  assert(
    store.getState().Home.directoryLists.local.queue.selected.length === 3,
    'Shift selection failed in the visible window',
  );
  const all = scroller.querySelector('thead input[type="checkbox"]');
  assert(all, 'Select-all checkbox missing');
  all.click();
  await frame();
  assert(
    store.getState().Home.directoryLists.local.queue.selected.length === count,
    'Select-all lost unmounted rows',
  );
  scroller.scrollTop = scroller.scrollHeight;
  scroller.dispatchEvent(new Event('scroll'));
  await frame();
  await frame();
  assert(
    scroller.innerText.includes('benchmark-09999.txt'),
    'Last row is unreachable',
  );
  const mountedAtEnd = mounted();
  assert(mountedAtEnd < 100, 'Scrolling mounted the entire directory');
  // Reset selection, anchor at the final row, and shift-click the first row.
  // This must include the thousands of rows that are no longer mounted.
  all.click();
  await frame();
  [...scroller.querySelectorAll('tbody .nameCell')].at(-1).click();
  await frame();
  scroller.scrollTop = 0;
  scroller.dispatchEvent(new Event('scroll'));
  await frame();
  await frame();
  scroller
    .querySelector('tbody .nameCell')
    .dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
  await frame();
  const crossWindowSelection =
    store.getState().Home.directoryLists.local.queue.selected.length;
  assert(crossWindowSelection === count, 'Shift selection lost unmounted rows');
  const sort = [
    ...scroller.querySelectorAll('thead [role="button"], thead button'),
  ].find((item) => item.textContent.trim() === 'Name');
  assert(sort, 'Name sort control missing');
  sort.click();
  await frame();
  assert(scroller.scrollTop < 100, 'Sorting did not return to the first row');
  const sortedFirst = scroller
    .querySelector('tbody .nameCell')
    ?.textContent.trim();
  const expectedFirst =
    store.getState().Home.directoryLists.local.order === 'asc'
      ? nodes[0].name
      : nodes.at(-1).name;
  assert(
    sortedFirst === expectedFirst,
    `Sort rendered ${sortedFirst}, expected ${expectedFirst}`,
  );
  store.dispatch({
    type: '@@Settings/FILE_EXPLORER_LISTING_TYPE',
    deviceType: 'local',
    payload: 'grid',
  });
  await frame();
  await frame();
  const imagesAtTop = scroller.querySelectorAll('tbody img').length;
  assert(
    imagesAtTop > 0 && imagesAtTop < 250,
    `Grid mounted ${imagesAtTop} tiles`,
  );
  scroller.scrollTop = scroller.scrollHeight;
  scroller.dispatchEvent(new Event('scroll'));
  await frame();
  await frame();
  const imagesAtEnd = scroller.querySelectorAll('tbody img').length;
  assert(
    imagesAtEnd > 0 && imagesAtEnd < 250,
    'Grid scrolling left an empty or unbounded window',
  );
  const expectedLast =
    store.getState().Home.directoryLists.local.order === 'asc'
      ? nodes.at(-1).name
      : nodes[0].name;
  assert(
    [...scroller.querySelectorAll('tbody img')].some(
      (image) => image.alt === expectedLast,
    ),
    'Last grid tile is unreachable',
  );
  return {
    count,
    renderMs,
    mountedAtTop,
    mountedAtEnd,
    imagesAtTop,
    imagesAtEnd,
    sortedFirst,
    crossWindowSelection,
    font,
    selectAllCount:
      store.getState().Home.directoryLists.local.queue.selected.length,
  };
})();
