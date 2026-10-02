import React, { PureComponent } from 'react';
import classNames from 'classnames';
import { withStyles } from 'tss-react/mui';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import { styles } from '../styles/ExtrasConflict';

class ExtrasConflict extends PureComponent {
  constructor(props) {
    super(props);

    this.state = {
      currentIndex: 0,
      filesToDelete: [],
    };
  }

  componentDidUpdate(prevProps) {
    const { trigger } = this.props;

    if (trigger && !prevProps.trigger) {
      this.setState({ currentIndex: 0, filesToDelete: [] });
    }
  }

  _advance = (deleteFile) => {
    const { extras, onComplete } = this.props;
    const { currentIndex, filesToDelete } = this.state;

    const newFilesToDelete = deleteFile
      ? [...filesToDelete, extras[currentIndex].path]
      : filesToDelete;

    if (currentIndex >= extras.length - 1) {
      onComplete({ filesToDelete: newFilesToDelete });

      return;
    }

    this.setState({
      currentIndex: currentIndex + 1,
      filesToDelete: newFilesToDelete,
    });
  };

  _handleKeep = () => {
    this._advance(false);
  };

  _handleDelete = () => {
    this._advance(true);
  };

  _handleKeepAll = () => {
    const { onComplete } = this.props;
    const { filesToDelete } = this.state;

    onComplete({ filesToDelete });
  };

  _handleDeleteAll = () => {
    const { extras, onComplete } = this.props;
    const { currentIndex, filesToDelete } = this.state;

    const remaining = extras.slice(currentIndex).map((f) => f.path);

    onComplete({ filesToDelete: [...filesToDelete, ...remaining] });
  };

  render() {
    const { classes: styles, trigger, extras } = this.props;
    const { currentIndex } = this.state;

    if (!extras || extras.length === 0) {
      return null;
    }

    const currentFile = extras[currentIndex];

    if (!currentFile) {
      return null;
    }

    return (
      <Dialog
        open={trigger}
        fullWidth
        maxWidth="sm"
        aria-labelledby="extras-conflict-dialogbox"
      >
        <DialogTitle>Extra File in Destination</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This file exists in the destination but not in the source. What
            would you like to do with it?
          </DialogContentText>
          <Typography className={classNames(styles.fileName)}>
            {currentFile.name}
          </Typography>
          <Typography className={classNames(styles.fileInfo)}>
            Path: {currentFile.path}
          </Typography>
          {currentFile.size !== undefined && (
            <Typography className={classNames(styles.fileInfo)}>
              Size: {currentFile.size} bytes
            </Typography>
          )}
          <Typography className={classNames(styles.counter)}>
            File {currentIndex + 1} of {extras.length}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={this._handleDeleteAll}
            color="secondary"
            className={classNames(styles.btnNegative)}
          >
            Delete All Extras
          </Button>
          <Button
            onClick={this._handleDelete}
            color="secondary"
            className={classNames(styles.btnNegative)}
          >
            Delete
          </Button>
          <Button
            onClick={this._handleKeepAll}
            color="primary"
            className={classNames(styles.btnPositive)}
          >
            Keep All Extras
          </Button>
          <Button
            onClick={this._handleKeep}
            color="primary"
            className={classNames(styles.btnPositive)}
          >
            Keep
          </Button>
        </DialogActions>
      </Dialog>
    );
  }
}

export default withStyles(ExtrasConflict, styles);
