import { combineReducers } from 'redux';
import Alerts from '../../containers/Alerts/reducers';
import Settings from '../../containers/Settings/reducers';

const rootReducer = (asyncReducers) =>
  combineReducers({
    Alerts,
    Settings,
    ...asyncReducers,
  });

export default rootReducer;
