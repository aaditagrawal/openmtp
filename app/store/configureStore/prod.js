import { createStore, applyMiddleware } from 'redux';
import thunk from 'redux-thunk';
import rootReducer from '../reducers';

const enhancer = applyMiddleware(thunk);

const configureStore = (initialState) => {
  const store = createStore(rootReducer(), initialState, enhancer);

  store.asyncReducers = {};
  store.injectReducer = (key, reducer) => {
    store.asyncReducers[key] = reducer;
    store.replaceReducer(rootReducer(store.asyncReducers));

    return store;
  };

  return store;
};

export default { configureStore };
