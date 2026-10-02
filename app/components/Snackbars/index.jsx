import React, { PureComponent } from 'react';
import Snackbar from '@mui/material/Snackbar';
import { withStyles } from 'tss-react/mui';
import SnackbarThemeWrapper from './components/SnackbarThemeWrapper';
import { styles } from './styles';

class Snackbars extends PureComponent {
  constructor(props) {
    super(props);
    this.snackbarOpen = true;
  }

  _handleClose = (event, reason) => {
    const { OnSnackBarsCloseAlerts } = this.props;

    if (reason === 'clickaway') {
      return;
    }

    this.snackbarOpen = false;
    OnSnackBarsCloseAlerts();
  };

  render() {
    const { classes: styles, message, variant, autoHideDuration } = this.props;

    return (
      <Snackbar
        className={styles.root}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        open={this.snackbarOpen}
        autoHideDuration={autoHideDuration}
        onClose={this._handleClose}
      >
        <SnackbarThemeWrapper
          onClose={this._handleClose}
          variant={variant}
          message={message}
        />
      </Snackbar>
    );
  }
}

export default withStyles(Snackbars, styles);
