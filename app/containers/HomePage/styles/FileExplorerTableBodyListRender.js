import { variables } from '../../../styles/js';

const { fastDuration, fastEasing } = variables().transitions;

export const tableCellFileExplorerTableRowsRender = {
  borderBottom: `unset`,
  [`&.checkboxCell`]: {
    width: 50,
  },
  [`&.nameCell`]: {
    display: 'flex',
    alignItems: 'center',
    whiteSpace: `nowrap`,
    overflow: `hidden`,
    textOverflow: `ellipsis`,
  },
  [`&.sizeCell`]: {
    whiteSpace: `nowrap`,
    overflow: `hidden`,
    textOverflow: `ellipsis`,
    width: `auto`,
    minWidth: 100,
    fontVariantNumeric: 'tabular-nums',
  },
  [`&.dateAddedCell`]: {
    whiteSpace: `nowrap`,
    overflow: `hidden`,
    textOverflow: `ellipsis`,
    width: `auto`,
    minWidth: 100,
    paddingRight: 10,
    fontVariantNumeric: 'tabular-nums',
  },
};

export const styles = (_) => {
  return {
    // Background-color-only hover/selection keeps paint cheap on long lists.
    // `contain: content` is unreliable on `display: table-row`, so the inner
    // icon wrapper below is contained instead.
    tableRow: {
      transition: `background-color ${fastDuration}ms ${fastEasing}`,
    },
    tableRowSelected: {
      backgroundColor: 'rgba(41, 121, 255, 0.15) !important',
    },
    tableCell: tableCellFileExplorerTableRowsRender,
    fileTypeIconWrapper: {
      paddingTop: 5,
      paddingBottom: 5,
      paddingLeft: 2,
      textAlign: 'center',
      // Fixed icon box: safe to isolate so hover/selection on the row doesn't
      // invalidate layout of neighboring cells.
      contain: 'content',
    },
    fileTypeIcon: {
      verticalAlign: `middle`,
      height: 20,
      width: 'auto',
    },
    truncate: {
      textOverflow: 'ellipsis',
      overflow: 'hidden',
      maxWidth: 310,
      whiteSpace: 'nowrap',
    },
  };
};
