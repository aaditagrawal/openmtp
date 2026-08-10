import { createSelector } from 'reselect';
import { initialState } from './reducers';
import { getSelectedStorageIdFromState } from './actions';

// Stable fallback keeps reselect memoization honest when Home is missing.
const selectHome = (state) => state?.Home ?? initialState;

export const makeFocussedFileExplorerDeviceType = createSelector(
  selectHome,
  (home) => home.focussedFileExplorerDeviceType,
);

export const makeToolbarList = createSelector(
  selectHome,
  (home) => home.toolbarList,
);

export const makeSidebarFavouriteList = createSelector(
  selectHome,
  (home) => home.sidebarFavouriteList,
);

export const makeCurrentBrowsePath = createSelector(
  selectHome,
  (home) => home.currentBrowsePath,
);

export const makeDirectoryLists = createSelector(
  selectHome,
  (home) => home.directoryLists,
);

export const makeMtpDevice = createSelector(
  selectHome,
  (home) => home.mtpDevice,
);

export const makeContextMenuList = createSelector(
  selectHome,
  (home) => home.contextMenuList,
);

export const makeMtpStoragesList = createSelector(
  selectHome,
  (home) => home.mtpStoragesList,
);

export const makeStorageId = createSelector(selectHome, (home) =>
  getSelectedStorageIdFromState(home),
);

export const makeFileTransferClipboard = createSelector(
  selectHome,
  (home) => home.fileTransfer.clipboard,
);

export const makeFileTransferProgess = createSelector(
  selectHome,
  (home) => home.fileTransfer.progress,
);

export const makeFilesDrag = createSelector(
  selectHome,
  (home) => home.filesDrag,
);
