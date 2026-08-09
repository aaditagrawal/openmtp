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
import { variables } from '../../../styles/js';

const { dialogDuration } = variables().transitions;

class PasteConflict extends PureComponent {
  _handleBtnClick = (action) => {
    const { onClickHandler } = this.props;

    onClickHandler(action);
  };

  render() {
    const {
      classes: styles,
      conflictCount = 0,
      titleText = 'Items already exist',
      bodyText,
      trigger,
    } = this.props;

    const resolvedBodyText =
      bodyText ||
      (conflictCount > 0
        ? `${conflictCount} selected ${
            conflictCount === 1 ? 'item already exists' : 'items already exist'
          } at the destination. Skip them, replace everything, or use Smart Sync to copy only new/changed files.`
        : 'Some selected items already exist at the destination. Skip them, replace everything, or use Smart Sync to copy only new/changed files.');

    return (
      <Dialog
        open={trigger}
        fullWidth
        maxWidth="sm"
        aria-labelledby="paste-conflict-dialogbox"
        disableEscapeKeyDown={false}
        transitionDuration={dialogDuration}
        onEscapeKeyDown={() => this._handleBtnClick('cancel')}
      >
        <DialogTitle>{titleText}</DialogTitle>
        <DialogContent>
          <DialogContentText>{resolvedBodyText}</DialogContentText>
        </DialogContent>
        <DialogActions className={styles.actions}>
          <Button
            onClick={() => this._handleBtnClick('cancel')}
            color="secondary"
            className={classNames(styles.btnNegative)}
          >
            Cancel
          </Button>
          <Button
            onClick={() => this._handleBtnClick('skip')}
            color="primary"
            className={classNames(styles.btnNeutral)}
          >
            Skip existing
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
            autoFocus
          >
            Replace All
          </Button>
        </DialogActions>
      </Dialog>
    );
  }
}

export default withStyles(styles)(PasteConflict);
