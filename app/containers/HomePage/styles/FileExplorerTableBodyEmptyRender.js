import { mixins } from '../../../styles/js';
import { tableCellFileExplorerTableRowsRender } from './FileExplorerTableBodyListRender';

export const styles = (theme) => ({
  emptyTableRowWrapper: {},
  tableCell: tableCellFileExplorerTableRowsRender,
  helpPhoneNotRecognized: {
    width: '100%',
    ...mixins({ theme }).center,
    color: theme.palette.snackbar.error,
    fontWeight: 600,
  },
  refreshConnectionWrap: {
    margin: '12px 16px 4px',
  },
  hotplugTip: {
    margin: '4px 16px 8px',
    color: theme.palette.text.secondary,
    fontSize: 13,
    lineHeight: '18px',
  },
  noMtp: {
    marginTop: 10,
  },
  instructions: {
    marginTop: 5,
    lineHeight: `18px`,
    paddingLeft: 30,
    color: `rgba(0, 0, 0, 0.8)`,
  },
  nestedPanel: {
    paddingLeft: 16,
    paddingRight: 16,
  },
  divider: {
    marginTop: 10,
    marginBottom: 10,
  },
});
