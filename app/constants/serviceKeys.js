// Supply credentials for this fork explicitly; never send to upstream accounts.
export const SERVICE_KEYS = {
  sentryDsn: process.env.OPENMTP_SENTRY_DSN || '',
  mixpanelAnalytics: process.env.OPENMTP_MIXPANEL_TOKEN || '',
};
