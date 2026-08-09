export class IpcEvents {
  static OPEN_FAQS_WINDOW = 'ipc.window.faqs';

  static OPEN_HELP_PHONE_NOT_CONNECTING_WINDOW =
    'ipc.window.helpPhoneNotConnecting';

  static OPEN_HELP_PRIVACY_POLICY_WINDOW = 'ipc.window.privacyPolicy';

  static OPEN_KEYBOARD_SHORTCUTS_WINDOW = 'ipc.window.keyboardShortcuts';

  static REPORT_BUGS_DISPOSE_MTP = 'ipc.reportBugsDisposeMtp';

  static REPORT_BUGS_DISPOSE_MTP_REPLY = 'ipc.reportBugsDisposeMtpReply';

  static REPORT_BUGS_DISPOSE_MTP_REPLY_FROM_MAIN =
    'ipc.reportBugsDisposeMtpReply.fromMain';

  static USB_HOTPLUG = 'ipc.usbHotplug';

  // Ask the renderer (which owns the live Kalam MTP session) to dispose
  // before the Electron app exits. Main-process dispose is a separate heap.
  static APP_BEFORE_QUIT_DISPOSE_MTP = 'ipc.appBeforeQuitDisposeMtp';

  static APP_BEFORE_QUIT_DISPOSE_MTP_DONE = 'ipc.appBeforeQuitDisposeMtpDone';
}
