import React, { lazy, Suspense } from 'react';
import LoadingIndicator from '../components/LoadingIndicator';
import { HashRouter, Route, Routes } from 'react-router-dom';
import AppUpdatePageUpdateAvailable from '../containers/AppUpdatePage/UpdateAvailable';
import AppUpdatePageUpdateProgress from '../containers/AppUpdatePage/UpdateProgress';

const HomePage = lazy(() => import('../containers/HomePage'));
const ReportBugsPage = lazy(() => import('../containers/ReportBugsPage'));
const PrivacyPolicyPage = lazy(() => import('../containers/PrivacyPolicyPage'));
const AppFeaturesPage = lazy(() => import('../containers/AppFeaturesPage'));
const KeyboardShortcutsPage = lazy(
  () => import('../containers/KeyboardShortcutsPage'),
);
const NotFoundPage = lazy(() => import('../containers/NotFoundPage'));
const FaqsPage = lazy(() => import('../containers/HelpFaqsPage'));

export const routes = {
  Home: {
    path: '/',
    component: HomePage,
  },
  ReportBugsPage: {
    path: '/reportBugsPage',
    component: ReportBugsPage,
  },
  AppUpdatePageUpdateProgress: {
    path: '/appUpdatePage/updateProgress',
    component: AppUpdatePageUpdateProgress,
  },
  AppUpdatePageUpdateAvailable: {
    path: '/appUpdatePage/updateAvailable',
    component: AppUpdatePageUpdateAvailable,
  },
  PrivacyPolicyPage: {
    path: '/privacyPolicyPage',
    component: PrivacyPolicyPage,
  },
  FaqsPage: {
    path: '/faqsPage',
    component: FaqsPage,
  },
  HelpPhoneNotConnectingPage: {
    path: '/helpPhoneNotConnectingPage',
    component: FaqsPage,
    props: {
      showPhoneNotRecognizedNote: true,
    },
  },
  AppFeaturesPage: {
    path: '/appFeaturesPage',
    component: AppFeaturesPage,
  },
  KeyboardShortcutsPage: {
    path: '/keyboardShortcutsPage',
    component: KeyboardShortcutsPage,
  },
  NotFound: {
    path: '*',
    component: NotFoundPage,
  },
};

export default function () {
  return (
    <HashRouter>
      <Suspense fallback={<LoadingIndicator />}>
        <Routes>
          {Object.keys(routes).map((a) => {
            const route = routes[a];
            const { component: Component, path, props } = route;

            return (
              <Route
                key={path || 'notfound'}
                path={path}
                element={<Component {...props} />}
              />
            );
          })}
        </Routes>
      </Suspense>
    </HashRouter>
  );
}
