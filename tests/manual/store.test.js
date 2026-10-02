import './guard';
import { expect, test } from 'bun:test';
import development from '../../app/store/configureStore/dev';
import production from '../../app/store/configureStore/prod';
import { actionTypes as homeActions } from '../../app/containers/HomePage/actionTypes';
import { actionTypes as alertActions } from '../../app/containers/Alerts/actions';

for (const [mode, { configureStore }] of Object.entries({
  development,
  production,
})) {
  test(`${mode} store accepts pane selections before components mount and preserves rehydrated state`, () => {
    const store = configureStore();
    expect(Object.keys(store.getState()).sort()).toEqual([
      'Alerts',
      'Home',
      'Settings',
    ]);
    const initial = store.getState();
    store.dispatch((dispatch) =>
      dispatch({
        type: homeActions.SET_SELECTED_DIR_LISTS,
        deviceType: 'local',
        payload: { selected: ['/tmp/selected'] },
      }),
    );
    expect(store.getState().Home.directoryLists.local.queue.selected).toEqual([
      '/tmp/selected',
    ]);
    expect(store.getState().Home.directoryLists.mtp).toBe(
      initial.Home.directoryLists.mtp,
    );
    store.dispatch({
      type: alertActions.THROW_ALERT,
      payload: { message: 'A transfer completed' },
    });
    expect(store.getState().Alerts.message).toBe('A transfer completed');
    const restored = configureStore(store.getState());
    expect(restored.getState()).toEqual(store.getState());
    const unchanged = restored.getState();
    restored.dispatch({ type: '@@manual/unrelated' });
    expect(restored.getState()).toBe(unchanged);
  });
}
