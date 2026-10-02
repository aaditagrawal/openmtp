import { mixins } from '../../../styles/js';

export const styles = (theme) => ({
  root: {},
  dialogContentText: {
    marginBottom: 10,
    wordBreak: `break-all`,
  },
  bodyText: {
    display: 'block',
  },
  secondaryText: {
    marginBottom: 20,
    display: 'block',
  },
  btnPositive: {
    ...mixins({ theme }).btnPositive,
  },
  btnNegative: {
    ...mixins({ theme }).btnNegative,
  },
  textFieldRoot: {
    '& .MuiFormLabel-root.Mui-error.Mui-focused': {
      color: '#f44336',
    },
    '& .MuiFormLabel-root.Mui-focused': {
      color: 'unset',
    },
  },
});
