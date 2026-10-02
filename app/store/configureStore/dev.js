/* eslint global-require: off */
/* eslint-disable import/no-import-module-exports */

import { createStore, applyMiddleware, compose } from 'redux';
import { thunk } from 'redux-thunk';
import { createLogger } from 'redux-logger';
import rootReducer from '../reducers';

const configureStore = (initialState) => {
  // Redux Configuration
  const middleware = [];
  const enhancers = [];

  // Thunk Middleware
  middleware.push(thunk);

  // Logging Middleware
  const logger = createLogger({
    level: 'info',
    collapsed: true,
  });

  // Full state serialization is expensive for large directories; opt in when diagnosing reducers.
  if (
    process.env.OPENMTP_REDUX_LOGS === '1' &&
    process.env.NODE_ENV !== 'test'
  ) {
    middleware.push(logger);
  }

  // If Redux DevTools Extension is installed use it, otherwise use Redux compose
  const composeEnhancers =
    typeof window !== 'undefined' && window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__
      ? window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__
      : compose;

  // Apply Middleware & Compose Enhancers
  enhancers.push(applyMiddleware(...middleware));
  const enhancer = composeEnhancers(...enhancers);

  // Create Store
  const store = createStore(rootReducer, initialState, enhancer);

  if (typeof module !== 'undefined' && module.hot) {
    module.hot.accept('../reducers', () =>
      store.replaceReducer(require('../reducers').default),
    );
  }

  return store;
};

export default { configureStore };
