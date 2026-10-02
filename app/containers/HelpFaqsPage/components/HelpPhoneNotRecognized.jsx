import React, { PureComponent } from 'react';
import { withStyles } from 'tss-react/mui';
import Paper from '@mui/material/Paper';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import {
  Trash2,
  X,
  Circle,
  ToggleLeft,
  Check,
  List as ListIcon,
  Settings,
  ThumbsUp,
  FolderHeart,
  RefreshCw,
  Usb,
  MousePointerClick,
  CircleDot,
  Lock,
  ChevronDown,
  Power,
  RotateCcw,
  Download,
} from 'lucide-react';
import Icon from '../../../components/Icon';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Typography from '@mui/material/Typography';
import { styles } from '../styles/HelpPhoneNotRecognized';
import { openExternalUrl } from '../../../utils/url';
import {
  APP_GITHUB_ISSUES_URL,
  APP_NAME,
  APP_VERSION,
  AUTHOR_EMAIL,
} from '../../../constants/meta';
import { analyticsService } from '../../../services/analytics';
import { EVENT_TYPE } from '../../../enums/events';
import {
  BUY_ME_A_COFFEE_URL,
  DELETE_KEIS_SMARTSWITCH_URL,
  DEVICES_LABEL,
  SUPPORT_PAYPAL_URL,
} from '../../../constants';
import { DEVICE_TYPE, MTP_MODE } from '../../../enums';
import {
  localErrorDictionary,
  mtpErrors,
} from '../../../helpers/processBufferOutput';
import { MTP_ERROR } from '../../../enums/mtpError';
import { imgsrc } from '../../../utils/imgsrc';
import { helpPhoneNotConnecting } from '../../../templates/fileExplorer';
import { isKalamModeSupported } from '../../../helpers/binaries';

function HelpSection({ styles, title, children }) {
  return (
    <Accordion className={styles.expansionRoot}>
      <AccordionSummary expandIcon={<Icon icon={ChevronDown} />}>
        <Typography className={styles.heading}>{title}</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <List component="div" disablePadding>
          {children}
        </List>
      </AccordionDetails>
    </Accordion>
  );
}

function Instruction({ icon, ...text }) {
  return (
    <ListItem>
      <ListItemIcon>
        <Icon icon={icon} />
      </ListItemIcon>
      <ListItemText {...text} />
    </ListItem>
  );
}

const hotplugSettingText = `Check if 'Enable auto device detection (USB Hotplug)' is enabled under Settings > General Tab`;
const deviceLabel = DEVICES_LABEL[DEVICE_TYPE.mtp];

class HelpPhoneNotRecognized extends PureComponent {
  _handleGithubThreadTap = (events) => {
    openExternalUrl(`${APP_GITHUB_ISSUES_URL}8`, events);

    analyticsService.sendEvent(
      EVENT_TYPE.MTP_HELP_PHONE_NOT_CONNECTED_GITHUB_THREAD_TAP,
      {},
    );
  };

  RenderFileTransfer = () => {
    const { classes: styles } = this.props;

    return (
      <>
        <Instruction
          icon={MousePointerClick}
          primary="On your device, tap the 'Charging this device via
                  USB' notification"
          secondary={
            <img
              src={imgsrc(`help/usb-notification-charging-via-usb.png`)}
              alt="Use USB for"
              className={styles.imagePlaceholder}
            />
          }
        />
        <Instruction
          icon={CircleDot}
          primary="Under 'Use USB for' select File Transfer"
          secondary={
            <img
              src={imgsrc(`help/transfer-media-permission.png`)}
              alt="Allow access to the device data"
              className={styles.imagePlaceholder}
            />
          }
        />
      </>
    );
  };

  RenderRefreshButtonIsStuck = () => {
    const { classes: styles } = this.props;

    const { RenderFileTransfer } = this;

    return (
      <>
        <Instruction icon={Lock} primary="Unlock your Android device" />

        <Instruction
          icon={Usb}
          primary={`Unplug your ${deviceLabel.toLowerCase()} and reconnect it`}
          secondary={`Follow the instructions below if your ${deviceLabel.toLowerCase()} is still undetected`}
        />

        <Instruction
          icon={MousePointerClick}
          primary="On your device, tap the 'Transferring media files' notification"
          secondary={
            <img
              src={imgsrc(`help/usb-notification-transferring-media.png`)}
              alt="Transferring media files"
              className={styles.imagePlaceholder}
            />
          }
        />
        <Instruction
          icon={CircleDot}
          primary="Under 'Use USB for' select 'Charging'"
          secondary={
            <img
              src={imgsrc(`help/charge-only-permission.png`)}
              alt="Charging"
              className={styles.imagePlaceholder}
            />
          }
        />

        <RenderFileTransfer />

        <Instruction
          icon={Circle}
          primary="It should connect automatically"
          secondary={hotplugSettingText}
        />
        <Instruction
          icon={RefreshCw}
          primary={`Tap on the 'Refresh' button in the app if the ${deviceLabel.toLowerCase()} doesn't get connected automatically`}
          secondary={hotplugSettingText}
        />

        <Instruction
          icon={MousePointerClick}
          primary={`Tap on the "Allow" button, if you see the "Allow access to the device data" pop up`}
          secondary={
            <img
              src={imgsrc(`help/allow-data-access.png`)}
              alt="Allow access to the device data"
              className={styles.imagePlaceholder}
            />
          }
        />
      </>
    );
  };

  RenderBasicConnection = ({
    showUnplugPhone = true,
    showUnlockPhone = true,
  }) => {
    const { RenderFileTransfer } = this;

    return (
      <>
        {showUnlockPhone && (
          <Instruction icon={Lock} primary="Unlock your Android device" />
        )}

        {showUnplugPhone && (
          <Instruction
            icon={Usb}
            primary={`Unplug your ${deviceLabel.toLowerCase()} and reconnect it`}
          />
        )}

        <RenderFileTransfer />

        <Instruction
          icon={Circle}
          primary="It should connect automatically"
          secondary={hotplugSettingText}
        />
        <Instruction
          icon={RefreshCw}
          primary={`Tap on the 'Refresh' button in the app if the ${deviceLabel.toLowerCase()} doesn't get connected automatically`}
          secondary={hotplugSettingText}
        />
      </>
    );
  };

  render() {
    const { classes: styles, showPhoneNotRecognizedNote } = this.props;
    const { RenderBasicConnection, RenderRefreshButtonIsStuck } = this;
    const isKalamModeDisabled = !isKalamModeSupported();

    return (
      <div className={styles.root}>
        <Paper elevation={0}>
          {showPhoneNotRecognizedNote && (
            <>
              <Typography component="p" variant="body2">
                <strong>{APP_NAME}</strong> was a project that I started to
                solve a problem that was so personal to me. But I always knew,
                that there&apos;s a community, whose facing the same problem as
                I did.
              </Typography>
              <Typography component="p" variant="body2" paragraph>
                I wasn&apos;t wrong, I guess. Now, we are a strong community
                with users from over&nbsp;
                <strong>180 countries</strong>. It&apos;s overwhelming to see
                the response that I have received from all of you, not just
                appreciating the app, but also giving me suggestions and
                feedback to improve it.
              </Typography>
              <Typography component="p" variant="body2">
                As they say, you build for the community and learn from it.
              </Typography>
              <Typography component="p" variant="body2" paragraph>
                I read each and every message that you send and am constantly
                working to improve the app based on your feedback. Keep sending
                more of those :)
              </Typography>
              <Typography component="p" variant="body2" paragraph>
                Some of you have been telling me that there are issues with
                connecting certain mobile phones (<i>mostly Samsung</i>) to{' '}
                {APP_NAME}. I have been working hard to fix this issue by
                migrating the existing MTP Kernel to a better one.
              </Typography>
              <Typography component="p" variant="body2" paragraph>
                You may reach out to me at&nbsp;
                <a
                  href={`mailto:${AUTHOR_EMAIL}?Subject=${helpPhoneNotConnecting}&Body=${APP_NAME} - ${APP_VERSION}`}
                >
                  {AUTHOR_EMAIL}
                </a>
                &nbsp;or check out this&nbsp;
                <a onClick={this._handleGithubThreadTap}>thread</a>
                &nbsp;on GitHub for tracking the same,&nbsp;
                <i>
                  to collaborate and make this community bigger and stronger
                </i>
                !
              </Typography>
              <Typography component="p" variant="body2" paragraph>
                If you&apos;d like to support my work or buy me up a cup of
                coffee, you can contribute via&nbsp;Paypal:&nbsp;
                <a
                  onClick={(events) => {
                    openExternalUrl(SUPPORT_PAYPAL_URL, events);
                  }}
                >
                  {SUPPORT_PAYPAL_URL}
                </a>
                &nbsp;or Buy me a coffee:&nbsp;
                <a
                  onClick={(events) => {
                    openExternalUrl(BUY_ME_A_COFFEE_URL, events);
                  }}
                >
                  {BUY_ME_A_COFFEE_URL}
                </a>
                .
              </Typography>
              <Typography component="p" variant="h6" paragraph>
                FAQs
              </Typography>
            </>
          )}

          {isKalamModeDisabled && (
            <HelpSection
              styles={styles}
              title={
                <>{`Upgrade you mac's OS version for better app experience`}</>
              }
            >
              <Instruction
                icon={Download}
                primary={`We have now officially retired the support for '${MTP_MODE.kalam}' Kernel on 'macOS 10.13' (OS X El High Sierra) and lower. Only the '${MTP_MODE.legacy}' MTP mode will continue working on these outdated machines.`}
              />

              <Instruction
                icon={Download}
                primary={`Only the latest 3 versions of macOS will receive the '${MTP_MODE.kalam}' Kernel updates, which includes new devices support, fixes, stability improvements`}
              />
            </HelpSection>
          )}

          <HelpSection
            styles={styles}
            title={<>{`My ${deviceLabel.toLowerCase()} is not connecting`}</>}
          >
            <Instruction
              icon={X}
              primary={`Quit Google drive, Android File Transfer, Dropbox, OneDrive, Preview (for macOS ventura) or any other app that might be reading USB`}
              secondary={
                <span>
                  {`Uninstall 'Android File Transfer' by Google if it
                              keeps popping up everytime you connect your
                              Android device. The most recent versions of Google
                              drive and Dropbox are known to interfere with ${APP_NAME}. Completely quiting these apps may fix
                              this issue. `}
                  <a
                    onClick={(events) => {
                      openExternalUrl(
                        'https://github.com/ganeshrvel/openmtp/issues/276',
                        events,
                      );
                    }}
                  >
                    Read more...
                  </a>
                </span>
              }
            />

            <Instruction
              icon={ToggleLeft}
              primary={`If you face frequent device disconnections, turn off 'USB Hotplug'`}
              secondary={`Settings > General Tab`}
            />

            <RenderBasicConnection />
          </HelpSection>

          {/* <----- Google drive is interfering with OpenMTP-----> */}
          <HelpSection
            styles={styles}
            title={
              <>
                {`I have Google drive installed on my ${
                  DEVICES_LABEL[DEVICE_TYPE.local]
                }`}
              </>
            }
          >
            <Instruction
              icon={Trash2}
              primary={`The most recent versions of Google drive is known to interfere with ${APP_NAME}. Simply quiting Google drive may fix this issue`}
              secondary={
                <img
                  src={imgsrc(`help/google-drive-not-connecting.png`)}
                  alt="Files and Folders"
                  className={styles.imagePlaceholder}
                />
              }
            />

            <RenderBasicConnection />
          </HelpSection>

          {/* <----- Dropbox is interfering with OpenMTP-----> */}
          <HelpSection
            styles={styles}
            title={
              <>
                {`I have Dropbox installed on my ${
                  DEVICES_LABEL[DEVICE_TYPE.local]
                }`}
              </>
            }
          >
            <Instruction
              icon={Trash2}
              primary={`The most recent versions of Dropbox is known to interfere with ${APP_NAME}. Simply quiting Dropbox may fix this issue`}
            />

            <RenderBasicConnection />
          </HelpSection>

          {/* <----- The app goes blank while trying to connect a Samsung device -----> */}

          <HelpSection
            styles={styles}
            title={
              <>
                {`The app goes blank while trying to connect a Samsung device`}
              </>
            }
          >
            <Instruction
              icon={Trash2}
              primary="Uninstall Samsung SmartSwitch, if installed"
              secondary={
                <a
                  onClick={(events) => {
                    openExternalUrl(DELETE_KEIS_SMARTSWITCH_URL, events);
                  }}
                >
                  How to remove Samsung SmartSwitch and drivers from your
                  MacBook
                </a>
              }
            />

            <Instruction icon={RotateCcw} primary={`Restart ${APP_NAME}`} />

            <RenderBasicConnection />
          </HelpSection>

          {/* <----- i keep seeing setting up device -----> */}

          <HelpSection
            styles={styles}
            title={
              <>
                {`I keep seeing "${mtpErrors[[MTP_ERROR.ErrorDeviceSetup]]}"`}
              </>
            }
          >
            <RenderBasicConnection />
          </HelpSection>

          {/* <----- i keep seeing allow storage access -----> */}
          <HelpSection
            styles={styles}
            title={
              <>
                {`I keep seeing "${
                  mtpErrors[[MTP_ERROR.ErrorAllowStorageAccess]]
                }"`}
              </>
            }
          >
            <Instruction icon={Lock} primary="Unlock your Android device" />
            <Instruction
              icon={MousePointerClick}
              primary={`Tap on the "Allow" button, if you see the "Allow access to the device data" pop up`}
              secondary={
                <img
                  src={imgsrc(`help/allow-data-access.png`)}
                  alt="Allow access to the device data"
                  className={styles.imagePlaceholder}
                />
              }
            />
            <Instruction
              icon={Circle}
              primary={`If you don't see the "Allow access to the device data" pop up then reconnect your ${deviceLabel.toLowerCase()}`}
              secondary={`Follow the instructions below if your ${deviceLabel.toLowerCase()} is still undetected`}
            />

            <Instruction
              icon={Circle}
              primary={`If you are prompted to "Allow access to the device data" multiple times then reconnect your ${deviceLabel.toLowerCase()} and try again`}
            />
          </HelpSection>

          {/* <----- Allow access to the device data" multiple times -----> */}
          <HelpSection
            styles={styles}
            title={
              <>
                {`I am prompted to "Allow access to the device data" multiple times`}
              </>
            }
          >
            <RenderRefreshButtonIsStuck />
          </HelpSection>

          {/* <----- refresh button is stuck -----> */}
          <HelpSection styles={styles} title={<>{`Refresh button is stuck`}</>}>
            <RenderRefreshButtonIsStuck />
          </HelpSection>

          {/* <----- i keep seeing multiple devices error -----> */}
          <HelpSection
            styles={styles}
            title={
              <>
                {`I keep seeing "${
                  mtpErrors[[MTP_ERROR.ErrorMultipleDevice]]
                }"`}
              </>
            }
          >
            <Instruction icon={Circle} primary="Unplug all your MTP devices" />
            <Instruction icon={Usb} primary="Plug your MTP devices" />

            <RenderBasicConnection showUnplugPhone={false} />
          </HelpSection>

          {/* <----- phone gets disconnected everytime screen goes into sleep -----> */}
          <HelpSection
            styles={styles}
            title={
              <>
                {`My ${deviceLabel.toLowerCase()} gets disconnected everytime the display goes into sleep`}
              </>
            }
          >
            <Instruction
              icon={Circle}
              primary={`In a very rare case your ${deviceLabel.toLowerCase()} may get disconnected when your display goes into sleep. This may disrupt any active file transfers`}
            />

            <Instruction icon={Lock} primary="Unlock your Android device" />

            <Instruction
              icon={CircleDot}
              primary={`Open ${deviceLabel.toLowerCase()}'s Settings > Display > Sleep and set it as 30 minutes or whatever is the highest`}
              secondary={
                <img
                  src={imgsrc(`help/sleep-setting.jpg`)}
                  alt="Sleep settings"
                  className={styles.imagePlaceholder}
                />
              }
            />

            <RenderBasicConnection showUnlockPhone={false} />
          </HelpSection>

          {/* <----- i keep seeing quit android file transfer error -----> */}
          <HelpSection
            styles={styles}
            title={
              <>
                {`I keep seeing "Quit 'Android File Transfer' app (by Google) and Refresh"`}
              </>
            }
          >
            <Instruction
              icon={Trash2}
              primary="Quit and uninstall Google's 'Android File Transfer' app"
            />

            <RenderBasicConnection showUnplugPhone={false} />
          </HelpSection>

          {/* <----- my phone is still not detected -----> */}
          <HelpSection
            styles={styles}
            title={<>{`My phone is still not connecting`}</>}
          >
            <Instruction
              icon={Trash2}
              primary="Uninstall Samsung SmartSwitch, if installed"
              secondary={
                <a
                  onClick={(events) => {
                    openExternalUrl(DELETE_KEIS_SMARTSWITCH_URL, events);
                  }}
                >
                  How to remove Samsung SmartSwitch and drivers from your
                  MacBook
                </a>
              }
            />

            <Instruction
              icon={Power}
              primary="Try changing the MTP mode"
              secondary={`Settings > Tab > Change the "MTP Mode"`}
            />

            <RenderBasicConnection />
          </HelpSection>

          {/* <----- Operation not permitted error -----> */}
          <HelpSection
            styles={styles}
            title={
              <>
                {`I keep seeing "${localErrorDictionary.noPerm}" error whenever I try to open a folder in the Local Disk pane`}
              </>
            }
          >
            <Instruction
              icon={FolderHeart}
              primary={`macOS requires that you provide access to your Documents, Desktop, Downloads, and Bin folders, iCloud Drive, the folders of third-party cloud storage providers, removable media, and external drives`}
            />

            <Instruction
              icon={ThumbsUp}
              primary={`Tap on the "Ok" button, if you see a "${APP_NAME} would like to access files in your..." pop up while trying to open a folder`}
              secondary={
                <img
                  src={imgsrc(`help/macos-directory-access.jpg`)}
                  alt="Directory access permission prompt"
                  className={styles.imagePlaceholder}
                />
              }
            />
            <Instruction
              icon={Circle}
              primary={`If you keep getting the "${localErrorDictionary.noPerm}" error then you may need to give access to these folders by going to "Security and Privacy" in "System Preferences"`}
            />
            <Instruction
              icon={Settings}
              primary={`Open macOS "System Preferences" > "Security and Privacy" > "Privacy Tab"`}
              secondary={`Tap on the "Click the lock to make changes" button and authenticate yourself`}
            />

            <Instruction
              icon={ListIcon}
              primary={`In the left hand side pane find the "Files and Folders" option, select it. In the right hand side pane find "${APP_NAME}"`}
            />

            <Instruction
              icon={Check}
              primary={`Mark all the folders to which you want to provide ${APP_NAME} access`}
              secondary={
                <img
                  src={imgsrc(`help/privacy-restricted-folder-access.png`)}
                  alt="Files and Folders"
                  className={styles.imagePlaceholder}
                />
              }
            />
          </HelpSection>

          {/* <----- Full disk access -----> */}
          <HelpSection
            styles={styles}
            title={
              <>
                {`I am still being denied access to some of the folders in the Local Disk pane`}
              </>
            }
          >
            <Instruction
              icon={FolderHeart}
              primary={`macOS requires that you provide access to your Documents, Desktop, Downloads, and Bin folders, iCloud Drive, the folders of third-party cloud storage providers, removable media, and external drives`}
            />
            <Instruction
              icon={Circle}
              primary={`If you still keep getting the "${localErrorDictionary.noPerm}" error then you may grant "Full Disk Access" by going to "Security and Privacy" in "System Preferences"`}
            />
            <Instruction
              icon={Settings}
              primary={`Open macOS "System Preferences" > "Security and Privacy" > "Privacy Tab"`}
              secondary={`Tap on the "Click the lock to make changes" button and authenticate yourself`}
            />

            <Instruction
              icon={ListIcon}
              primary={`In the left hand side pane find the "Full Disk Access" option, select it. In the right hand side pane find "${APP_NAME}"`}
              secondary={
                <img
                  src={imgsrc(`help/full-disk-access.png`)}
                  alt="Files and Folders"
                  className={styles.imagePlaceholder}
                />
              }
            />

            <Instruction
              icon={Check}
              primary={`If you didn't find ${APP_NAME} in the list, then tap on the "+" button and select "${APP_NAME}" by navigating to the "Application" folder`}
              secondary={
                <img
                  src={imgsrc(`help/full-disk-access-file-picker.jpeg`)}
                  alt="Files and Folders"
                  className={styles.imagePlaceholder}
                />
              }
            />
          </HelpSection>
        </Paper>
      </div>
    );
  }
}

export default withStyles(HelpPhoneNotRecognized, styles);
