import React, { PureComponent } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { withStyles } from 'tss-react/mui';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import { styles } from './styles';
import { setOnboarding } from '../Settings/actions';
import { makeFreshInstall, makeOnboarding } from '../Settings/selectors';
import WhatsNew from './components/WhatsNew';
import Features from './components/Features';
import { latestUpdatePushVersion } from '../../constants/onboarding';

class Onboarding extends PureComponent {
  constructor(props) {
    super(props);

    this.state = {
      fireOnboarding: false,
    };
  }

  componentDidMount() {
    const { onboarding } = this.props;
    const { lastFiredVersion } = onboarding;

    this.setState({
      fireOnboarding: latestUpdatePushVersion !== lastFiredVersion,
    });
  }

  _handleClose = () => {
    const { actionCreateOnboarding } = this.props;

    this.setState({
      fireOnboarding: false,
    });

    actionCreateOnboarding({ lastFiredVersion: latestUpdatePushVersion });
  };

  render() {
    const { classes: styles } = this.props;
    const { fireOnboarding } = this.state;

    return (
      <Dialog
        className={styles.root}
        fullWidth
        maxWidth="md"
        scroll="paper"
        aria-labelledby="onboaring-dialogbox"
        open={fireOnboarding}
      >
        <DialogTitle>Release at a Glance!</DialogTitle>
        <DialogContent>
          <div className={styles.contentBox}>
            <WhatsNew hideTitle={false} />
            <Divider className={styles.divider} />
            <Features hideTitle={false} />
          </div>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => this._handleClose()}
            color="primary"
            className={styles.btnPositive}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>
    );
  }
}

const mapDispatchToProps = (dispatch, __) =>
  bindActionCreators(
    {
      actionCreateOnboarding:
        ({ ...data }) =>
        (_, getState) => {
          dispatch(setOnboarding({ ...data }, getState));
        },
    },
    dispatch,
  );

const mapStateToProps = (state, __) => {
  return {
    onboarding: makeOnboarding(state),
    freshInstall: makeFreshInstall(state),
  };
};

export default connect(
  mapStateToProps,
  mapDispatchToProps,
)(withStyles(Onboarding, styles));
