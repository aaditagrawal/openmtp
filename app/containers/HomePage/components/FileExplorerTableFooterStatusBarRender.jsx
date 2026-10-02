import React, { PureComponent, Fragment } from 'react';
import { Smartphone, Laptop } from 'lucide-react';
import { withStyles } from 'tss-react/mui';
import Typography from '@mui/material/Typography';
import Icon from '../../../components/Icon';
import { styles } from '../styles/FileExplorerTableFooterStatusBarRender';
import { getPluralText } from '../../../utils/funcs';
import { DEVICE_TYPE } from '../../../enums';
import { DEVICES_LABEL } from '../../../constants';

class FileExplorerTableFooterStatusBarRender extends PureComponent {
  getDirectoryListStats = () => {
    const { directoryLists } = this.props;

    let directories = 0;
    let files = 0;

    (directoryLists.nodes || []).map((a) => {
      if (a.isFolder) {
        directories += 1;
      } else {
        files += 1;
      }

      return a;
    });

    const total = directories + files;

    return { total, directories, files };
  };

  getSelectedDirectoryStats = () => {
    const { directoryLists } = this.props;

    const total = directoryLists.queue.selected.length;

    return { total };
  };

  RenderDeviceName = () => {
    const { classes: styles, deviceType, mtpDevice } = this.props;

    if (deviceType === DEVICE_TYPE.local) {
      return (
        <Fragment>
          <Icon icon={Laptop} title={deviceType} />
          <span className={styles.deviceTypeWrapper}>
            {DEVICES_LABEL[deviceType]}
            <span> - </span>
          </span>
        </Fragment>
      );
    }

    return (
      <Fragment>
        <Icon icon={Smartphone} title={deviceType} />
        <span className={styles.deviceTypeWrapper}>
          {mtpDevice?.isAvailable && mtpDevice?.info?.mtpDeviceInfo
            ? mtpDevice?.info?.mtpDeviceInfo?.Model
            : DEVICES_LABEL[deviceType]}
          <span> - </span>
        </span>
      </Fragment>
    );
  };

  render() {
    const { classes: styles, fileTransferClipboard } = this.props;

    const { directories, files, total } = this.getDirectoryListStats();
    const { total: selectedTotal } = this.getSelectedDirectoryStats();
    const fileTransferClipboardLength = fileTransferClipboard.queue.length;
    const { RenderDeviceName } = this;

    return (
      <div className={styles.root}>
        <Typography variant="caption" className={styles.bodyWrapper}>
          <RenderDeviceName />

          {selectedTotal > 0 ? (
            <Fragment>{`${selectedTotal} of ${total} selected`}</Fragment>
          ) : (
            <Fragment>{`${total} ${getPluralText(
              'item',
              total,
            )} (${directories} ${getPluralText(
              'directory',
              directories,
              'directories',
            )}, ${files} ${getPluralText('file', files)})`}</Fragment>
          )}
          {`, ${fileTransferClipboardLength} ${getPluralText(
            'item',
            fileTransferClipboardLength,
          )} in clipboard`}
        </Typography>
      </div>
    );
  }
}

export default withStyles(FileExplorerTableFooterStatusBarRender, styles);
