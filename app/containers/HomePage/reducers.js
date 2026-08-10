import {
  ArrowLeft,
  RefreshCw,
  Trash2,
  Settings,
  HelpCircle,
  HardDrive,
  Plug,
} from 'lucide-react';
import { Github, Paypal } from '../../components/Icon/brands';
import { actionTypes } from './actionTypes';
import { PATHS } from '../../constants/paths';
import {
  DEVICES_DEFAULT_PATH,
  FILE_EXPLORER_DEFAULT_FOCUSSED_DEVICE_TYPE,
} from '../../constants';
import { DEVICE_TYPE } from '../../enums';
import {
  buyMeACoffeeText,
  supportUsingPayPal,
} from '../../templates/fileExplorer';
import { isKalamModeSupported } from '../../helpers/binaries';
import { isArraysEqual } from '../../utils/funcs';
import {
  EMPTY_NODES,
  EMPTY_SELECTED,
  mtpDevicePatchIsNoop,
  normalizeNodes,
  normalizeSelected,
} from './homeStateHelpers';

export const initialState = {
  focussedFileExplorerDeviceType: {
    accelerator: FILE_EXPLORER_DEFAULT_FOCUSSED_DEVICE_TYPE,
    onClick: FILE_EXPLORER_DEFAULT_FOCUSSED_DEVICE_TYPE,
    value: FILE_EXPLORER_DEFAULT_FOCUSSED_DEVICE_TYPE,
  },

  sidebarFavouriteList: {
    top: [
      {
        label: 'Home',
        path: PATHS.homeDir,
        icon: 'folder',
        enabled: true,
      },
      {
        label: 'Desktop',
        path: PATHS.desktopDir,
        icon: 'folder',
        enabled: true,
      },
      {
        label: 'Downloads',
        path: PATHS.downloadsDir,
        icon: 'folder',
        enabled: true,
      },
      {
        label: 'Removable Disks',
        path: PATHS.volumesDir,
        icon: 'folder',
        enabled: true,
      },
      {
        label: 'Root',
        path: PATHS.systemRootDir,
        icon: 'folder',
        enabled: true,
      },
    ],
    bottom: [],
  },

  toolbarList: {
    [DEVICE_TYPE.local]: {
      up: {
        enabled: true,
        label: 'Folder Up',
        icon: ArrowLeft,
      },
      refresh: {
        enabled: true,
        label: 'Refresh',
        icon: RefreshCw,
      },
      delete: {
        enabled: true,
        label: 'Delete',
        icon: Trash2,
      },
      gitHub: {
        enabled: true,
        label: 'GitHub',
        icon: Github,
      },
      settings: {
        enabled: true,
        label: 'Settings',
        icon: Settings,
      },
      faqs: {
        enabled: true,
        label: 'Help - FAQs',
        icon: HelpCircle,
      },
    },
    [DEVICE_TYPE.mtp]: {
      up: {
        enabled: true,
        label: 'Folder Up',
        icon: ArrowLeft,
      },
      refresh: {
        enabled: true,
        label: 'Refresh',
        icon: RefreshCw,
      },
      delete: {
        enabled: true,
        label: 'Delete',
        icon: Trash2,
      },
      storage: {
        enabled: true,
        label: 'Storage',
        icon: HardDrive,
      },
      mtpMode: {
        enabled: isKalamModeSupported(),
        label: 'MTP Mode',
        icon: Plug,
      },
      paypal: {
        enabled: true,
        label: supportUsingPayPal,
        icon: Paypal,
      },
      buyMeACoffee: {
        enabled: true,
        label: buyMeACoffeeText,
        image: 'toolbar/buymeacoffee.png',
        icon: null,
      },
      settings: {
        enabled: true,
        label: 'Settings',
        icon: Settings,
      },
    },
  },

  directoryLists: {
    [DEVICE_TYPE.local]: {
      order: 'asc',
      orderBy: 'name',
      queue: {
        selected: EMPTY_SELECTED,
      },
      nodes: EMPTY_NODES,
      isLoaded: false,
    },
    [DEVICE_TYPE.mtp]: {
      order: 'asc',
      orderBy: 'name',
      queue: {
        selected: EMPTY_SELECTED,
      },
      nodes: EMPTY_NODES,
      isLoaded: false,
    },
  },

  currentBrowsePath: {
    [DEVICE_TYPE.local]: DEVICES_DEFAULT_PATH.local,
    [DEVICE_TYPE.mtp]: DEVICES_DEFAULT_PATH.mtp,
  },

  mtpDevice: {
    isAvailable: false,
    error: null,
    isLoading: false,

    /**
     * params: {mtpDeviceInfo, usbDeviceInfo} - info
     *
     */
    info: {},
  },

  contextMenuList: {
    [DEVICE_TYPE.local]: {
      rename: {
        enabled: true,
        label: 'Rename',
        data: {},
      },
      copy: {
        enabled: true,
        label: 'Copy',
        data: {},
      },
      copyToQueue: {
        enabled: true,
        label: 'Copy to Queue',
        data: {},
      },
      paste: {
        enabled: true,
        label: 'Paste',
        data: {},
      },
      newFolder: {
        enabled: true,
        label: 'New Folder',
        data: {},
      },
      showInEnclosingFolder: {
        enabled: true,
        label: 'Open in Finder',
        data: {},
      },
    },
    [DEVICE_TYPE.mtp]: {
      rename: {
        enabled: true,
        label: 'Rename',
        data: {},
      },
      copy: {
        enabled: true,
        label: 'Copy',
        data: {},
      },
      copyToQueue: {
        enabled: true,
        label: 'Copy to Queue',
        data: {},
      },
      paste: {
        enabled: true,
        label: 'Paste',
        data: {},
      },
      newFolder: {
        enabled: true,
        label: 'New Folder',
        data: {},
      },
    },
  },

  /**
   * description - MTP Storage list
   *
   *    {
   *      string: { <----- storageId
   *        "name": string,
   *        "selected": boolean,
   *        "info": {} | undefined,
   *      }
   *    }
   *
   */
  mtpStoragesList: {},

  fileTransfer: {
    clipboard: {
      queue: [],
      source: null,
    },
    progress: {
      toggle: false,
      titleText: null,
      bottomText: null,

      /**
       *  [{
       *    percentage,
       *    variant,
       *    bodyText1,
       *    bodyText2,
       *  }]
       */
      values: [],
    },
  },

  filesDrag: {
    sourceDeviceType: null,
    destinationDeviceType: null,
    enter: false,
    lock: false,
    sameSourceDestinationLock: false,
  },
};

export default function Home(state = initialState, action) {
  const { type, payload, deviceType = null } = action;

  switch (type) {
    case actionTypes.SET_FOCUSSED_FILE_EXPLORER_DEVICE_TYPE:
      return {
        ...state,
        focussedFileExplorerDeviceType: {
          ...state.focussedFileExplorerDeviceType,
          ...payload,
        },
      };

    case actionTypes.SET_SORTING_DIR_LISTS:
      return {
        ...state,
        directoryLists: {
          ...state.directoryLists,
          [deviceType]: {
            ...state.directoryLists[deviceType],
            ...payload,
          },
        },
      };

    case actionTypes.SET_SELECTED_DIR_LISTS: {
      const dir = state.directoryLists[deviceType];
      const selected = normalizeSelected(payload.selected);

      if (isArraysEqual(dir.queue.selected, selected)) {
        return state;
      }

      return {
        ...state,
        directoryLists: {
          ...state.directoryLists,
          [deviceType]: {
            ...dir,
            queue: {
              selected,
            },
          },
        },
      };
    }

    case actionTypes.SET_CURRENT_BROWSE_PATH: {
      if (state.currentBrowsePath[deviceType] === payload) {
        return state;
      }

      return {
        ...state,
        currentBrowsePath: {
          ...state.currentBrowsePath,
          [deviceType]: payload,
        },
      };
    }

    case actionTypes.SET_MTP_STATUS: {
      if (mtpDevicePatchIsNoop(state.mtpDevice, payload)) {
        return state;
      }

      return {
        ...state,
        mtpDevice: {
          ...state.mtpDevice,
          ...payload,
        },
      };
    }

    case actionTypes.LIST_DIRECTORY: {
      const dir = state.directoryLists[deviceType];
      const nodes = normalizeNodes(payload.nodes);

      if (dir.nodes === nodes && dir.isLoaded === payload.isLoaded) {
        return state;
      }

      return {
        ...state,
        directoryLists: {
          ...state.directoryLists,
          [deviceType]: {
            ...dir,
            nodes,
            isLoaded: payload.isLoaded,
          },
        },
      };
    }

    case actionTypes.BEGIN_LIST_DIRECTORY: {
      const { path } = payload;
      const dir = state.directoryLists[deviceType];
      const pathUnchanged = state.currentBrowsePath[deviceType] === path;
      const selectionEmpty = dir.queue.selected.length === 0;
      const alreadyPending = dir.nodes.length === 0 && dir.isLoaded === false;

      // Same path already mid-load with empty selection — nothing to do.
      if (pathUnchanged && selectionEmpty && alreadyPending) {
        return state;
      }

      let nextState = state;

      if (!pathUnchanged) {
        nextState = {
          ...nextState,
          currentBrowsePath: {
            ...nextState.currentBrowsePath,
            [deviceType]: path,
          },
        };
      }

      if (!selectionEmpty || !alreadyPending) {
        nextState = {
          ...nextState,
          directoryLists: {
            ...nextState.directoryLists,
            [deviceType]: {
              ...dir,
              nodes: EMPTY_NODES,
              isLoaded: false,
              queue: selectionEmpty ? dir.queue : { selected: EMPTY_SELECTED },
            },
          },
        };
      }

      return nextState;
    }

    case actionTypes.RESET_DIRECTORY_LIST: {
      const dir = state.directoryLists[deviceType];
      const alreadyReset =
        dir.nodes.length === 0 &&
        dir.isLoaded === true &&
        dir.queue.selected.length === 0;

      if (alreadyReset) {
        return state;
      }

      return {
        ...state,
        directoryLists: {
          ...state.directoryLists,
          [deviceType]: {
            ...dir,
            nodes: EMPTY_NODES,
            isLoaded: true,
            queue: { selected: EMPTY_SELECTED },
          },
        },
      };
    }

    case actionTypes.CHANGE_MTP_STORAGE:
      return {
        ...state,
        mtpStoragesList: {
          ...initialState.mtpStoragesList,
          ...payload,
        },
      };

    case actionTypes.SET_FILE_TRANSFER_CLIPBOARD:
      return {
        ...state,
        fileTransfer: {
          ...state.fileTransfer,
          clipboard: {
            ...payload,
          },
        },
      };

    case actionTypes.SET_FILE_TRANSFER_PROGRESS:
      return {
        ...state,
        fileTransfer: {
          ...state.fileTransfer,
          progress: {
            ...payload,
          },
        },
      };

    case actionTypes.CLEAR_FILE_TRANSFER:
      return {
        ...state,
        fileTransfer: {
          ...initialState.fileTransfer,
        },
      };

    case actionTypes.SET_FILES_DRAG:
      return {
        ...state,
        filesDrag: {
          ...state.filesDrag,
          ...payload,
        },
      };

    case actionTypes.CLEAR_FILES_DRAG:
      return {
        ...state,
        filesDrag: {
          ...initialState.filesDrag,
        },
      };

    default:
      return state;
  }
}
