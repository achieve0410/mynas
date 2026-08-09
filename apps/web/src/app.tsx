import { useState } from "react";

import { api, SESSION_KEY, sessionToken } from "./api";
import { AppShell } from "./components/shell";
import { AlbumsPage } from "./pages/albums-page";
import { AuthPage } from "./pages/auth-page";
import { FilesPage } from "./pages/files-page";
import { OverviewPage } from "./pages/overview-page";
import { PhotosPage } from "./pages/photos-page";
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
    <AppShell
      onLogout={() => {
        void api
          .logout()
          .catch((error: unknown) => {
            console.error("Unable to revoke the server session during sign-out", error);
          })
          .finally(() => {
            window.localStorage.removeItem(SESSION_KEY);
            refreshSession();
          });
      }}
      path={path}
    >
      {pageFor(path)}
    </AppShell>
  );
};
