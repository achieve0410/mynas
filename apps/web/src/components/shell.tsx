import { useQuery } from "@tanstack/react-query";
import {
  Album,
  Ellipsis,
  Files,
  Gauge,
  HardDrive,
  Image,
  LogOut,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";
import { type ComponentType, type ReactNode, useEffect, useRef, useState } from "react";

import { api } from "../api";
import { navigate } from "../router";

type NavigationItem = {
  readonly icon: ComponentType<{ readonly size?: number; readonly strokeWidth?: number }>;
  readonly label: string;
  readonly path: string;
  readonly testId?: string;
};

const navigation: readonly NavigationItem[] = [
  { icon: Gauge, label: "Overview", path: "/" },
  { icon: HardDrive, label: "Storage", path: "/storage" },
  { icon: Files, label: "Files", path: "/files" },
  { icon: Image, label: "Photos", path: "/photos", testId: "nav-photos" },
  { icon: Album, label: "Albums", path: "/albums", testId: "nav-albums" },
  { icon: Settings, label: "Settings", path: "/settings", testId: "nav-settings" },
];

type ShellProps = {
  readonly children: ReactNode;
  readonly onLogout: () => void;
  readonly path: string;
};

const NavItem = ({
  item,
  mobile = false,
  onNavigate,
  path,
}: {
  readonly item: NavigationItem;
  readonly mobile?: boolean;
  readonly onNavigate?: () => void;
  readonly path: string;
}) => {
  const selected = path === item.path;
  const Icon = item.icon;
  return (
    <a
      aria-current={selected ? "page" : undefined}
      aria-label={item.label}
      className="nav-item"
      data-testid={
        item.testId === undefined ? undefined : mobile ? `${item.testId}-mobile` : item.testId
      }
      href={item.path}
      onClick={(event) => {
        event.preventDefault();
        navigate(item.path);
        onNavigate?.();
      }}
      title={item.label}
    >
      <Icon size={18} strokeWidth={1.8} />
      <span>{item.label}</span>
    </a>
  );
};

export const AppShell = ({ children, onLogout, path }: ShellProps) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenu = useRef<HTMLDialogElement>(null);
  const mobileMenuTrigger = useRef<HTMLButtonElement>(null);
  const serviceHealth = useQuery({ queryFn: api.getHealth, queryKey: ["service-health"] });
  const mobilePrimary = navigation.filter(({ path: itemPath }) =>
    ["/", "/files", "/photos"].includes(itemPath),
  );
  const mobileSecondary = navigation.filter(({ path: itemPath }) =>
    ["/storage", "/albums", "/settings"].includes(itemPath),
  );
  const mobileMoreSelected = mobileSecondary.some(({ path: itemPath }) => itemPath === path);
  const closeMobileMenu = () => {
    mobileMenu.current?.close();
    setMobileMenuOpen(false);
    mobileMenuTrigger.current?.focus();
  };

  useEffect(() => {
    if (mobileMenuOpen) {
      mobileMenu.current?.showModal();
    }
    return () => {
      if (mobileMenu.current?.open) {
        mobileMenu.current.close();
      }
    };
  }, [mobileMenuOpen]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="wordmark">
          <span className="wordmark-mark">M</span>
          <span>MyNAS</span>
        </div>
        <nav aria-label="Primary navigation" className="primary-nav">
          {navigation.map((item) => (
            <NavItem item={item} key={item.path} path={path} />
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="status-dot-row">
            <ShieldCheck aria-hidden="true" size={16} />
            <span>Local service</span>
          </div>
          <button className="button quiet full-width" onClick={onLogout} type="button">
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">Private infrastructure</span>
            <strong>{navigation.find((item) => item.path === path)?.label ?? "MyNAS"}</strong>
          </div>
          <span className="service-badge">
            <span
              aria-hidden="true"
              className={`health-light ${serviceHealth.isError ? "offline" : ""}`}
            />
            {serviceHealth.isError
              ? "Service unavailable"
              : serviceHealth.isPending
                ? "Checking service"
                : "Local service ready"}
          </span>
        </header>
        <main id="main-content">{children}</main>
      </div>
      <nav aria-label="Mobile navigation" className="mobile-nav">
        {mobilePrimary.map((item) => (
          <NavItem item={item} key={item.path} mobile path={path} />
        ))}
        <button
          aria-current={mobileMoreSelected ? "page" : undefined}
          aria-expanded={mobileMenuOpen}
          aria-label="More navigation"
          className={`nav-item ${mobileMoreSelected ? "selected" : ""}`}
          data-testid="nav-more-mobile"
          onClick={() => setMobileMenuOpen(true)}
          ref={mobileMenuTrigger}
          type="button"
          title="More"
        >
          <Ellipsis size={18} />
          <span>More</span>
        </button>
      </nav>
      {mobileMenuOpen ? (
        <dialog
          aria-label="More navigation"
          className="mobile-menu"
          onCancel={(event) => {
            event.preventDefault();
            closeMobileMenu();
          }}
          ref={mobileMenu}
        >
          <div className="mobile-menu-panel">
            <header>
              <strong>More</strong>
              <button
                aria-label="Close more navigation"
                className="button icon-button quiet"
                onClick={closeMobileMenu}
                type="button"
              >
                <X size={18} />
              </button>
            </header>
            <nav aria-label="More destinations">
              {mobileSecondary.map((item) => (
                <NavItem
                  item={item}
                  key={item.path}
                  mobile
                  onNavigate={closeMobileMenu}
                  path={path}
                />
              ))}
            </nav>
            <button
              className="button quiet full-width"
              onClick={() => {
                closeMobileMenu();
                onLogout();
              }}
              type="button"
            >
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </dialog>
      ) : null}
    </div>
  );
};
