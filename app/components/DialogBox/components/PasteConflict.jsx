import React, { PureComponent } from 'react';
import classNames from 'classnames';
import { withStyles } from 'tss-react/mui';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
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

        transitionDuration={dialogDuration}
        onClose={(_, reason) => {
          if (reason === 'escapeKeyDown') this._handleBtnClick('cancel');
        }}
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

export default withStyles(PasteConflict, styles);
