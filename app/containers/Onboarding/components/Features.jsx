import React, { PureComponent } from 'react';
import { withStyles } from 'tss-react/mui';
import Typography from '@mui/material/Typography';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Collapse from '@mui/material/Collapse';
import {
  Usb,
  Copy,
  Moon,
  Zap,
  List as ListIcon,
  HardDrive,
  Move,
  Images,
  Keyboard,
  ChevronUp,
  ChevronDown,
  Maximize2,
  Hourglass,
  AppWindow,
  Cpu,
  Smartphone,
  Camera,
} from 'lucide-react';
import Icon from '../../../components/Icon';
import KeyboadShortcuts from '../../KeyboardShortcutsPage/components/KeyboadShortcuts';
import { styles } from '../styles/Features';
import { capitalize } from '../../../utils/funcs';
import { MTP_MODE } from '../../../enums';

class Features extends PureComponent {
  constructor(props) {
    super(props);

    this.state = {
      expansionPanel: {
        keyboardNavigation: false,
      },
    };
  }

  _handleExpansionPanel = ({ key }) => {
    this.setState((prevState) => {
      return {
        expansionPanel: {
          ...prevState.expansionPanel,
          [key]: !prevState.expansionPanel[key],
        },
      };
    });
  };

  render() {
    const { classes: styles, hideTitle } = this.props;
    const { expansionPanel } = this.state;

    const kalamLabel = capitalize(MTP_MODE.kalam);

    return (
      <div className={styles.root}>
        {hideTitle ? null : (
          <Typography
            variant="body1"
            className={styles.title}
            color="secondary"
          >
            Features
          </Typography>
        )}
        <List>
          <ListItem>
            <ListItemIcon>
              <Icon icon={Usb} />
            </ListItemIcon>
            <ListItemText
              primary="Connect via USB cable"
              secondary="Highest data transfer rates"
            />
          </ListItem>
          <ListItem>
            <ListItemIcon>
              <Icon icon={Copy} />
            </ListItemIcon>
            <ListItemText
              primary="5-6x faster file copy speed"
              secondary={`Settings > 'General' Tab > 'MTP Mode' > Select '${kalamLabel} Mode'`}
            />
          </ListItem>
          <ListItem>
            <ListItemIcon>
              <Icon icon={Moon} />
            </ListItemIcon>
            <ListItemText
              primary="Dark Theme mode"
              secondary="Settings > 'General' Tab > 'Theme'"
            />
          </ListItem>
          <ListItem>
            <ListItemIcon>
              <Icon icon={Move} />
            </ListItemIcon>
            <ListItemText primary="Drag and Drop files from the macOS Finder window" />
          </ListItem>

          <ListItem>
            <ListItemIcon>
              <Icon icon={Images} />
            </ListItemIcon>
            <ListItemText primary="Transfer multiple files which are larger than 4GB in one go." />
          </ListItem>

          <ListItem>
            <ListItemIcon>
              <Icon icon={Cpu} />
            </ListItemIcon>
            <ListItemText primary="Apple Silicon support" />
          </ListItem>

          <ListItem>
            <ListItemIcon>
              <Icon icon={Smartphone} />
            </ListItemIcon>
            <ListItemText primary={`Garmin device support`} />
          </ListItem>

          <ListItem>
            <ListItemIcon>
              <Icon icon={Camera} />
            </ListItemIcon>
            <ListItemText primary={`Fujifilm device support`} />
          </ListItem>

          <ListItem>
            <ListItemIcon>
              <Icon icon={ListIcon} />
            </ListItemIcon>
            <ListItemText
              primary="Choose between Grid and List view"
              secondary="Settings > 'File Manager' Tab"
            />
          </ListItem>

          <ListItem>
            <ListItemIcon>
              <Icon icon={Maximize2} />
            </ListItemIcon>
            <ListItemText
              primary="Single pane mode"
              secondary="Settings > 'File Manager' Tab > 'Show Local Disk pane'"
            />
          </ListItem>

          <ListItem>
            <ListItemIcon>
              <Icon icon={AppWindow} />
            </ListItemIcon>
            <ListItemText
              primary="Tab Layout"
              secondary="Use mouse clicks or keyboard shortcut to navigate through them"
            />
          </ListItem>

          <ListItem>
            <ListItemIcon>
              <Icon icon={HardDrive} />
            </ListItemIcon>
            <ListItemText primary="Choose between Internal Memory and SD Card" />
          </ListItem>

          <ListItem>
            <ListItemIcon>
              <Icon icon={Zap} />
            </ListItemIcon>
            <ListItemText primary="Auto device detection (USB Hotplug)" />
          </ListItem>

          <ListItem>
            <ListItemIcon>
              <Icon icon={Hourglass} />
            </ListItemIcon>
            <ListItemText
              primary="Display Overall Progress on the File Transfer Screen"
              secondary="Settings > File Manager Tab > Enable 'Display overall progress on the file transfer screen'"
            />
          </ListItem>

          <ListItemButton
            onClick={() =>
              this._handleExpansionPanel({
                key: 'keyboardNavigation',
              })
            }
          >
            <ListItemIcon>
              <Icon icon={Keyboard} />
            </ListItemIcon>
            <ListItemText
              primary="Keyboard Navigation"
              secondary={
                !expansionPanel.keyboardNavigation
                  ? 'Click here to view the keyboard shortcuts'
                  : 'Click here to hide the keyboard shortcuts'
              }
            />
            {expansionPanel.keyboardNavigation ? (
              <Icon icon={ChevronUp} />
            ) : (
              <Icon icon={ChevronDown} />
            )}
          </ListItemButton>

          <Collapse
            in={expansionPanel.keyboardNavigation}
            timeout="auto"
            unmountOnExit
          >
            <List component="div" disablePadding>
              <ListItem>
                <div className={styles.nestedPanel}>
                  <KeyboadShortcuts />
                </div>
              </ListItem>
            </List>
          </Collapse>
        </List>
      </div>
    );
  }
}

export default withStyles(Features, styles);
