import { throwAlert } from '../Alerts/actions';
import {
  processMtpBuffer,
  processLocalBuffer,
} from '../../helpers/processBufferOutput';
import { isArraysEqual, isEmpty, undefinedOrNull } from '../../utils/funcs';
import { DEVICE_TYPE, MTP_MODE } from '../../enums';
import { log } from '../../utils/log';
import fileExplorerController from '../../data/file-explorer/controllers/FileExplorerController';
import { checkIf } from '../../utils/checkIf';
import { MTP_ERROR } from '../../enums/mtpError';
import { DEVICES_DEFAULT_PATH } from '../../constants';
import { analyticsService } from '../../services/analytics';
import { actionTypes } from './actionTypes';
import {
  mtpDevicePatchIsNoop,
  normalizeNodes,
  normalizeSelected,
} from './homeStateHelpers';

export { actionTypes };

// Generation stamp so a slow listDirectory response cannot paint into a
// newer browse path after the user has already navigated away.
const listDirectoryGeneration = {
  [DEVICE_TYPE.local]: 0,
  [DEVICE_TYPE.mtp]: 0,
};

function nextListDirectoryGeneration(deviceType) {
  listDirectoryGeneration[deviceType] += 1;

  return listDirectoryGeneration[deviceType];
}

function isCurrentListDirectoryGeneration(deviceType, requestId) {
  return requestId === listDirectoryGeneration[deviceType];
}

function invalidateListDirectoryGeneration(deviceType) {
  listDirectoryGeneration[deviceType] += 1;
}

export function setFocussedFileExplorerDeviceType(data) {
  return {
    type: actionTypes.SET_FOCUSSED_FILE_EXPLORER_DEVICE_TYPE,
    payload: {
      ...data,
    },
  };
}

export function setSortingDirLists(data, deviceType) {
  return {
    type: actionTypes.SET_SORTING_DIR_LISTS,
    deviceType,
    payload: {
      ...data,
    },
  };
}

export function actionSetSelectedDirLists(data, deviceType) {
  return {
    type: actionTypes.SET_SELECTED_DIR_LISTS,
    deviceType,
    payload: {
      selected: normalizeSelected(data?.selected),
    },
  };
}

export function setCurrentBrowsePath(path, deviceType) {
  return {
    type: actionTypes.SET_CURRENT_BROWSE_PATH,
    deviceType,
    payload: path,
  };
}

function actionListDirectory(data, deviceType) {
  return {
    type: actionTypes.LIST_DIRECTORY,
    deviceType,
    payload: {
      nodes: normalizeNodes(data),
      isLoaded: true,
    },
  };
}

// Atomically update browse path, clear selection, and drop stale nodes so
// rapid navigation does not flash the previous folder under a new path.
function actionBeginListDirectory(filePath, deviceType) {
  return {
    type: actionTypes.BEGIN_LIST_DIRECTORY,
    deviceType,
    payload: {
      path: filePath,
    },
  };
}

function actionResetDirectoryList(deviceType) {
  return {
    type: actionTypes.RESET_DIRECTORY_LIST,
    deviceType,
  };
}

export function getSelectedStorageIdFromState(state) {
  const selectedStorage = getSelectedStorage(state.mtpStoragesList);

  if (isEmpty(selectedStorage?.id)) {
    return null;
  }

  return parseInt(selectedStorage.id, 10);
}

export function getSelectedStorage(mtpStoragesList) {
  checkIf(mtpStoragesList, 'object');

  if (isEmpty(mtpStoragesList)) {
    return null;
  }

  const mtpStoragesListKeys = Object.keys(mtpStoragesList);

  for (let i = 0; i < mtpStoragesListKeys.length; i += 1) {
    const itemKey = mtpStoragesListKeys[i];

    if (mtpStoragesList[itemKey].selected) {
      return { id: itemKey, data: mtpStoragesList[itemKey] };
    }
  }

  return null;
}

export function initializeMtp(
  {
    filePath,
    ignoreHidden,
    changeLegacyMtpStorageOnlyOnDeviceChange,
    deviceType,
  },
  getState,
) {
  checkIf(deviceType, 'string');
  checkIf(filePath, 'string');
  checkIf(ignoreHidden, 'boolean');
  checkIf(changeLegacyMtpStorageOnlyOnDeviceChange, 'boolean');
  checkIf(getState, 'function');

  const {
    Home: { mtpStoragesList },
    Settings: { mtpMode },
  } = getState();

  return async (dispatch) => {
    try {
      switch (mtpMode) {
        case MTP_MODE.kalam:
          return dispatch(
            initKalamMtp(
              {
                filePath,
                ignoreHidden,
                deviceType,
              },
              getState,
            ),
          );

        case MTP_MODE.legacy:
          return dispatch(
            initLegacyMtp(
              {
                filePath,
                ignoreHidden,
                deviceType,
                mtpStoragesList,
                changeLegacyMtpStorageOnlyOnDeviceChange,
              },
              getState,
            ),
          );

        default:
          break;
      }
    } catch (e) {
      log.error(e);
    }
  };
}

export function disposeMtp({ deviceType, onSuccess, onError }, getState) {
  return async (dispatch) => {
    const { mtpMode } = getState().Settings;

    checkIf(deviceType, 'string');
    checkIf(onSuccess, 'function');
    checkIf(onError, 'function');
    checkIf(mtpMode, 'string');

    try {
      switch (mtpMode) {
        case MTP_MODE.kalam:
          // oxlint-disable-next-line no-case-declarations
          const { error, stderr, data } = await fileExplorerController.dispose({
            deviceType,
          });

          await new Promise((resolve) => {
            dispatch(
              churnMtpBuffer({
                deviceType,
                error,
                stderr,
                data,
                mtpMode,
                onSuccess: ({ _, __, data }) => {
                  // Drop in-flight listDirectory results for this pane.
                  invalidateListDirectoryGeneration(deviceType);
                  dispatch(
                    actionSetMtpStatus({ info: {}, isAvailable: false }),
                  );
                  dispatch(actionResetDirectoryList(deviceType));
                  dispatch(actionChangeMtpStorage({}));

                  const _return = {
                    error: null,
                    stderr: null,
                    data,
                  };

                  onSuccess(_return);

                  return resolve(_return);
                },
                onError: ({ _, __, ___ }) => {
                  const _return = {
                    error,
                    stderr,
                    data: null,
                  };

                  onError(_return);

                  return resolve(_return);
                },
              }),
            );
          });
          break;

        default:
          break;
      }
    } catch (e) {
      log.error(e);
    }
  };
}

function initKalamMtp({ filePath, ignoreHidden, deviceType }, getState) {
  return async (dispatch) => {
    checkIf(filePath, 'string');
    checkIf(ignoreHidden, 'boolean');
    checkIf(deviceType, 'string');

    try {
      const {
        Settings: { mtpMode },
        Home: { mtpDevice: preInitMtpDevice },
      } = getState();

      checkIf(preInitMtpDevice, 'object');

      dispatchMtpStatusIfChanged(dispatch, getState, {
        isLoading: true,
      });

      // if the app was expecting the user to allow access to mtp storage
      // then don't reinitialize mtp
      const { error, stderr, data } = await fileExplorerController.initialize({
        deviceType,
      });

      await new Promise((resolve) => {
        dispatch(
          churnMtpBuffer({
            deviceType,
            error,
            stderr,
            data,
            mtpMode,
            onSuccess: ({ _, __, data }) => {
              dispatch(actionSetMtpStatus({ info: data }));

              analyticsService.sendDeviceInfo();

              return resolve({
                error: null,
                stderr: null,
                data,
              });
            },
            onError: ({ _, __, ___ }) => {
              return resolve({
                error,
                stderr,
                data: null,
              });
            },
          }),
        );
      });

      const { mtpDevice: postInitMtpDevice } = getState().Home;

      checkIf(postInitMtpDevice, 'object');

      if (!postInitMtpDevice.isAvailable) {
        return;
      }

      let _filePath = filePath;

      if (
        !undefinedOrNull(preInitMtpDevice?.info?.mtpDeviceInfo?.SerialNumber) &&
        !undefinedOrNull(
          postInitMtpDevice?.info?.mtpDeviceInfo?.SerialNumber,
        ) &&
        preInitMtpDevice?.info?.mtpDeviceInfo?.SerialNumber !==
          postInitMtpDevice?.info?.mtpDeviceInfo?.SerialNumber
      ) {
        _filePath = DEVICES_DEFAULT_PATH[deviceType];
        dispatch(actionChangeMtpStorage({}));
      }

      dispatchMtpStatusIfChanged(dispatch, getState, {
        isLoading: true,
      });

      await new Promise((resolve) => {
        dispatch(
          listKalamStorages(
            {
              filePath,
              ignoreHidden,
              deviceType,
              onSuccess: () => {
                resolve();
              },
              onError: () => {
                resolve();
              },
            },
            getState,
          ),
        );
      });

      const { mtpDevice: postStorageAccessMtpDevice } = getState().Home;

      checkIf(postStorageAccessMtpDevice, 'object');

      if (!postStorageAccessMtpDevice.isAvailable) {
        return;
      }

      dispatchMtpStatusIfChanged(dispatch, getState, {
        isLoading: true,
      });

      dispatch(
        reloadDirList(
          { filePath: _filePath, ignoreHidden, deviceType },
          getState,
        ),
      );
    } catch (e) {
      log.error(e);
    }
  };
}

function listKalamStorages(
  { filePath, ignoreHidden, deviceType, onSuccess, onError },
  getState,
) {
  return async (dispatch) => {
    checkIf(filePath, 'string');
    checkIf(ignoreHidden, 'boolean');
    checkIf(deviceType, 'string');
    checkIf(onSuccess, 'function');
    checkIf(onError, 'function');

    try {
      const { mtpMode } = getState().Settings;

      checkIf(mtpMode, 'string');

      const { error, stderr, data } = await fileExplorerController.listStorages(
        {
          deviceType,
        },
      );

      return new Promise((resolve) => {
        dispatch(
          churnMtpBuffer({
            deviceType,
            error,
            stderr,
            data,
            mtpMode,
            onSuccess: async () => {
              dispatch(actionChangeMtpStorage({ ...data }));

              onSuccess();

              return resolve({
                error: null,
                stderr: null,
                data,
              });
            },
            onError: async () => {
              onError();

              return resolve({
                error,
                stderr,
                data: null,
              });
            },
          }),
        );
      });
    } catch (e) {
      log.error(e);
    }
  };
}

function initLegacyMtp(
  {
    filePath,
    ignoreHidden,
    deviceType,
    mtpStoragesList,
    changeLegacyMtpStorageOnlyOnDeviceChange,
  },
  getState,
) {
  return async (dispatch) => {
    checkIf(filePath, 'string');
    checkIf(ignoreHidden, 'boolean');
    checkIf(deviceType, 'string');
    checkIf(mtpStoragesList, 'object');
    checkIf(changeLegacyMtpStorageOnlyOnDeviceChange, 'boolean');

    const { mtpMode } = getState().Settings;

    try {
      const { error, stderr, data } = await fileExplorerController.listStorages(
        {
          deviceType,
        },
      );

      dispatch(
        churnMtpBuffer({
          deviceType,
          error,
          stderr,
          data,
          mtpMode,
          onSuccess: () => {
            let updateMtpStorage = true;

            if (
              changeLegacyMtpStorageOnlyOnDeviceChange &&
              !isEmpty(mtpStoragesList) &&
              isArraysEqual(Object.keys(data), Object.keys(mtpStoragesList))
            ) {
              updateMtpStorage = false;
            }

            if (updateMtpStorage) {
              dispatch(actionChangeMtpStorage({ ...data }));
            }

            dispatch(
              listDirectory(
                {
                  filePath,
                  ignoreHidden,
                },
                deviceType,
                getState,
              ),
            );
          },
        }),
      );
    } catch (e) {
      log.error(e);
    }
  };
}

export function actionChangeMtpStorage({ ...data }) {
  return {
    type: actionTypes.CHANGE_MTP_STORAGE,
    payload: data,
  };
}

/**
 *
 * @param args {isAvailable, error, isLoading, info}
 * @return {{payload: {}, type: *}}
 */
export function actionSetMtpStatus({ ...args }) {
  return {
    type: actionTypes.SET_MTP_STATUS,
    payload: args,
  };
}

function dispatchMtpStatusIfChanged(dispatch, getState, patch) {
  const { mtpDevice } = getState().Home;

  if (mtpDevicePatchIsNoop(mtpDevice, patch)) {
    return;
  }

  dispatch(actionSetMtpStatus(patch));
}

// This is the main entry point of data received from the MTP kernel.
// The data received here undergoes processing and the neccessary actions are taken accordingly
export function churnMtpBuffer({
  deviceType,
  error,
  stderr,
  data,
  mtpMode,
  onSuccess,
  onError,
}) {
  checkIf(onSuccess, 'function');
  checkIf(mtpMode, 'string');

  return async (dispatch, getState) => {
    try {
      const {
        mtpStatus,
        error: mtpError,
        throwAlert: mtpThrowAlert,
        logError: mtpLogError,
        reportError: mtpReportError,
      } = await processMtpBuffer({ error, stderr, mtpMode });

      dispatchMtpStatusIfChanged(dispatch, getState, {
        isAvailable: mtpStatus,
        error: mtpMode === MTP_MODE.kalam ? stderr : error,
        isLoading: false,
      });

      if (!mtpStatus) {
        dispatch(actionResetDirectoryList(deviceType));

        if (onError) {
          onError({ error, stderr, data: null });
        }
      }

      if (mtpError) {
        if (mtpLogError) {
          log.error(
            mtpError,
            'churnMtpBuffer.mtpError',
            mtpLogError,
            true,
            mtpReportError === true,
            false,
          );
          log.error(error, 'churnMtpBuffer.error', true, true, false);
          log.error(stderr, 'churnMtpBuffer.stderr', true, true, false);
        }

        if (mtpThrowAlert) {
          dispatch(throwAlert({ message: mtpError.toString() }));
        }

        return;
      }

      return onSuccess({ error: null, stderr: null, data });
    } catch (e) {
      log.error(e);
    }
  };
}

// this is the main entry point of data received from the local disk file actions.
// the data received here undergoes processing and the neccessary actions are taken accordingly
export function churnLocalBuffer({
  _,
  error,
  stderr,
  data,
  onSuccess,
  onError,
}) {
  return (dispatch) => {
    try {
      const {
        error: localError,
        throwAlert: localThrowAlert,
        logError: localLogError,
      } = processLocalBuffer({ error, stderr });

      if (localError) {
        log.error(localError, 'churnLocalBuffer', localLogError);

        if (localThrowAlert) {
          dispatch(throwAlert({ message: localError.toString() }));
        }

        if (onError) {
          onError({ error, stderr, data: null });
        }

        return false;
      }

      checkIf(onSuccess, 'function');

      onSuccess({ error: null, stderr: null, data });
    } catch (e) {
      log.error(e);
    }
  };
}

function restoreBrowseSnapshot(dispatch, deviceType, snapshot) {
  if (!snapshot) {
    return;
  }

  if (!undefinedOrNull(snapshot.path)) {
    dispatch(setCurrentBrowsePath(snapshot.path, deviceType));
  }

  dispatch({
    type: actionTypes.LIST_DIRECTORY,
    deviceType,
    payload: {
      nodes: normalizeNodes(snapshot.nodes),
      isLoaded: snapshot.isLoaded,
    },
  });
}

async function runListDirectory({
  dispatch,
  getState,
  deviceType,
  filePath,
  ignoreHidden,
  storageId,
  mtpMode,
  onError,
  onSuccess,
}) {
  const homeState = getState().Home;
  const directoryList = homeState?.directoryLists?.[deviceType];
  const previousSnapshot = {
    path: homeState?.currentBrowsePath?.[deviceType],
    nodes: directoryList?.nodes,
    isLoaded: directoryList?.isLoaded === true,
  };
  const requestId = nextListDirectoryGeneration(deviceType);

  // One reducer update: path + clear selection + drop stale nodes / loader.
  dispatch(actionBeginListDirectory(filePath, deviceType));

  const { error, stderr, data } = await fileExplorerController.listFiles({
    deviceType,
    filePath,
    ignoreHidden,
    storageId,
  });

  if (!isCurrentListDirectoryGeneration(deviceType, requestId)) {
    return;
  }

  if (deviceType === DEVICE_TYPE.local) {
    if (error) {
      log.error(error, 'listDirectory -> listFiles');
      restoreBrowseSnapshot(dispatch, deviceType, previousSnapshot);

      dispatch(
        churnLocalBuffer({
          deviceType,
          error,
          stderr,
          data,
          onSuccess: () => {},
        }),
      );

      return;
    }

    dispatch(actionListDirectory(data, deviceType));

    return;
  }

  // MTP happy path: skip churnMtpBuffer / processMtpBuffer — no error
  // handling needed, and that path previously added an unnecessary
  // await on every folder open.
  if (!error && !stderr) {
    dispatchMtpStatusIfChanged(dispatch, getState, {
      isAvailable: true,
      isLoading: false,
    });
    dispatch(actionListDirectory(data, deviceType));

    if (onSuccess) {
      onSuccess({ error: null, stderr: null, data });
    }

    return;
  }

  // Revert optimistic navigation before churn so a hard failure does not
  // leave the pane stuck on an empty loading state.
  restoreBrowseSnapshot(dispatch, deviceType, previousSnapshot);

  dispatch(
    churnMtpBuffer({
      deviceType,
      error,
      stderr,
      data,
      mtpMode,
      onSuccess: ({
        error: successError,
        stderr: successStderr,
        data: successData,
      }) => {
        if (!isCurrentListDirectoryGeneration(deviceType, requestId)) {
          return;
        }

        dispatch(setCurrentBrowsePath(filePath, deviceType));
        dispatch(actionListDirectory(successData, deviceType));

        if (onSuccess) {
          onSuccess({
            error: successError,
            stderr: successStderr,
            data: successData,
          });
        }
      },

      onError: ({ error: errError, stderr: errStderr, data: errData }) => {
        if (!isCurrentListDirectoryGeneration(deviceType, requestId)) {
          return;
        }

        // churnMtpBuffer may clear the directory on unavailable MTP; keep
        // that outcome. Only invoke the caller hook.
        if (onError) {
          onError({ error: errError, stderr: errStderr, data: errData });
        }
      },
    }),
  );
}

export function listDirectory(
  { filePath, ignoreHidden, onError, onSuccess },
  deviceType,
  getState,
) {
  checkIf(filePath, 'string');
  checkIf(ignoreHidden, 'boolean');
  checkIf(getState, 'function');

  const { mtpMode } = getState().Settings;

  try {
    switch (deviceType) {
      case DEVICE_TYPE.local:
        return async (dispatch) => {
          await runListDirectory({
            dispatch,
            getState,
            deviceType,
            filePath,
            ignoreHidden,
            storageId: null,
            mtpMode,
            onError,
            onSuccess,
          });
        };

      case DEVICE_TYPE.mtp:
        return async (dispatch) => {
          const storageId = getSelectedStorageIdFromState(getState().Home);

          if (undefinedOrNull(storageId)) {
            return;
          }

          await runListDirectory({
            dispatch,
            getState,
            deviceType,
            filePath,
            ignoreHidden,
            storageId,
            mtpMode,
            onError,
            onSuccess,
          });
        };

      default:
        break;
    }
  } catch (e) {
    log.error(e);
  }
}

export function reloadDirList(
  { filePath, ignoreHidden, deviceType },
  getState,
) {
  checkIf(deviceType, 'inObjectValues', DEVICE_TYPE);
  checkIf(filePath, 'string');
  checkIf(ignoreHidden, 'boolean');
  checkIf(getState, 'function');

  const {
    Home: { mtpDevice },
    Settings: { mtpMode },
  } = getState();

  checkIf(mtpDevice, 'object');

  return (dispatch) => {
    switch (deviceType) {
      case DEVICE_TYPE.local:
        return dispatch(
          listDirectory({ filePath, ignoreHidden }, deviceType, getState),
        );

      case DEVICE_TYPE.mtp:
        switch (mtpMode) {
          case MTP_MODE.legacy:
            return dispatch(
              initializeMtp(
                {
                  filePath,
                  ignoreHidden,
                  changeLegacyMtpStorageOnlyOnDeviceChange: true,
                  deviceType,
                },
                getState,
              ),
            );

          case MTP_MODE.kalam:
          default:
            dispatchMtpStatusIfChanged(dispatch, getState, {
              isLoading: true,
            });

            // if mtpdevice is available then list directory
            if (mtpDevice.isAvailable) {
              return dispatch(
                listDirectory(
                  {
                    filePath,
                    ignoreHidden,
                    onError: ({ stderr }) => {
                      // if device was changed then reinitialize the mtp
                      if (stderr === MTP_ERROR.ErrorDeviceChanged) {
                        dispatch(
                          initializeMtp(
                            {
                              filePath,
                              ignoreHidden,
                              changeLegacyMtpStorageOnlyOnDeviceChange: true,
                              deviceType,
                            },
                            getState,
                          ),
                        );
                      }
                    },
                    onSuccess: () => {},
                  },
                  deviceType,
                  getState,
                ),
              );
            }

            // if the mtp was not previously initialized then initialize it
            return dispatch(
              initializeMtp(
                {
                  filePath,
                  ignoreHidden,
                  changeLegacyMtpStorageOnlyOnDeviceChange: true,
                  deviceType,
                },
                getState,
              ),
            );
        }

      default:
        break;
    }
  };
}

export function setFileTransferClipboard({ ...data }) {
  return {
    type: actionTypes.SET_FILE_TRANSFER_CLIPBOARD,
    payload: {
      ...data,
    },
  };
}

export function setFileTransferProgress({ ...data }) {
  return {
    type: actionTypes.SET_FILE_TRANSFER_PROGRESS,
    payload: {
      ...data,
    },
  };
}

export function clearFileTransfer() {
  return {
    type: actionTypes.CLEAR_FILE_TRANSFER,
  };
}

export function setFilesDrag({ ...data }) {
  return {
    type: actionTypes.SET_FILES_DRAG,
    payload: {
      ...data,
    },
  };
}

export function clearFilesDrag() {
  return {
    type: actionTypes.CLEAR_FILES_DRAG,
  };
}

// Both panes share mutation, error classification and refresh semantics.
function changeDirectoryEntry(
  method,
  { deviceType, ...args },
  listDirectoryArgs,
) {
  return async (dispatch, getState) => {
    if (deviceType !== DEVICE_TYPE.local && deviceType !== DEVICE_TYPE.mtp)
      return;
    try {
      const { Settings, Home } = getState();
      const isMtp = deviceType === DEVICE_TYPE.mtp;
      const { error, stderr, data } = await fileExplorerController[method]({
        ...args,
        deviceType,
        storageId: isMtp ? getSelectedStorageIdFromState(Home) : null,
      });
      const churn = isMtp ? churnMtpBuffer : churnLocalBuffer;
      dispatch(
        churn({
          error,
          stderr,
          data,
          deviceType,
          mtpMode: Settings.mtpMode,
          onSuccess: () =>
            dispatch(
              listDirectory({ ...listDirectoryArgs }, deviceType, getState),
            ),
        }),
      );
    } catch (error) {
      log.error(error);
    }
  };
}

export function renameDirectoryEntry(args, listDirectoryArgs) {
  return changeDirectoryEntry('renameFile', args, listDirectoryArgs);
}

export function createDirectory(
  { newFolderPath, deviceType },
  listDirectoryArgs,
) {
  return changeDirectoryEntry(
    'makeDirectory',
    { filePath: newFolderPath, deviceType },
    listDirectoryArgs,
  );
}
