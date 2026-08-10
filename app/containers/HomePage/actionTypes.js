import prefixer from '../../helpers/reducerPrefixer';

const prefix = '@@Home';
const actionTypesList = [
  'SET_FOCUSSED_FILE_EXPLORER_DEVICE_TYPE',
  'SET_CURRENT_BROWSE_PATH',
  'SET_SORTING_DIR_LISTS',
  'SET_SELECTED_DIR_LISTS',
  'LIST_DIRECTORY',
  'BEGIN_LIST_DIRECTORY',
  'RESET_DIRECTORY_LIST',
  'SET_MTP_ERRORS',
  'SET_MTP_STATUS',
  'CHANGE_MTP_STORAGE',
  'SET_FILE_TRANSFER_CLIPBOARD',
  'SET_FILE_TRANSFER_PROGRESS',
  'CLEAR_FILE_TRANSFER',
  'SET_FILES_DRAG',
  'CLEAR_FILES_DRAG',
];

export const actionTypes = prefixer(prefix, actionTypesList);
