import React, { PureComponent } from 'react';
import AppBar from '@material-ui/core/AppBar';
import Toolbar from '@material-ui/core/Toolbar';
import Drawer from '@material-ui/core/Drawer';
import IconButton from '@material-ui/core/IconButton';
import Tooltip from '@material-ui/core/Tooltip';
import classNames from 'classnames';
import { Menu, HardDrive, Zap, Terminal } from 'lucide-react';
import Icon from '../../../components/Icon';
import SidebarAreaPaneLists from './SidebarAreaPaneLists';
import { LazyLoaderOverlay } from '../styles/ToolbarAreaPane';
import { DEVICES_LABEL } from '../../../constants';
import {
  Confirm as ConfirmDialog,
  Selection as SelectionDialog,
} from '../../../components/DialogBox';
import { DEVICE_TYPE, MTP_MODE } from '../../../enums';
import { capitalize, isEmpty } from '../../../utils/funcs';
import { imgsrc } from '../../../utils/imgsrc';
import { isKalamModeSupported } from '../../../helpers/binaries';

export default class ToolbarAreaPane extends PureComponent {
  activeToolbarList = ({ ...args }) => {
    const {
      toolbarList,
      directoryLists,
      currentBrowsePath,
      deviceType,
      mtpStoragesList,
      mtpDevice,
      mtpMode,
    } = args;

    const _directoryLists = directoryLists[deviceType];
    const _currentBrowsePath = currentBrowsePath[deviceType];
    const sourceToolbarList = toolbarList[deviceType];
    const isMtp = deviceType === DEVICE_TYPE.mtp;

    let enabled = true;

    if (isMtp && mtpMode === MTP_MODE.kalam) {
      enabled = !mtpDevice.isLoading;
    }

    // Build a fresh tree — never mutate Redux-owned toolbarList objects.
    const nextToolbarList = {};

    Object.keys(sourceToolbarList).forEach((a) => {
      const item = sourceToolbarList[a];

      switch (a) {
        case 'up':
          nextToolbarList[a] = {
            ...item,
            enabled: _currentBrowsePath !== '/' && enabled,
          };
          break;

        case 'refresh':
          nextToolbarList[a] = {
            ...item,
            enabled,
          };
          break;

        case 'delete':
          nextToolbarList[a] = {
            ...item,
            enabled: _directoryLists.queue.selected.length > 0 && enabled,
          };
          break;

        case 'storage':
          nextToolbarList[a] = {
            ...item,
            enabled:
              Object.keys(mtpStoragesList).length > 0 &&
              isMtp &&
              mtpDevice.isAvailable &&
              enabled,
          };
          break;

        case 'settings':
        case 'mtpMode':
          nextToolbarList[a] = {
            ...item,
          };
          break;

        default:
          nextToolbarList[a] = item;
          break;
      }
    });

    return nextToolbarList;
  };

  render() {
    const {
      directoryLists,
      mtpDevice,
      styles,
      sidebarFavouriteList,
      deviceType,
      showMenu,
      currentBrowsePath,
      mtpStoragesList,
      toggleDeleteConfirmDialog,
      toggleMtpStorageSelectionDialog,
      toggleMtpModeSelectionDialog,
      toolbarList,
      isLoadedDirectoryLists,
      toggleDrawer,
      appThemeMode,
      onDeleteConfirmDialog,
      onMtpStoragesListClick,
      onMtpModeSelectionDialogClick,
      onToggleDrawer,
      onListDirectory,
      onDoubleClickToolBar,
      onToolbarAction,
      showLocalPaneOnLeftSide,
      mtpMode,
    } = this.props;

    const _toolbarList = this.activeToolbarList({
      toolbarList,
      directoryLists,
      currentBrowsePath,
      deviceType,
      mtpStoragesList,
      mtpDevice,
      mtpMode,
    });

    const RenderLazyLoaderOverlay = LazyLoaderOverlay({ appThemeMode });
    let _mtpStoragesList = [];

    if (!isEmpty(mtpStoragesList)) {
      _mtpStoragesList = Object.keys(mtpStoragesList).map((a) => {
        // spread operator is used here to prevent modifying the original object
        const item = { ...mtpStoragesList[a] };

        item.icon = HardDrive;
        item.value = a;

        return item;
      });
    }

    const mtpModeList = [
      {
        value: MTP_MODE.kalam,
        name: `${capitalize(MTP_MODE.kalam)} Mode`,
        icon: Zap,
        selected: mtpMode === MTP_MODE.kalam,
        hint: 'The all new and powerful MTP kernel — named after Dr. A. P. J. Abdul Kalam - Statesman, Scientist and Poet',
      },
      {
        value: MTP_MODE.legacy,
        name: `${capitalize(MTP_MODE.legacy)} Mode`,
        icon: Terminal,
        selected: mtpMode === MTP_MODE.legacy,
        hint: `Previous generation MTP Kernel. Use this if Kalam mode doesn't detect your phone`,
      },
    ];

    // We have now officially retired the support for `Kalam` Kernel on macOS 10.13 (OS X El High Sierra) and lower. Only the "Legacy" MTP mode will continue working on these outdated machines.
    const showMtpModeSelection = isKalamModeSupported();

    return (
      <div className={styles.root}>
        <ConfirmDialog
          fullWidthDialog
          maxWidthDialog="xs"
          bodyText={`Are you sure you want to permanently delete the items from your ${DEVICES_LABEL[deviceType]}?`}
          trigger={toggleDeleteConfirmDialog}
          onClickHandler={onDeleteConfirmDialog}
        />
        <SelectionDialog
          titleText="Select Storage Option"
          list={_mtpStoragesList}
          id="selectionDialog"
          showAvatar
          open={
            deviceType === DEVICE_TYPE.mtp && toggleMtpStorageSelectionDialog
          }
          onClose={onMtpStoragesListClick}
        />

        {showMtpModeSelection && (
          <SelectionDialog
            titleText="Select MTP Mode"
            list={mtpModeList}
            id="selectionDialog"
            showAvatar
            open={
              deviceType === DEVICE_TYPE.mtp && toggleMtpModeSelectionDialog
            }
            onClose={onMtpModeSelectionDialogClick}
          />
        )}
        <Drawer
          open={toggleDrawer}
          onClose={onToggleDrawer(false)}
          anchor={!showLocalPaneOnLeftSide ? 'right' : 'left'}
        >
          <div
            tabIndex={0}
            role="button"
            onClick={onToggleDrawer(false)}
            onKeyDown={onToggleDrawer(false)}
          />
          <SidebarAreaPaneLists
            onClickHandler={onListDirectory}
            sidebarFavouriteList={sidebarFavouriteList}
            deviceType={deviceType}
            currentBrowsePath={currentBrowsePath[deviceType]}
          />
        </Drawer>

        {!isLoadedDirectoryLists && <RenderLazyLoaderOverlay />}

        <AppBar position="static" elevation={0} className={styles.appBar}>
          <Toolbar
            className={styles.toolbar}
            disableGutters
            onDoubleClick={(event) => {
              onDoubleClickToolBar(event);
            }}
          >
            {showMenu && (
              <IconButton
                color="inherit"
                className={styles.toolbarIconBtn}
                onClick={onToggleDrawer(true)}
              >
                <Icon icon={Menu} size={22} />
              </IconButton>
            )}

            <div className={styles.toolbarInnerWrapper}>
              {Object.keys(_toolbarList).map((a) => {
                const item = _toolbarList[a];

                return (
                  <Tooltip key={a} title={item.label}>
                    <div className={`${styles.navBtns} ${styles.noAppDrag}`}>
                      <IconButton
                        aria-label={item.label}
                        disabled={!item.enabled}
                        onClick={() => onToolbarAction(a)}
                        className={classNames(styles.toolbarIconBtn, {
                          [styles.disabledNavBtns]: !item.enabled,
                          [styles.invertedNavBtns]: item.invert,
                          [styles.imageBtn]: item.image,
                        })}
                      >
                        {item.image && (
                          <img
                            alt={item.label}
                            src={imgsrc(item.image, false)}
                            className={styles.navBtnImages}
                          />
                        )}

                        {item.icon && (
                          <Icon
                            icon={item.icon}
                            size={20}
                            className={styles.navBtnIcons}
                            title={item.label}
                          />
                        )}
                      </IconButton>
                    </div>
                  </Tooltip>
                );
              })}
            </div>
          </Toolbar>
        </AppBar>
      </div>
    );
  }
}
