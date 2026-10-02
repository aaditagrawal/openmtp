import React, { PureComponent } from 'react';
import classNames from 'classnames';
import { withStyles } from 'tss-react/mui';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { styles } from '../styles/Notification';
import { isString } from '../../../utils/funcs';

class Notification extends PureComponent {
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
      titleText = `Message`,
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
        aria-labelledby="notification-dialogbox"

        onClose={(_, reason) => {
          if (reason === 'escapeKeyDown')
            this._handleBtnClick({ confirm: false });
        }}
      >
        <DialogTitle>{titleText}</DialogTitle>
        <DialogContent>
          {isString(bodyText) ? (
            <DialogContentText>{bodyText}</DialogContentText>
          ) : (
            bodyText
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => this._handleBtnClick({ confirm: false })}
            color="primary"
            className={classNames(styles.btnPositive)}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>
    );
  }
}

export default withStyles(Notification, styles);
