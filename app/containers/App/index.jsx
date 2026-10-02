import { ipcRenderer } from 'electron';
import React, { Component } from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { withStyles } from 'tss-react/mui';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { materialUiTheme, styles } from './styles';
import Alerts from '../Alerts';
import Titlebar from './components/Titlebar';
import ErrorBoundary from '../ErrorBoundary';
import Routes from '../../routing';
import { bootLoader } from '../../helpers/bootHelper';
import { settingsStorage } from '../../helpers/storageHelper';
import SettingsDialog from '../Settings';
import { copyJsonFileToSettings, freshInstall } from '../Settings/actions';
import {
  makeAppThemeMode,
  makeAppThemeModeSettings,
  makeMtpMode,
} from '../Settings/selectors';
import { getAppThemeMode } from '../../helpers/theme';
import { getMainWindowRendererProcess } from '../../helpers/windowHelper';
import { log } from '../../utils/log';
import { makeMtpDevice, makeMtpStoragesList } from '../HomePage/selectors';
import { analyticsService } from '../../services/analytics';

class App extends Component {
  constructor(props) {
    super(props);

    this.mainWindowRendererProcess = getMainWindowRendererProcess();

    this.allowWritingJsonToSettings = false;
    this.state = { preferencesReady: false };
  }

  componentDidMount() {
    try {
      // Restore preferences before the fresh-install action persists Redux state.
      // Otherwise the second launch replaces custom settings with defaults.
      this.writeJsonToSettings();
      this.setFreshInstall();

      this.runAnalytics().catch((error) =>
        log.error(error, 'App -> analytics'),
      );

      ipcRenderer.on('nativeThemeUpdated', this.nativeThemeUpdatedEvent);

      bootLoader.cleanRotationFiles();
    } catch (e) {
      log.error(e, `App -> componentDidMount`);
    }
    // Child panes must not initialize until persisted preferences are restored.
    this.setState({ preferencesReady: true });
  }

  componentWillUnmount() {
    ipcRenderer.removeListener(
      'nativeThemeUpdated',
      this.nativeThemeUpdatedEvent,
    );
  }

  nativeThemeUpdatedEvent = () => {
    // force update the component
    this.setState({});
  };

  getMuiTheme = () => {
    const { appThemeModeSettings } = this.props;
    const appThemeMode = getAppThemeMode(appThemeModeSettings);

    if (this.muiTheme?.palette.mode !== appThemeMode) {
      this.muiTheme = createTheme(materialUiTheme({ appThemeMode }));
    }

    return this.muiTheme;
  };

  setFreshInstall() {
    try {
      const { actionCreateFreshInstall } = this.props;
      const setting = settingsStorage.getItems(['freshInstall']);
      let isFreshInstall = 0;

      switch (setting.freshInstall) {
        case undefined:
        case null:
          // app was just installed
          isFreshInstall = 1;
          break;
        case 1:
          // second boot after installation
          isFreshInstall = 0;
          break;
        case -1:
          // isFreshInstall was reset
          isFreshInstall = 1;
          break;
        case 0:
        default:
          // more than 2 boot ups have occured
          isFreshInstall = 0;
          this.allowWritingJsonToSettings = true;

          return null;
      }

      actionCreateFreshInstall({ isFreshInstall });
    } catch (e) {
      log.error(e, `App -> setFreshInstall`);
    }
  }

  writeJsonToSettings() {
    try {
      const { actionCreateCopyJsonFileToSettings } = this.props;
      const settingsFromStorage = settingsStorage.getAll();

      actionCreateCopyJsonFileToSettings({ ...settingsFromStorage });
    } catch (e) {
      log.error(e, `App -> writeJsonToSettings`);
    }
  }

  async runAnalytics() {
    await analyticsService.init();
  }

  render() {
    if (!this.state.preferencesReady) return null;
    const { classes: styles, mtpDevice, mtpStoragesList, mtpMode } = this.props;
    const muiTheme = this.getMuiTheme();

    return (
      <div className={styles.root}>
        <ThemeProvider theme={muiTheme}>
          <CssBaseline />
          <Titlebar
            mtpDevice={mtpDevice}
            mtpStoragesList={mtpStoragesList}
            mtpMode={mtpMode}
          />
          <Alerts />
          <ErrorBoundary>
            <SettingsDialog />
            <Routes />
          </ErrorBoundary>
        </ThemeProvider>
      </div>
    );
  }
}

const mapDispatchToProps = (dispatch) =>
  bindActionCreators(
    {
      actionCreateCopyJsonFileToSettings:
        ({ ...data }) =>
        (_, __) => {
          dispatch(copyJsonFileToSettings({ ...data }));
        },

      actionCreateFreshInstall:
        ({ ...data }) =>
        (_, getState) => {
          dispatch(freshInstall({ ...data }, getState));
        },
    },
    dispatch,
  );

const mapStateToProps = (state) => {
  return {
    appThemeModeSettings: makeAppThemeModeSettings(state),
    appThemeMode: makeAppThemeMode(state),
    mtpDevice: makeMtpDevice(state),
    mtpMode: makeMtpMode(state),
    mtpStoragesList: makeMtpStoragesList(state),
  };
};

export default connect(
  mapStateToProps,
  mapDispatchToProps,
)(withStyles(App, styles));
