import React, { Component } from 'react';
import { withStyles } from 'tss-react/mui';
import { Helmet } from 'react-helmet-async';
import GenerateErrorReport from '../ErrorBoundary/components/GenerateErrorReport';
import { APP_TITLE } from '../../constants/meta';
import { styles } from './styles';
import { REPORT_BUGS_PAGE_TITLE } from '../../templates/generateErrorReport';

class ReportBugsPage extends Component {
  render() {
    const { classes: styles } = this.props;

    return (
      <div className={styles.root}>
        <Helmet titleTemplate={`%s - ${APP_TITLE}`}>
          <title>{REPORT_BUGS_PAGE_TITLE}</title>
        </Helmet>
        <GenerateErrorReport isReportBugsPage />
      </div>
    );
  }
}

export default withStyles(ReportBugsPage, styles);
