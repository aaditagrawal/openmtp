import { mixins } from '../../../styles/js';

export const styles = (theme) => {
  return {
    root: {
      width: `100%`,
      // Compact drag strip; 18px keeps 12px type readable without eating
      // into the toolbar below.
      height: 18,
      padding: '0 8px',
      textAlign: 'center',
      ...mixins({ theme }).appDragEnable,
      ...mixins({ theme }).center,
    },
    deviceInfo: {
      ...mixins({ theme }).center,
      width: `100%`,
      textAlign: 'center',
      color: theme.palette.lightText1Color,
      fontWeight: 'bold',
      fontSize: '12px',
      lineHeight: '18px',
      // Free-space / capacity digits update live; tabular figures stop the
      // centered title from jittering as widths change.
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
    deviceModel: {
      textTransform: 'capitalize',
    },
  };
};
