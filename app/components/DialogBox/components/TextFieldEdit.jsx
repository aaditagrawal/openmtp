import React, { PureComponent } from 'react';
import classNames from 'classnames';
import TextField from '@mui/material/TextField';
import { withStyles } from 'tss-react/mui';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { styles } from '../styles/TextFieldEdit';

class TextFieldEdit extends PureComponent {
  constructor(props) {
    super(props);

    this.textFieldValue = null;
  }

  _handleBtnClick = ({ confirm = false }, event) => {
    const { onClickHandler } = this.props;

    event.preventDefault();

    onClickHandler({ confirm, textFieldValue: this.textFieldValue });
  };

  _handleChange = (event) => {
    this.textFieldValue = event.target.value;
  };

  render() {
    const {
      classes: styles,
      bodyText,
      secondaryText,
      trigger,
      titleText,
      defaultValue,
      label,
      multiline,
      fullWidthDialog,
      maxWidthDialog,
      fullWidthTextField,
      autoFocus,
      required,
      id,
      btnPositiveText,
      btnNegativeText,
      errors,
    } = this.props;

    return (
      <Dialog
        className={styles.root}
        open={trigger}
        fullWidth={fullWidthDialog}
        maxWidth={maxWidthDialog}

        onClose={(event, reason) => {
          if (reason === 'escapeKeyDown')
            this._handleBtnClick({ confirm: false }, event);
        }}
      >
        <DialogTitle>{titleText}</DialogTitle>
        <form
          onSubmit={(event) => this._handleBtnClick({ confirm: true }, event)}
          noValidate
          autoComplete="off"
        >
          <DialogContent>
            <DialogContentText className={styles.dialogContentText}>
              <span className={styles.bodyText}>{bodyText}</span>
              <Typography variant="caption">
                {typeof secondaryText !== 'undefined' &&
                secondaryText !== null ? (
                  <span className={styles.secondaryText}>{secondaryText}</span>
                ) : (
                  ''
                )}
              </Typography>
            </DialogContentText>
            <TextField
              id={id}
              required={required}
              label={errors.toggle ? errors.message : label}
              fullWidth={fullWidthTextField}
              autoFocus={autoFocus}
              autoComplete="off"
              defaultValue={defaultValue}
              multiline={multiline}
              onFocus={(event) => this._handleChange(event)}
              onBlur={(event) => this._handleChange(event)}
              onChange={(event) => this._handleChange(event)}
              error={errors.toggle}
              className={styles.textFieldRoot}
              color="secondary"
            />
          </DialogContent>
          <DialogActions>
            <Button
              onClick={(event) =>
                this._handleBtnClick({ confirm: false }, event)
              }
              color="secondary"
              className={classNames(styles.btnNegative)}
            >
              {btnNegativeText}
            </Button>
            <Button
              onClick={(event) =>
                this._handleBtnClick({ confirm: true }, event)
              }
              color="primary"
              className={classNames(styles.btnPositive)}
            >
              {btnPositiveText}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    );
  }
}

export default withStyles(TextFieldEdit, styles);
