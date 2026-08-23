import { useState } from "react";

import { api, SESSION_KEY, sessionToken } from "./api";
import { AppShell } from "./components/shell";
import { TransferProvider } from "./components/transfer-provider";
import { ActivityPage } from "./pages/activity-page";
import { AlbumsPage } from "./pages/albums-page";
import { AuthPage } from "./pages/auth-page";
import { FilesPage } from "./pages/files-page";
import { GuidePage } from "./pages/guide-page";
import { OverviewPage } from "./pages/overview-page";
import { PhotosPage } from "./pages/photos-page";
import { ProtectionPage } from "./pages/protection-page";
import { SettingsPage } from "./pages/settings-page";
import { StoragePage } from "./pages/storage-page";
import { usePathname } from "./router";

const pageFor = (path: string) => {
  switch (path) {
    case "/storage":
      return <StoragePage />;
    case "/files":
      return <FilesPage />;
    case "/photos":
      return <PhotosPage />;
    case "/albums":
      return <AlbumsPage />;
    case "/activity":
      return <ActivityPage />;
    case "/protection":
      return <ProtectionPage />;
    case "/guide":
      return <GuidePage />;
    case "/settings":
      return <SettingsPage />;
    default:
      return <OverviewPage />;
  }
};

export const App = () => {
  const path = usePathname();
  const [, setSessionRevision] = useState(0);
  const refreshSession = () => setSessionRevision((revision) => revision + 1);

  if (sessionToken() === null) {
    return <AuthPage onAuthenticated={refreshSession} />;
  }

  return (
    <TransferProvider>
      <AppShell
        onLogout={() => {
          void api
            .logout()
            .then(() => {
              window.localStorage.removeItem(SESSION_KEY);
              refreshSession();
            })
            .catch((error: unknown) => {
              const message = error instanceof Error ? error.message : "unknown error";
              window.alert(`Sign-out failed; this session is still active. ${message}`);
            });
        }}
        path={path}
      >
        {pageFor(path)}
      </AppShell>
    </TransferProvider>
  );
};
