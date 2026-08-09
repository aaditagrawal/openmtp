// common styling variable object which can be imported by components
export default (_) => {
  return {
    sizes: {
      toolbarHeight: 56,
      sidebarAreaPaneWidth: 300,
      sidebarAreaPaddingTop: 40,
      regularFontSize: 14,
    },
    // Shared easing for interactive hover/selection feedback (buttons, list
    // items, toolbar icons, table rows). Kept short so the UI feels snappy
    // without being distracting. Dialog open/close uses the slightly longer
    // dialogDuration so the entrance still reads as intentional.
    transitions: {
      fastDuration: 140,
      dialogDuration: 150,
      fastEasing: 'cubic-bezier(0.2, 0, 0, 1)',
    },
    //   styles: {
    //     bgColor: APP_THEME_COLOR_VAR.bgColor,
    //     primaryColor: {
    //       main: APP_THEME_COLOR_VAR.primaryMainColor,
    //     },
    //     secondaryColor: {
    //       main: APP_THEME_COLOR_VAR.secondaryMainColor,
    //     },
    //     background: {
    //       paper: APP_THEME_COLOR_VAR.paperBgColor,
    //     },
    //     icons: {
    //       navbarRegular: APP_THEME_COLOR_VAR.contrastPrimaryMainColor,
    //       disabled: APP_THEME_COLOR_VAR.disabledBgColor,
    //     },
    //     nativeSystemColor: APP_THEME_COLOR_VAR.nativeSystemColor,
    //     tableHeaderFooterBgColor: APP_THEME_COLOR_VAR.tableHeaderFooterBgColor,
    //     fileExplorerThinLineDividerColor:
    //       APP_THEME_COLOR_VAR.fileExplorerThinLineDividerColor,
    //     lightText1Color: APP_THEME_COLOR_VAR.lightText1Color,
    //   },
  };
};
