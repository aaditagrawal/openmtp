import React, { PureComponent } from 'react';
import { withStyles } from 'tss-react/mui';
import TableFooter from '@mui/material/TableFooter';
import { styles } from '../styles/FileExplorerTableFooterRender';
import Breadcrumb from '../../../components/Breadcrumb';
import FileExplorerTableFooterStatusBarRender from './FileExplorerTableFooterStatusBarRender';

class FileExplorerTableFooterRender extends PureComponent {
  render() {
    const {
      classes: styles,
      currentBrowsePath,
      deviceType,
      onBreadcrumbPathClick,
      isStatusBarEnabled,
      directoryLists,
      fileTransferClipboard,
      mtpDevice,
    } = this.props;

    return (
      <TableFooter component="div" className={styles.tableFooter}>
        {isStatusBarEnabled && (
          <FileExplorerTableFooterStatusBarRender
            directoryLists={directoryLists}
            fileTransferClipboard={fileTransferClipboard}
            deviceType={deviceType}
            mtpDevice={mtpDevice}
          />
        )}
        <Breadcrumb
          onBreadcrumbPathClick={onBreadcrumbPathClick}
          currentBrowsePath={currentBrowsePath[deviceType]}
          deviceType={deviceType}
        />
      </TableFooter>
    );
  }
}

export default withStyles(FileExplorerTableFooterRender, styles);
