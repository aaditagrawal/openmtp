/* eslint global-require: off */

import './services/sentry';

import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';

import React from 'react';
import { ipcRenderer } from 'electron';
import { createRoot } from 'react-dom/client';
import Root from './containers/App/Root';
import { store } from './store/configureStore';
import './styles/scss/app.global.scss';

if (process.env.OPENMTP_TEST_MODE === '1') {
  window.__OPENMTP_TEST_STORE__ = store;
}

const MOUNT_POINT = document.getElementById('root');

const root = createRoot(MOUNT_POINT);

class StartupDiagnostics extends React.Component {
  componentDidMount() {
    requestAnimationFrame(() =>
      ipcRenderer.send('openmtp.renderer-ready', {
        rootChildCount: MOUNT_POINT.children.length,
        rendererUptimeMs: Math.round(performance.now()),
      }),
    );
  }

  render() {
    return <Root store={store} />;
  }
}

root.render(<StartupDiagnostics />);
