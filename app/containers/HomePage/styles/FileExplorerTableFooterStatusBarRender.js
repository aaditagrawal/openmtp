export const styles = (theme) => ({
  root: {
    padding: '0 12px',
    width: '100%',
    background: theme.palette.tableHeaderFooterBgColor,
    // Fixed box so selection/count updates never change status-bar height.
    height: 28,
    minHeight: 28,
    maxHeight: 28,
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    textAlign: 'center',
  },

  deviceTypeWrapper: {
    fontWeight: '500',
    color: theme.palette.secondary.main,
    marginLeft: 5,
    fontSize: 12,
    textTransform: 'capitalize',
    // Keeps free-space/capacity digits a fixed width so the status bar
    // doesn't visibly jitter as the numbers change.
    fontVariantNumeric: 'tabular-nums',

    [`& span`]: {
      color: theme.palette.contrastPrimaryMainColor,
      fontWeight: '600',
      fontSize: 13,
    },
  },

  bodyWrapper: {
    fontWeight: '500',
    color: theme.palette.lightText1Color,
    // Item/selection counts update frequently; tabular figures stop the
    // text from reflowing every time a digit width changes.
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '100%',
    lineHeight: '28px',
  },
});
