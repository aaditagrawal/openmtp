import { mixins } from '../../../styles/js';

export const styles = (theme) => ({
  btnPositive: {
    ...mixins({ theme }).btnPositive,
  },
  btnNegative: {
    ...mixins({ theme }).btnNegative,
  },
  fileInfo: {
    marginTop: 8,
    fontSize: 13,
    color: theme.palette.text.secondary,
  },
  fileName: {
    fontWeight: 600,
    wordBreak: 'break-all',
  },
  counter: {
    fontSize: 12,
    color: theme.palette.text.hint,
    marginTop: 4,
  },
});
