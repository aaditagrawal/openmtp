const { createElement: h, Fragment } = require('react');
const paragraph = (...children) => h('p', null, h('span', null, ...children));
const list = (...items) =>
  h(
    'ul',
    null,
    ...items.map((item, index) =>
      h('li', { key: index }, h('span', null, item)),
    ),
  );
// Kept shared so the desktop and website publish the same policy text.
module.exports = function PrivacyPolicyContent({
  appName,
  authorName,
  authorEmail,
  contactUrl,
  profileDir,
  Link = 'a',
  website = false,
}) {
  const StorageHeading = website ? Fragment : 'p';
  return h(
    Fragment,
    null,
    '          ',
    paragraph('Effective date: December 28, 2018'),
    paragraph('Updated date: January 3, 2021'),
    paragraph(
      appName,
      ' ("us", "we", or "our") operates the app (hereinafter referred to as the "Service").',
    ),
    paragraph(
      authorName,
      ' built the "',
      appName,
      '" app as an Open Source app. This SERVICE is provided by ',
      authorName,
      ' at no cost and is intended for use as is.',
    ),
    paragraph(
      'This page informs you of our policies regarding the collection, use, and disclosure of personal data when you use our Service and the choices you have associated with that data.',
    ),
    paragraph(
      'We use your data to provide, study and improve the Service. By using the Service, you agree to the collection and use of information in accordance with this policy.',
    ),
    paragraph(h('strong', null, 'Information Collection And Use')),
    paragraph(
      'We take your privacy very seriously and we DO NOT gather or transfer any sort of personal data out of your device in any form. We gather a very limited amount of ANONYMOUS information from you which will be used for various purposes such as providing and improving our Service to you. You may always choose not to share such ANONYMOUS information with us.',
    ),
    paragraph(h('strong', null, 'Types of Data Collected')),
    h(
      'p',
      null,
      h('span', null, 'Personal Data'),
      website && ' ',
      h(
        'span',
        null,
        'While using our Service, we DO NOT ask you to provide us with any kind of personally identifiable information that can be used to contact or identify you ("Personal Data").',
      ),
    ),
    paragraph(
      h('u', null, 'Cookies'),
      ": Cookies are files with a small amount of data that are commonly used as anonymous unique identifiers. These are sent to your browser from the websites that you visit and are stored on your device's internal memory.",
    ),
    paragraph(
      'This Service does not use these "cookies" explicitly. However, the app may use third party code and libraries that use “cookies” to collect information and improve their services. You have the option to either accept or refuse these cookies and know when a cookie is being sent to your device. If you choose to refuse our cookies, you may not be able to use some portions of this Service.',
    ),
    paragraph(
      h('u', null, 'Usage Data'),
      ': We may also collect anonymous information on how the Service is accessed and used ("Usage Data"). This Usage Data may include information such as your computer\'s Internet Protocol address (e.g. IP address), browser type, browser version, the pages of our Service that you visit, the time and date of your visit, the time spent on those pages, "encrypted" unique device identifiers and other diagnostic data.',
    ),
    paragraph(
      h('u', null, 'LocalStorage Data'),
      ': We use "LocalStorage" and similar technologies to gather information about the activity on our Service and hold very limited information. LocalStorages are files with small amount of data which may include an anonymous unique identifier.',
    ),
    paragraph(
      'You may always "Opt-Out" of sharing anonymous usage data with us by navigating to "Settings" option and disabling the "Enable anonymous usage statistics gathering" button.',
    ),
    h(
      StorageHeading,
      null,
      h('span', null, 'LocalStorage files we used in the app:'),
    ),
    list(
      'Analytics File. We use Analytics Storage to operate our analytics Service.',
      'Settings File. We use Settings Files to remember your preferences and various settings.',
      'Log Files. We use Log Files to collect the crash reports for other diagnostic reasons.',
    ),
    paragraph(h('strong', null, 'Use of Data')),
    paragraph(appName, ' uses the collected data for various purposes:'),
    list(
      'To provide and maintain the Service',
      'To notify you about changes to our Service',
      'To allow you to participate in interactive features of our Service when you choose to do so',
      'To provide customer care and support',
      'To provide analysis or valuable information so that we can improve the Service',
      'To monitor the usage of the Service',
      'To detect, prevent and address technical issues',
    ),
    paragraph(h('strong', null, 'Transfer Of Data')),
    paragraph(
      'Your information may be transferred to — and maintained on — computers located outside of your state, province, country or other governmental jurisdiction where the data protection laws may differ than those from your jurisdiction.',
    ),
    paragraph(
      'Your consent to this Privacy Policy followed by your submission of such information represents your agreement to that transfer.',
    ),
    paragraph(
      appName,
      ' will take all steps reasonably necessary to ensure that your data is treated securely and in accordance with this Privacy Policy and no transfer of your Personal Data will take place to an organization or a country unless there are adequate controls in place including the security of your data and other personal information.',
    ),
    paragraph(h('strong', null, 'Disclosure Of Data')),
    paragraph(h('u', null, 'Legal Requirements')),
    paragraph(
      appName,
      ' may disclose your data in the good faith belief that such action is necessary to:',
    ),
    list(
      'To comply with a legal obligation',
      h(
        Fragment,
        null,
        'To protect and defend the rights or property of ',
        appName,
      ),
      'To prevent or investigate possible wrongdoing in connection with the Service',
      'To protect the personal safety of users of the Service or the public',
      'To protect against legal liability',
    ),
    paragraph(h('strong', null, 'Security Of Data')),
    paragraph(
      'The security of your data is important to us, but remember that no method of transmission over the Internet, or method of electronic storage is 100% secure. While we strive to use commercially acceptable means to protect your Personal Data, we cannot guarantee its absolute security.',
    ),
    paragraph(h('strong', null, 'Service Providers')),
    paragraph(
      'We may employ third party companies and individuals to facilitate our Service ("Service Providers"), to provide the Service on our behalf, to perform Service-related services or to assist us in analyzing how our Service is used.',
    ),
    paragraph(
      'These third parties have access to your Personal Data only to perform these tasks on our behalf and are obligated not to disclose or use it for any other purpose.',
    ),
    paragraph(h('strong', null, 'Analytics')),
    paragraph(
      'We may use third-party Service Providers to monitor and analyze the use of our Service. These information will be help us squash some bugs and improve the user experience.',
    ),
    paragraph(`We don't send any of your personal information to these third party services. We send an anonymized, hashed and irreversible token to these services to analyze
              the use of our Service.`),
    paragraph('Google Analytics'),
    paragraph(
      'Google Analytics is a web analytics service offered by Google that tracks and reports website/app traffic. Google uses the data collected to track and monitor the use of our Service. We respect the privacy of our users and we have chosen to "Opt-Out" of sharing the data with other Google products & services. We will never allow Google to remarket or use your data for its advertising, benchmarking and other internal services.',
    ),
    paragraph(
      'For more information visit:\xA0',
      h(
        Link,
        {
          href: 'https://policies.google.com/privacy?hl=en',
        },
        'https://policies.google.com/privacy?hl=en',
      ),
    ),
    paragraph('Mixpanel'),
    paragraph(
      'Mixpanel is a web analytics service offered by Mixpanel Inc. that tracks and reports website/app traffic. Mixpanel uses the data collected to track and monitor the use of our Service.',
    ),
    paragraph(
      'For more information visit:\xA0',
      h(
        Link,
        {
          href: 'https://mixpanel.com/legal/privacy-policy/',
        },
        'https://mixpanel.com/legal/privacy-policy/',
      ),
    ),
    paragraph('Sentry'),
    paragraph(
      'Sentry is a service that will help us to monitor and fix bugs/crashes in the app.',
    ),
    paragraph(
      'For more information visit:\xA0',
      h(
        Link,
        {
          href: 'https://sentry.io/privacy/',
        },
        'https://sentry.io/privacy/',
      ),
    ),
    paragraph(h('strong', null, 'Links To Other Sites')),
    paragraph(
      "Our Service may contain links to other sites that are not operated by us. If you click on a third party link, you will be directed to that third party's site. We strongly advise you to review the Privacy Policy of every site you visit.",
    ),
    paragraph(
      'We have no control over and assume no responsibility for the content, privacy policies or practices of any third party sites or services.',
    ),
    h('p', null, h('strong', null, h('span', null, 'Internet Activity'))),
    paragraph(
      'We periodically send out requests to GitHub.com servers to check for the latest app updates and to determine whether an internet connection is available.',
    ),
    paragraph(
      'You may "Opt-Out" of the "Auto App-update checks" by navigating to "Settings" option and disabling the "Enable auto-update check" button.',
    ),
    paragraph(
      'Please refer to\xA0',
      h(
        Link,
        {
          href: 'https://help.github.com/articles/github-privacy-statement/',
        },
        'https://help.github.com/articles/github-privacy-statement/',
      ),
      '\xA0for more information.',
    ),
    paragraph(h('strong', null, 'Plugins or Add-ons')),
    paragraph(
      'We have used ',
      website ? 'google-ga' : '"google-ga"',
      ' npm package to facilitate the Google analytics feature inside the app.',
    ),
    paragraph(h('strong', null, 'Crash Reports')),
    paragraph(
      'We have implemented a very powerful diagnostic tool to capture and report the Crash Reports and bug encountered by the application. The Crash Reports are stored inside your device as log files. These log files can be accessed by navigating to "',
      profileDir,
      '/logs/" folder. You may choose to send us these log files by selecting the "Help" menu > "Report Bugs" and clicking on the "EMAIL ERROR LOGS" buttons.',
    ),
    paragraph(h('strong', null, "Children's Privacy")),
    paragraph(
      'Our Service does not address anyone under the age of 18 ("Children").',
    ),
    paragraph(
      'We do not knowingly collect personally identifiable information from anyone under the age of 18. If you are a parent or guardian and you are aware that your Children has provided us with Personal Data, please contact us. If we become aware that we have collected Personal Data from children without verification of parental consent, we take steps to remove that information from our servers.',
    ),
    paragraph(h('strong', null, 'Changes To This Privacy Policy')),
    paragraph(
      'We may update our Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page.',
    ),
    paragraph(
      'You are advised to review this Privacy Policy periodically for any changes. Changes to this Privacy Policy are effective when they are posted on this page.',
    ),
    paragraph(h('strong', null, 'Contact Us')),
    paragraph(
      'If you have any questions about this Privacy Policy, please contact us:',
    ),
    paragraph(
      'By email:\xA0',
      h(
        Link,
        {
          href: `mailto:${authorEmail}`,
        },
        authorEmail,
      ),
    ),
    paragraph(
      'By visiting this page on the website:\xA0',
      h(
        Link,
        {
          href: `${contactUrl}`,
        },
        contactUrl,
      ),
    ),
  );
};
