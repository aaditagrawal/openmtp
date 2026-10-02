import React, { PureComponent } from 'react';
import { withStyles } from 'tss-react/mui';
import TableCell from '@mui/material/TableCell';
import TableRow from '@mui/material/TableRow';
import FileExplorerTableGridRender from './FileExplorerTableBodyGridRender';
import { directoryWindowStyles } from '../styles/DirectoryWindow';
import DirectoryWindow from './DirectoryWindow';
import { styles } from '../styles/FileExplorerTableBodyGridWrapperRender';

class FileExplorerTableBodyGridWrapperRender extends PureComponent {
  render() {
    const {
      classes: styles,
      isSelected,
      tableSort,
      ...parentProps
    } = this.props;

    return (
      <TableRow>
        <TableCell colSpan={6} className={styles.gridTableCell}>
          <DirectoryWindow items={tableSort} rowHeight={137} tileWidth={100}>
            {({ items, before, after, anchorRef }) => (
              <div ref={anchorRef} className={styles.wrapper}>
                <div
                  aria-hidden="true"
                  className={styles.windowSpacer}
                  style={{ '--directory-spacer-height': `${before}px` }}
                />
                {items.map((item) => (
                  <FileExplorerTableGridRender
                    {...parentProps}
                    key={item.path}
                    item={item}
                    isSelected={isSelected(item.path)}
                  />
                ))}
                <div
                  aria-hidden="true"
                  className={styles.windowSpacer}
                  style={{ '--directory-spacer-height': `${after}px` }}
                />
              </div>
            )}
          </DirectoryWindow>
        </TableCell>
      </TableRow>
    );
  }
}

export default withStyles(FileExplorerTableBodyGridWrapperRender, (theme) => ({
  ...styles(theme),
  ...directoryWindowStyles,
}));
