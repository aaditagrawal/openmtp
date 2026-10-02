import React, { Component } from 'react';
import { withStyles } from 'tss-react/mui';
import Typography from '@mui/material/Typography';
import { Helmet } from 'react-helmet-async';
import { APP_TITLE } from '../../constants/meta';
import { resetOverFlowY } from '../../utils/styleResets';
import { styles } from './styles';
import {
  FAQS_PAGE_TITLE,
  HELP_PHONE_IS_NOT_CONNECTING,
} from '../../templates/helpFaqsPage';
import HelpPhoneNotRecognized from './components/HelpPhoneNotRecognized';

class FaqsPage extends Component {
  componentDidMount() {
    resetOverFlowY();
  }

  render() {
    const { classes: styles, showPhoneNotRecognizedNote } = this.props;

    const title = showPhoneNotRecognizedNote
      ? HELP_PHONE_IS_NOT_CONNECTING
      : FAQS_PAGE_TITLE;

    return (
      <div className={styles.root}>
        <Helmet titleTemplate={`%s - ${APP_TITLE}`}>
          <title>{title}</title>
        </Helmet>
        <Typography variant="h5" className={styles.heading}>
          {title}
        </Typography>
        <div className={styles.body}>
          <HelpPhoneNotRecognized
            showPhoneNotRecognizedNote={showPhoneNotRecognizedNote}
          />
        </div>
      </div>
    );
  }
}

export default withStyles(FaqsPage, styles);
