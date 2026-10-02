import React from 'react';
import { withStyles } from 'tss-react/mui';
import CircularProgress from '@mui/material/CircularProgress';
import { styles } from './styles';

function LoadingIndicator(props) {
  const { classes: styles } = props;

  return (
    <div>
      <CircularProgress
        color="secondary"
        className={styles.progress}
        size={50}
      />
    </div>
  );
}

export default withStyles(LoadingIndicator, styles);
