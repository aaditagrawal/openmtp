import React, { PureComponent } from 'react';
import { withStyles } from 'tss-react/mui';
import { styles } from '../styles/KeyboadShortcuts';
import KbdRender from './KbdRender';

class KeyboadShortcuts extends PureComponent {
  render() {
    const { classes: styles } = this.props;

    return (
      <div className={styles.root}>
        <KbdRender styles={styles} />
      </div>
    );
  }
}

export default withStyles(KeyboadShortcuts, styles);
