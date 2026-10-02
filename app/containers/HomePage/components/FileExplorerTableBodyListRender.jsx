import React, { PureComponent } from 'react';
import { withStyles } from 'tss-react/mui';
import TableCell from '@mui/material/TableCell';
import TableRow from '@mui/material/TableRow';
import Checkbox from '@mui/material/Checkbox';
import Tooltip from '@mui/material/Tooltip';
import classNames from 'classnames';
import { niceBytes, springTruncate } from '../../../utils/funcs';
import { FILE_EXPLORER_TABLE_TRUNCATE_MAX_CHARS } from '../../../constants';
import { styles } from '../styles/FileExplorerTableBodyListRender';
// eslint-disable-next-line import/no-relative-packages
import prettyFileIcons from '../../../vendors/pretty-file-icons';
import { imgsrc } from '../../../utils/imgsrc';
import { appDateFormat } from '../../../utils/date';

class FileExplorerTableBodyListRender extends PureComponent {
  RenderFileIcon = () => {
    const { classes: styles, item } = this.props;

    const fileIcon = prettyFileIcons.getIcon(item.name, 'svg');

    return (
      <div className={styles.fileTypeIconWrapper}>
        <img
          src={imgsrc(`file-types/${fileIcon}`)}
          alt={item.name}
          className={classNames(styles.fileTypeIcon)}
        />
      </div>
    );
  };

  RenderFolderIcon = () => {
    const { classes: styles, item } = this.props;

    return (
      <div className={styles.fileTypeIconWrapper}>
        <img
          src={imgsrc(`FileExplorer/folder-blue.svg`)}
          alt={item.name}
          className={classNames(styles.fileTypeIcon)}
        />
      </div>
    );
  };

  render() {
    const {
      classes: styles,
      isSelected,
      item,
      deviceType,
      _eventTarget,
      tableData,
      hideColList,
      onContextMenuClick,
      onTableClick,
      onTableDoubleClick,
    } = this.props;

    const { RenderFileIcon, RenderFolderIcon } = this;

    const fileName = springTruncate(
      item.name,
      FILE_EXPLORER_TABLE_TRUNCATE_MAX_CHARS,
    );

    return (
      <TableRow
        draggable
        hover
        role="checkbox"
        aria-checked={isSelected}
        tabIndex={-1}
        selected={isSelected}
        className={classNames(styles.tableRow, {
          [styles.tableRowSelected]: isSelected,
        })}
        onDragStart={(event) => {
          if (!isSelected) {
            onTableClick(item.path, deviceType, event);
          }
        }}
      >
        <TableCell
          padding="none"
          className={`${styles.tableCell} checkboxCell`}
          onContextMenu={(event) =>
            onContextMenuClick(
              event,
              { ...item },
              { ...tableData },
              _eventTarget,
            )
          }
        >
          <Checkbox
            checked={isSelected}
            onClick={(event) => onTableClick(item.path, deviceType, event)}
          />
        </TableCell>
        {hideColList.indexOf('name') < 0 && (
          <TableCell
            padding="normal"
            onClick={(event) => onTableClick(item.path, deviceType, event)}
            className={`${styles.tableCell} nameCell`}
            onContextMenu={(event) =>
              onContextMenuClick(
                event,
                { ...item },
                { ...tableData },
                _eventTarget,
              )
            }
            onDoubleClick={(event) =>
              onTableDoubleClick(item, deviceType, event)
            }
          >
            {item.isFolder ? <RenderFolderIcon /> : <RenderFileIcon />}
            &nbsp;&nbsp;
            {fileName.isTruncated ? (
              <Tooltip title={fileName.text}>
                <div className={styles.truncate}>{fileName.truncatedText}</div>
              </Tooltip>
            ) : (
              fileName.text
            )}
          </TableCell>
        )}
        {hideColList.indexOf('size') < 0 && (
          <TableCell
            padding="none"
            onClick={(event) => onTableClick(item.path, deviceType, event)}
            className={`${styles.tableCell} sizeCell`}
            onContextMenu={(event) =>
              onContextMenuClick(
                event,
                { ...item },
                { ...tableData },
                _eventTarget,
              )
            }
            onDoubleClick={(event) =>
              onTableDoubleClick(item, deviceType, event)
            }
          >
            {item.isFolder ? `--` : `${niceBytes(item.size)}`}
          </TableCell>
        )}
        {hideColList.indexOf('dateAdded') < 0 && (
          <TableCell
            padding="none"
            onClick={(event) => onTableClick(item.path, deviceType, event)}
            className={`${styles.tableCell} dateAddedCell`}
            onContextMenu={(event) =>
              onContextMenuClick(
                event,
                { ...item },
                { ...tableData },
                _eventTarget,
              )
            }
            onDoubleClick={(event) =>
              onTableDoubleClick(item, deviceType, event)
            }
          >
            {appDateFormat(item.dateAdded)}
          </TableCell>
        )}
      </TableRow>
    );
  }
}

export default withStyles(FileExplorerTableBodyListRender, styles);
