import React, { PureComponent } from 'react';
import classNames from 'classnames';
import { withStyles } from '@material-ui/core/styles';
import Button from '@material-ui/core/Button';
import Dialog from '@material-ui/core/Dialog';
import DialogActions from '@material-ui/core/DialogActions';
import DialogContent from '@material-ui/core/DialogContent';
import DialogContentText from '@material-ui/core/DialogContentText';
import DialogTitle from '@material-ui/core/DialogTitle';
import { styles } from '../styles/PasteConflict';

class PasteConflict extends PureComponent {
  _handleBtnClick = (action) => {
    const { onClickHandler } = this.props;

    onClickHandler(action);
  };

  render() {
    const {
      classes: styles,
      titleText = 'Folder Already Exists',
      bodyText = 'The destination already contains items with the same name. What would you like to do?',
      trigger,
    } = this.props;

    return (
      <Dialog
        open={trigger}
        fullWidth
        maxWidth="xs"
        aria-labelledby="paste-conflict-dialogbox"
        disableEscapeKeyDown={false}
        onEscapeKeyDown={() => this._handleBtnClick('cancel')}
      >
        <DialogTitle>{titleText}</DialogTitle>
        <DialogContent>
          <DialogContentText>{bodyText}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => this._handleBtnClick('cancel')}
            color="secondary"
            className={classNames(styles.btnNegative)}
          >
            Cancel
          </Button>
          <Button
            onClick={() => this._handleBtnClick('smartSync')}
            color="primary"
            className={classNames(styles.btnNeutral)}
          >
            Smart Sync
          </Button>
          <Button
            onClick={() => this._handleBtnClick('replace')}
            color="primary"
            className={classNames(styles.btnPositive)}
          >
            Replace All
          </Button>
        </DialogActions>
      </Dialog>
    );
  }
}

export default withStyles(styles)(PasteConflict);
