import { describe, expect, test } from 'bun:test';
import Home, { initialState } from './reducers';
import { actionTypes } from './actionTypes';
import { DEVICE_TYPE } from '../../enums';
import { EMPTY_NODES, EMPTY_SELECTED } from './homeStateHelpers';

const local = DEVICE_TYPE.local;

describe('Home reducer hot paths', () => {
  test('SET_CURRENT_BROWSE_PATH no-ops when path is unchanged', () => {
    const path = initialState.currentBrowsePath[local];
    const next = Home(initialState, {
      type: actionTypes.SET_CURRENT_BROWSE_PATH,
      deviceType: local,
      payload: path,
    });

    expect(next).toBe(initialState);
  });

  test('SET_SELECTED_DIR_LISTS no-ops when selection is unchanged', () => {
    const next = Home(initialState, {
      type: actionTypes.SET_SELECTED_DIR_LISTS,
      deviceType: local,
      payload: { selected: [] },
    });

    expect(next).toBe(initialState);
  });

  test('LIST_DIRECTORY reuses payload nodes without copying', () => {
    const nodes = [{ path: '/a', name: 'a' }];
    const next = Home(initialState, {
      type: actionTypes.LIST_DIRECTORY,
      deviceType: local,
      payload: { nodes, isLoaded: true },
    });

    expect(next.directoryLists[local].nodes).toBe(nodes);
    expect(next.directoryLists[local].isLoaded).toBe(true);
    // Opposite device pane keeps the same reference.
    expect(next.directoryLists[DEVICE_TYPE.mtp]).toBe(
      initialState.directoryLists[DEVICE_TYPE.mtp],
    );
  });

  test('BEGIN_LIST_DIRECTORY clears stale nodes in one update', () => {
    const loaded = Home(initialState, {
      type: actionTypes.LIST_DIRECTORY,
      deviceType: local,
      payload: {
        nodes: [{ path: '/old', name: 'old' }],
        isLoaded: true,
      },
    });
    const withSelection = Home(loaded, {
      type: actionTypes.SET_SELECTED_DIR_LISTS,
      deviceType: local,
      payload: { selected: ['/old'] },
    });

    const next = Home(withSelection, {
      type: actionTypes.BEGIN_LIST_DIRECTORY,
      deviceType: local,
      payload: { path: '/new' },
    });

    expect(next.currentBrowsePath[local]).toBe('/new');
    expect(next.directoryLists[local].nodes).toBe(EMPTY_NODES);
    expect(next.directoryLists[local].isLoaded).toBe(false);
    expect(next.directoryLists[local].queue.selected).toBe(EMPTY_SELECTED);
  });

  test('SET_MTP_STATUS no-ops when patch matches current device', () => {
    const next = Home(initialState, {
      type: actionTypes.SET_MTP_STATUS,
      payload: {
        isAvailable: false,
        isLoading: false,
        error: null,
      },
    });

    expect(next).toBe(initialState);
  });

  test('RESET_DIRECTORY_LIST clears nodes and selection', () => {
    const loaded = Home(initialState, {
      type: actionTypes.LIST_DIRECTORY,
      deviceType: local,
      payload: {
        nodes: [{ path: '/a', name: 'a' }],
        isLoaded: true,
      },
    });

    const next = Home(loaded, {
      type: actionTypes.RESET_DIRECTORY_LIST,
      deviceType: local,
    });

    expect(next.directoryLists[local].nodes).toBe(EMPTY_NODES);
    expect(next.directoryLists[local].queue.selected).toBe(EMPTY_SELECTED);
    expect(next.directoryLists[local].isLoaded).toBe(true);
  });
});
