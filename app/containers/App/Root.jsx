import React, { Component } from 'react';
import { Provider } from 'react-redux';
import { HelmetProvider } from 'react-helmet-async';
import '../../helpers/console';

import App from '.';

export default class Root extends Component {
  render() {
    const { store } = this.props;

    return (
      <Provider store={store}>
        <HelmetProvider>
          <App />
        </HelmetProvider>
      </Provider>
    );
  }
}
