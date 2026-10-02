import React, { PureComponent, Fragment } from 'react';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Button from '@mui/material/Button';
import {
  Copy,
  MousePointerClick,
  Paperclip,
  Send,
  Usb,
  Mail,
} from 'lucide-react';
import Icon from '../../../components/Icon';
import { DEVICES_LABEL } from '../../../constants';
import { DEVICE_TYPE } from '../../../enums';

export default class GenerateErrorReportBody extends PureComponent {
  render() {
    const {
      styles,
      zippedLogFileBaseName,
      mailTo,
      mailToInstructions,
      AUTHOR_EMAIL,
      onGenerateErrorLogs,
    } = this.props;

    return (
      <Fragment>
        <List>
          <ListItem>
            <ListItemIcon>
              <Icon icon={Usb} />
            </ListItemIcon>
            <ListItemText
              primary={`Unlock your ${
                DEVICES_LABEL[DEVICE_TYPE.mtp]
              } and connect it to your ${
                DEVICES_LABEL[DEVICE_TYPE.local]
              } via USB`}
            />
          </ListItem>
          <ListItem>
            <ListItemIcon>
              <Icon icon={Copy} />
            </ListItemIcon>
            <ListItemText primary="Turn on the 'File Transfer' mode" />
          </ListItem>
          <ListItem>
            <ListItemIcon>
              <Icon icon={MousePointerClick} />
            </ListItemIcon>
            <ListItemText
              primary="Click the 'EMAIL ERROR LOGS' button below"
              secondary="This will launch your default email client"
            />
          </ListItem>
          <ListItem>
            <ListItemIcon>
              <Icon icon={Paperclip} />
            </ListItemIcon>
            <ListItemText
              primary="Attach the generated Error Log file along with the email"
              secondary={`Check Desktop Folder for ${zippedLogFileBaseName}`}
            />
          </ListItem>
          <ListItem>
            <ListItemIcon>
              <Icon icon={Send} />
            </ListItemIcon>
            <ListItemText primary="Send the email" />
          </ListItem>
        </List>
        <Button
          variant="outlined"
          color="primary"
          className={styles.generateLogsBtn}
          onClick={onGenerateErrorLogs}
        >
          EMAIL ERROR LOGS
        </Button>
        <List component="div">
          <ListItem>
            <ListItemIcon>
              <Icon icon={Mail} />
            </ListItemIcon>
            <a
              href={`${mailTo} ${mailToInstructions}`}
              className={styles.emailId}
            >
              {AUTHOR_EMAIL}
            </a>
          </ListItem>
        </List>
      </Fragment>
    );
  }
}
