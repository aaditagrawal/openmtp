import React, { PureComponent, Fragment } from 'react';
import FileExplorerTableRowsRender from './FileExplorerTableBodyListRender';
import { withStyles } from 'tss-react/mui';
import { directoryWindowStyles } from '../styles/DirectoryWindow';
import DirectoryWindow from './DirectoryWindow';

class FileExplorerTableBodyListWrapperRender extends PureComponent {
  render() {
    const { classes, isSelected, tableSort, ...parentProps } = this.props;

    return (
      <DirectoryWindow items={tableSort} rowHeight={54} measureRow>
        {({ items, before, after, anchorRef }) => (
          <Fragment>
            <tr ref={anchorRef} aria-hidden="true">
              <td
                colSpan={6}
                className={classes.windowSpacer}
                style={{ '--directory-spacer-height': `${before}px` }}
              />
            </tr>
            {items.map((item) => (
              <FileExplorerTableRowsRender
                {...parentProps}
                key={item.path}
                item={item}
                isSelected={isSelected(item.path)}
              />
            ))}
            <tr aria-hidden="true">
              <td
                colSpan={6}
                className={classes.windowSpacer}
                style={{ '--directory-spacer-height': `${after}px` }}
              />
            </tr>
          </Fragment>
        )}
      </DirectoryWindow>
    );
  }
}

export default withStyles(
  FileExplorerTableBodyListWrapperRender,
  directoryWindowStyles,
);
