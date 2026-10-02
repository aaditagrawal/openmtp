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
  const setSettings = (values) =>
    store.dispatch({
      type: '@@Settings/COPY_JSON_FILE_TO_SETTINGS',
      payload: {
        ...store.getState().Settings,
        freshInstall: 0,
        onboarding: { lastFiredVersion: '3.2.20' },
        ...values,
      },
    });
  // Closing onboarding releases the top-modal slot after its exit transition.
  await new Promise((resolve) => setTimeout(resolve, 200));
  setSettings({ toggleSettings: true, appThemeMode: 'light' });
  await frame();
  const dialog = document.querySelector(
    '[aria-labelledby="settings-dialogbox"]',
  );
  assert(dialog, 'Settings dialog did not open');
  const font = getComputedStyle(dialog).fontFamily;
  assert(font.includes('DM Mono'), `Settings font changed: ${font}`);
  const tabs = [...dialog.querySelectorAll('[role="tab"]')];
  assert(tabs.length === 4, `Expected four settings tabs, got ${tabs.length}`);
  const tabsVisited = [];
  for (const tab of tabs) {
    tab.click();
    await frame();
    assert(
      tab.getAttribute('aria-selected') === 'true',
      `${tab.textContent} tab did not activate`,
    );
    tabsVisited.push(tab.textContent);
  }
  tabs[0].click();
  await frame();
  const lightBackground = getComputedStyle(dialog).backgroundColor;
  setSettings({ appThemeMode: 'dark' });
  await frame();
  const darkBackground = getComputedStyle(dialog).backgroundColor;
  assert(
    lightBackground !== darkBackground,
    'Changing theme left the dialog background unchanged',
  );
  const palette = getComputedStyle(document.documentElement)
    .getPropertyValue('--app-bg-color')
    .trim();
  assert(palette === '#242424', `Dark palette was lost: ${palette}`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  dialog.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
    }),
  );
  await frame();
  assert(
    store.getState().Settings.toggleSettings === false,
    'Escape did not dismiss Settings',
  );
  setSettings({ toggleSettings: true });
  await frame();
  return {
    tabsVisited,
    font,
    lightBackground,
    darkBackground,
    escapeDismissed: true,
  };
})();
