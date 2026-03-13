import React from 'react';
import { ReactReduxContext } from 'react-redux';

const withReducer = (key, reducer) => (WrappedComponent) => {
  function Extended(props) {
    const context = React.useContext(ReactReduxContext);
    const store = context?.store;

    if (store?.asyncReducers?.[key] !== reducer) {
      store?.injectReducer?.(key, reducer);
    }

    return <WrappedComponent {...props} />;
  }

  return Extended;
};

export { withReducer };
