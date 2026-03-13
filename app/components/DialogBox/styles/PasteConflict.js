import { mixins } from '../../../styles/js';

export const styles = (theme) => ({
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
