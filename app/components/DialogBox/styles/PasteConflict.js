import { mixins } from '../../../styles/js';

export const styles = (theme) => ({
  actions: {
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  btnPositive: {
    ...mixins({ theme }).btnPositive,
  },
  btnNegative: {
    ...mixins({ theme }).btnNegative,
  },
  btnNeutral: {
    ...mixins({ theme }).btnPositive,
  },
});
