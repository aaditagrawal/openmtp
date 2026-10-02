import { variables, mixins } from '../../../styles/js';
import { commonThemes } from '../../../styles/js/mixins';

// Styles for App/index.jsx component
export const styles = (theme) => {
  return {
    root: {},
    noProfileError: {
      textAlign: `center`,
      ...mixins({ theme }).center,
      ...mixins({ theme }).absoluteCenter,
    },
  };
};

export const getColorPalette = () => {
  const lightPrimaryColor = '#fff';
  const lightSecondaryColor = '#007af5';

  const darkPrimaryColor = '#242424';
  const darkSecondaryColor = '#007af5';

  const snackbarError = `#f33950`;

  return {
    get light() {
      return {
        primary: {
          main: lightPrimaryColor,
          contrastText: '#000',
        },
        secondary: {
          main: lightSecondaryColor,
          contrastText: '#fff',
        },
        background: {
          default: darkPrimaryColor,
          paper: lightPrimaryColor,
        },
        snackbar: {
          error: snackbarError,
        },
        btnTextColor: '#fff',
        fileColor: '#000',
        tableHeaderFooterBgColor: `#fbfbfb`,
        lightText1Color: `rgba(0, 0, 0, 0.50)`,
        fileExplorerThinLineDividerColor: `rgba(0, 0, 0, 0.12)`,
        fileDrop: `rgba(0, 122, 245, 0.08)`,
        disabledBgColor: `#f3f3f3`,
        nativeSystemColor: `#ececec`,
        contrastPrimaryMainColor: darkPrimaryColor,
      };
    },
    get dark() {
      return {
        primary: {
          main: darkPrimaryColor,
          contrastText: '#fff',
        },
        secondary: {
          main: darkSecondaryColor,
          contrastText: '#fff',
        },
        background: {
          default: darkPrimaryColor,
          paper: darkPrimaryColor,
        },
        text: {
          primary: '#fff',
          secondary: 'rgba(255, 255, 255, 0.65)',
          disabled: 'rgba(255, 255, 255, 0.4)',
        },
        snackbar: {
          error: snackbarError,
        },
        action: {
          active: 'rgba(255, 255, 255, 0.65)',
          hover: 'rgba(255, 255, 255, 0.2)',
          selected: 'rgba(255, 255, 255, 0.16)',
          disabled: 'rgba(255, 255, 255, 0.3)',
          disabledBackground: 'rgba(255, 255, 255, 0.12)',
        },
        divider: `rgba(255, 255, 255, 0.12)`,
        btnTextColor: '#fff',
        fileColor: '#d5d5d5',
        tableHeaderFooterBgColor: `#313131`,
        lightText1Color: `rgba(255, 255, 255, 0.50)`,
        fileExplorerThinLineDividerColor: `rgba(255, 255, 255, .12)`,
        fileDrop: `rgba(0, 122, 245, 0.08)`,
        disabledBgColor: `rgba(255, 255, 255, 0.15)`,
        nativeSystemColor: `#323232`,
        contrastPrimaryMainColor: lightPrimaryColor,
      };
    },
  };
};

export const getCurrentThemePalette = (appThemeMode) => {
  return getColorPalette()[appThemeMode];
};

const fontFamily = {
  default: [
    'DM Mono',
    'ui-monospace',
    'SFMono-Regular',
    'Menlo',
    'Monaco',
    'Consolas',
    'monospace',
  ].join(','),
  letterSpacing: '-0.01em',
};

// Fast, GPU-friendly feedback for hover/selection/press states across
// buttons, list items, toolbar icons and table rows. Only background-color,
// color and box-shadow are transitioned — never layout properties — so the
// animation stays cheap on large file lists.
const { fastDuration, dialogDuration, fastEasing } = variables().transitions;
const interactionTransition = [
  'background-color',
  'color',
  'box-shadow',
  'border-color',
]
  .map((property) => `${property} ${fastDuration}ms ${fastEasing}`)
  .join(', ');

export const materialUiTheme = ({ ...args }) => {
  const { appThemeMode } = args;

  const palette = getCurrentThemePalette(appThemeMode);

  return {
    palette: {
      mode: appThemeMode,
      ...palette,
    },
    typography: {
      fontSize: variables().sizes.regularFontSize,
      fontFamily: fontFamily.default,
    },
    // Keep modal enter/exit near ~150ms so dialogs feel snappy without the
    // default MUI 225/195ms lag. Hover feedback stays on fastDuration.
    transitions: {
      duration: {
        shortest: 100,
        shorter: fastDuration,
        short: dialogDuration,
        standard: dialogDuration,
        complex: 200,
        enteringScreen: dialogDuration,
        leavingScreen: 120,
      },
      easing: {
        easeInOut: fastEasing,
        easeOut: fastEasing,
        sharp: fastEasing,
      },
    },
    components: {
      // Retain the fork's flat dark surfaces. Modern MUI otherwise applies a
      // white elevation overlay to dialogs and other elevated Paper elements.
      MuiPaper: {
        styleOverrides: { root: { backgroundImage: 'none' } },
      },
      MuiDialog: { defaultProps: { transitionDuration: dialogDuration } },
      MuiTextField: { defaultProps: { variant: 'standard' } },
      MuiCheckbox: { defaultProps: { color: 'secondary' } },
      MuiRadio: { defaultProps: { color: 'secondary' } },
      MuiSwitch: { defaultProps: { color: 'secondary' } },
      MuiCssBaseline: {
        styleOverrides: {
          html: {
            '--app-bg-color': palette.background.paper,
            '--app-secondary-main-color': palette.secondary.main,
            '--app-native-system-color': palette.nativeSystemColor,
            fontFamily: fontFamily.default,
            letterSpacing: fontFamily.letterSpacing,
            fontVariantNumeric: 'tabular-nums',
            WebkitFontSmoothing: 'antialiased',
            ...commonThemes.noselect,
          },
          body: {
            fontFamily: fontFamily.default,
            letterSpacing: fontFamily.letterSpacing,
            fontVariantNumeric: 'tabular-nums',
            WebkitFontSmoothing: 'antialiased',
          },
          'button, input, textarea': {
            fontFamily: fontFamily.default,
            letterSpacing: fontFamily.letterSpacing,
          },
          // Respect the OS-level "reduce motion" preference by collapsing
          // every transition/animation to effectively nothing. `!important`
          // is required since some MUI transitions (Dialog, Collapse, Fade)
          // set their duration via inline styles.
          '@media (prefers-reduced-motion: reduce)': {
            '*, *::before, *::after': {
              animationDuration: '0.01ms !important',
              animationIterationCount: '1 !important',
              transitionDuration: '0.01ms !important',
              scrollBehavior: 'auto !important',
            },
          },
        },
      },
      // Snappy, GPU-friendly hover/press feedback for buttons, list items
      // and table rows — background-color/color/box-shadow/border-color
      // only, so nothing here ever triggers layout.
      MuiButtonBase: {
        styleOverrides: {
          root: {
            transition: interactionTransition,
          },
        },
      },
      MuiIconButton: {
        defaultProps: { size: 'large' },
        styleOverrides: {
          root: {
            transition: interactionTransition,
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            transition: interactionTransition,
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            transition: interactionTransition,
          },
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: {
            transition: `background-color ${fastDuration}ms ${fastEasing}`,
          },
        },
      },
    },
  };
};
