/* eslint global-require: off */

import './services/sentry';

import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';

import React from 'react';
import { createRoot } from 'react-dom/client';
import Root from './containers/App/Root';
import { store } from './store/configureStore';
import './styles/scss/app.global.scss';

const MOUNT_POINT = document.getElementById('root');

const root = createRoot(MOUNT_POINT);

root.render(<Root store={store} />);
