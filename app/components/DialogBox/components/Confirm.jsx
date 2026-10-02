import React, { PureComponent } from 'react';
import classNames from 'classnames';
import { withStyles } from 'tss-react/mui';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { styles } from '../styles/Confirm';

class Confirm extends PureComponent {
  _handleBtnClick = ({ confirm = false }) => {
    const { onClickHandler } = this.props;

    onClickHandler(confirm);
  };

  _handleKeyPress = (event) => {
    if (event.key === 'Enter') {
      this._handleBtnClick({ confirm: true });
    }
  };

  render() {
    const {
      classes: styles,
      titleText = `Confirm Action`,
      bodyText,
      trigger,
      fullWidthDialog,
      maxWidthDialog,
    } = this.props;

    return (
      <Dialog
        onKeyPress={this._handleKeyPress}
        open={trigger}
        fullWidth={fullWidthDialog}
        maxWidth={maxWidthDialog}
        aria-labelledby="confirm-dialogbox"

        onClose={(_, reason) => {
          if (reason === 'escapeKeyDown')
            this._handleBtnClick({ confirm: false });
        }}
      >
        <DialogTitle>{titleText}</DialogTitle>
        <DialogContent>
          <DialogContentText>{bodyText}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => this._handleBtnClick({ confirm: false })}
            color="secondary"
            className={classNames(styles.btnNegative)}
          >
            No
          </Button>
          <Button
            onClick={() => this._handleBtnClick({ confirm: true })}
            color="primary"
            className={classNames(styles.btnPositive)}
          >
            Yes
          </Button>
        </DialogActions>
      </Dialog>
    );
  }
}

export default withStyles(Confirm, styles);
