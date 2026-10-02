import PrivacyPolicyContent from '../../../shared/privacyPolicy';
import React, { Component } from 'react';
import { withStyles } from 'tss-react/mui';
import Typography from '@mui/material/Typography';
import { Helmet } from 'react-helmet-async';
import {
  APP_GITHUB_URL,
  APP_NAME,
  APP_TITLE,
  AUTHOR_EMAIL,
  AUTHOR_NAME,
} from '../../constants/meta';
import { openExternalUrl } from '../../utils/url';
import { resetOverFlowY } from '../../utils/styleResets';
import { PRIVACY_POLICY_PAGE_TITLE } from '../../templates/privacyPolicyPage';
import { styles } from './styles';
import { PATHS } from '../../constants/paths';

function ExternalLink({ href, children }) {
  return <a onClick={(event) => openExternalUrl(href, event)}>{children}</a>;
}

class PrivacyPolicyPage extends Component {
  componentDidMount() {
    resetOverFlowY();
  }

  render() {
    const { classes: styles } = this.props;

    return (
      <div className={styles.root}>
        <Helmet titleTemplate={`%s - ${APP_TITLE}`}>
          <title>{PRIVACY_POLICY_PAGE_TITLE}</title>
        </Helmet>
        <Typography variant="h5" className={styles.heading}>
          Privacy policy for {APP_NAME}
        </Typography>
        <div className={styles.body}>
          <PrivacyPolicyContent
            appName={APP_NAME}
            authorName={AUTHOR_NAME}
            authorEmail={AUTHOR_EMAIL}
            contactUrl={APP_GITHUB_URL}
            profileDir={PATHS.profileDir}
            Link={ExternalLink}
          />
        </div>
      </div>
    );
  }
}

export default withStyles(PrivacyPolicyPage, styles);
