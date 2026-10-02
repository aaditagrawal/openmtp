import { variables } from '../../../styles/js';

const { fastDuration, fastEasing } = variables().transitions;

export const styles = (_) => {
  return {
    listsWrapper: {
      paddingTop: variables().sizes.sidebarAreaPaddingTop,
      width: variables().sizes.sidebarAreaPaneWidth,
    },
    listsBottom: {
      paddingTop: 5,
      // Dense list items still need a usable hit target.
      [`& .MuiListItemButton-root`]: {
        minHeight: 32,
        transition: `background-color ${fastDuration}ms ${fastEasing}, color ${fastDuration}ms ${fastEasing}`,
      },
    },
    listIcon: {
      minWidth: 32,
    },
    listsCaption: {
      padding: `10px 0 0 16px`,
    },
    primary: {},
    icon: {},
  };
};
