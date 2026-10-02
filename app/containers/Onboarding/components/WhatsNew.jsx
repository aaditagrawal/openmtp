import React, { PureComponent } from 'react';
import { withStyles } from 'tss-react/mui';
import Typography from '@mui/material/Typography';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import { Wrench, Bug, DownloadCloud } from 'lucide-react';
import Icon from '../../../components/Icon';
import { styles } from '../styles/WhatsNew';
import { APP_NAME, APP_VERSION } from '../../../constants/meta';
import { isKalamModeSupported } from '../../../helpers/binaries';
import { MTP_MODE } from '../../../enums';

class WhatsNew extends PureComponent {
  render() {
    const isKalamModeDisabled = !isKalamModeSupported();
    const { classes: styles, hideTitle } = this.props;

    return (
      <div className={styles.root}>
        {hideTitle ? null : (
          <Typography
            variant="body1"
            className={styles.title}
            color="secondary"
          >
            What&apos;s new in {APP_NAME}-{APP_VERSION}?
          </Typography>
        )}

        <List>
          <ListItem>
            <ListItemIcon>
              <Icon icon={Bug} color="#FF0000" />
            </ListItemIcon>
            <ListItemText primary="Fixes a bug which caused slow data transfer speed" />
          </ListItem>

          {isKalamModeDisabled && (
            <ListItem>
              <ListItemIcon>
                <Icon icon={DownloadCloud} color="#fa4d0a" />
              </ListItemIcon>
              <ListItemText
                primary={`We have now officially retired the support for '${MTP_MODE.kalam}' Kernel on macOS 10.13 (OS X El High Sierra) and lower`}
                secondary={`However the '${MTP_MODE.legacy}' MTP mode will continue working on these outdated machines`}
              />
            </ListItem>
          )}

          <ListItem>
            <ListItemIcon>
              <Icon icon={Wrench} />
            </ListItemIcon>
            <ListItemText primary="Other UI optimization and performance improvements" />
          </ListItem>
        </List>
      </div>
    );
  }
}

export default withStyles(WhatsNew, styles);
