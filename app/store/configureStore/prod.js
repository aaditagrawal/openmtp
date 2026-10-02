import { createStore, applyMiddleware } from 'redux';
import { thunk } from 'redux-thunk';
import rootReducer from '../reducers';

const enhancer = applyMiddleware(thunk);

const configureStore = (initialState) => {
  const store = createStore(rootReducer, initialState, enhancer);

  return store;
};

export default { configureStore };
