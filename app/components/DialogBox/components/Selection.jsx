import React, { PureComponent, Fragment } from 'react';
import classnames from 'classnames';
import Tooltip from '@mui/material/Tooltip';
import { withStyles } from 'tss-react/mui';
import List from '@mui/material/List';
import Avatar from '@mui/material/Avatar';
import ListItemAvatar from '@mui/material/ListItemAvatar';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import DialogTitle from '@mui/material/DialogTitle';
import Dialog from '@mui/material/Dialog';
import Icon from '../../Icon';
import { styles } from '../styles/Selection';
import { isEmpty } from '../../../utils/funcs';

class Selection extends PureComponent {
  _handleListItemClick = ({ ...args }) => {
    const { onClose } = this.props;

    onClose({ ...args });
  };

  render() {
    const { list, titleText, open, showAvatar, classes: styles } = this.props;

    if (isEmpty(list)) {
      return <Fragment />;
    }

    return (
      <Dialog
        onClose={() =>
          this._handleListItemClick({
            selectedValue: null,
            triggerChange: false,
          })
        }
        open={open}
      >
        <DialogTitle>{titleText}</DialogTitle>
        <div>
          <List>
            {list.map((item) => {
              return (
                <Fragment key={item.value}>
                  <ListItemButton
                    onClick={() => {
                      this._handleListItemClick({
                        selectedValue: item.value,
                        triggerChange: true,
                      });
                    }}
                  >
                    {showAvatar && (
                      <ListItemAvatar>
                        <Avatar
                          className={classnames({
                            [styles.selectedAvatar]: item.selected,
                          })}
                        >
                          <Icon
                            icon={item.icon}
                            title={item.name}
                            className={classnames({
                              [styles.selectedIcon]: item.selected,
                            })}
                          />
                        </Avatar>
                      </ListItemAvatar>
                    )}

                    <Tooltip title={item.hint ?? ''}>
                      <ListItemText primary={item.name} />
                    </Tooltip>
                  </ListItemButton>
                </Fragment>
              );
            })}
          </List>
        </div>
      </Dialog>
    );
  }
}

export default withStyles(Selection, styles);
