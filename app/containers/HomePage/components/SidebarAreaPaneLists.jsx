import React, { PureComponent, Fragment } from 'react';
import { withStyles } from 'tss-react/mui';
import Typography from '@mui/material/Typography';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import { Folder } from 'lucide-react';
import Icon from '../../../components/Icon';
import { styles } from '../styles/SidebarAreaPaneLists';
import { quickHash } from '../../../utils/funcs';
import { analyticsService } from '../../../services/analytics';
import { EVENT_TYPE } from '../../../enums/events';

class SidebarAreaPaneLists extends PureComponent {
  _handleListDirectory({ ...args }) {
    const { onClickHandler, deviceType } = this.props;

    onClickHandler({ ...args });

    const deviceTypeUpperCase = deviceType.toUpperCase();

    analyticsService.sendEvent(
      EVENT_TYPE[`${deviceTypeUpperCase}_SIDEBAR_PATH_TAP`],
      {},
    );
  }

  ListsRender = (listData) => {
    const { classes: styles, deviceType, currentBrowsePath } = this.props;

    return (
      <List component="nav" dense className={styles.listsBottom}>
        {listData.map((item) => {
          return (
            <ListItemButton
              key={quickHash(item.path)}

              selected={currentBrowsePath === item.path}
              disabled={!item.enabled}
              onClick={() =>
                this._handleListDirectory({
                  filePath: item.path,
                  deviceType,
                  isSidemenu: true,
                })
              }
            >
              <ListItemIcon className={styles.listIcon}>
                {item.icon === 'folder' && <Icon icon={Folder} />}
              </ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          );
        })}
      </List>
    );
  };

  render() {
    const { classes: styles, sidebarFavouriteList } = this.props;
    const { top: sidebarTop, bottom: sidebarBottom } = sidebarFavouriteList;

    return (
      <div className={styles.listsWrapper}>
        <Typography variant="caption" className={styles.listsCaption}>
          Favorites
        </Typography>
        {sidebarTop.length > 1 && this.ListsRender(sidebarTop)}

        {sidebarBottom.length > 1 && (
          <Fragment>
            <Divider />
            {this.ListsRender(sidebarBottom)}
          </Fragment>
        )}
      </div>
    );
  }
}

export default withStyles(SidebarAreaPaneLists, styles);
