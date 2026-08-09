import React from 'react';
import classNames from 'classnames';
import { CheckCircle, XCircle, Info, AlertTriangle } from 'lucide-react';
import Button from '@material-ui/core/Button';
import SnackbarContent from '@material-ui/core/SnackbarContent';
import { withStyles } from '@material-ui/core/styles';
import Icon from '../../Icon';
import { styles } from '../styles/SnackbarThemeWrapper';

const variantIcon = {
  success: CheckCircle,
  warning: AlertTriangle,
  error: XCircle,
  info: Info,
};

function SnackbarThemeWrapper(props) {
  const { classes: styles, message, onClose, variant, ...other } = props;
  const VariantIcon = variantIcon[variant];

  return (
    <SnackbarContent
      onClick={onClose}
      className={classNames(styles[variant], styles.root)}
      aria-describedby="client-snackbar"
      message={
        <span id="client-snackbar" className={styles.message}>
          <Icon
            icon={VariantIcon}
            size={20}
            className={classNames(styles.icon, styles.iconVariant)}
          />
          {message}
        </span>
      }
      action={[
        <Button
          key={1}
          onClick={onClose}
          color="primary"
          className={styles.closeBtn}
        >
          Close
        </Button>,
      ]}
      {...other}
    />
  );
}

export default withStyles(styles)(SnackbarThemeWrapper);
