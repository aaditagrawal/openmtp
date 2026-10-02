import { combineReducers } from 'redux';
import Alerts from '../../containers/Alerts/reducers';
import Settings from '../../containers/Settings/reducers';
import Home from '../../containers/HomePage/reducers';

const rootReducer = combineReducers({
  Alerts,
  Settings,
  Home,
});

export default rootReducer;
