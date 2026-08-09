import { mixins, variables } from '../../../styles/js';

const { fastDuration, fastEasing } = variables().transitions;

export const styles = (theme) => ({
  wrapper: {},
  itemWrapper: {
    float: `left`,
    width: 100,
    height: 137,
    // Fixed size tile: safe to contain layout/paint/style so selecting or
    // hovering a tile never forces the browser to re-measure its siblings.
    contain: `content`,
    transition: `background-color ${fastDuration}ms ${fastEasing}`,
  },
  itemCheckBox: {
    display: `none`,
  },
  fileTypeIcon: {
    width: 'auto',
    height: 80,
  },
  fileTypeIconWrapper: {
    ...mixins({ theme }).center,
    paddingTop: 10,
    paddingBottom: 10,
    textAlign: 'center',
  },
  itemSelected: {
    backgroundColor: 'rgba(41, 121, 255, 0.15) !important',
  },
  itemFileName: {
    wordBreak: `break-all`,
    textAlign: `center`,
  },
  itemFileNameWrapper: {
    marginLeft: 12,
    marginRight: 12,
    marginTop: -8,
    textAlign: `center`,
  },
});
