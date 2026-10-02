import { ipcRenderer } from 'electron';
import React, { Component } from 'react';
import { withStyles } from 'tss-react/mui';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import { styles } from './styles';

class ProgressbarPage extends Component {
  constructor(props) {
    super(props);

    this.initialState = {
      progressTitle: `Progress...`,
      progressBodyText: `Progress...`,
      value: 0,
      variant: `indeterminate`,
    };

    this.state = {
      ...this.initialState,
    };
  }

  handleProgress = (_event, args) => {
    this.setState({ ...args });
  };

  componentDidMount() {
    ipcRenderer.on('appUpdatesProgressBarCommunication', this.handleProgress);
  }

  componentWillUnmount() {
    ipcRenderer.removeListener(
      'appUpdatesProgressBarCommunication',
      this.handleProgress,
    );
  }

  render() {
    const { classes: styles } = this.props;
    const { progressTitle, progressBodyText, value, variant } = this.state;

    return (
      <div className={styles.root}>
        <Typography variant="body1" className={styles.progressTitle}>
          {progressTitle}
        </Typography>
        <Typography variant="body1" className={styles.progressBodyText}>
          {progressBodyText}
        </Typography>
        <LinearProgress color="secondary" variant={variant} value={value} />
      </div>
    );
  }
}

export default withStyles(ProgressbarPage, styles);
