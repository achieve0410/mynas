import { BookOpen, CheckCircle2, Settings2, Sparkles } from "lucide-react";
import { useState } from "react";

type GuideTopic = {
  readonly key: "activity" | "albums" | "files" | "overview" | "photos" | "settings" | "storage";
  readonly purpose: string;
  readonly setup: string;
  readonly title: string;
  readonly verification: string;
};

const topics: readonly GuideTopic[] = [
  {
    key: "overview",
    purpose: "See service health, mirror protection, and the actions that need attention.",
    setup: "Complete owner setup and create a two-member mirror volume.",
    title: "Overview",
    verification: "Confirm the service, both backends, and the mirror report healthy.",
  },
  {
    key: "storage",
    purpose: "Connect two independent backends and keep every protected byte mirrored.",
    setup: "Add each backend, then create a volume with one distinct member from each device.",
    title: "Storage",
    verification: "Confirm both members report healthy and repair is available when needed.",
  },
  {
    key: "files",
    purpose: "Browse folders, search protected files, inspect versions, and recover originals.",
    setup: "Choose a healthy mirror volume, then upload files or a folder.",
    title: "Files",
    verification: "Refresh the catalog, find the filename, and confirm both replicas are healthy.",
  },
  {
    key: "photos",
    purpose: "Browse searchable previews while original JPEG, PNG, and HEIC files stay mirrored.",
    setup: "Keep the photos mirror healthy, then choose individual photos or a photo folder.",
    title: "Photos",
    verification: "Open a preview, inspect its checksum, and download the original.",
  },
  {
    key: "albums",
    purpose: "Collect selected photos without duplicating their protected originals.",
    setup: "Select photos in the Photos menu and create a named album.",
    title: "Albums",
    verification: "Open the album and compare its item count with the selected photos.",
  },
  {
    key: "activity",
    purpose: "Review durable transfer successes and clear failure reasons from browser or CLI use.",
    setup: "No setup is required; authenticated transfer outcomes are recorded automatically.",
    title: "Activity",
    verification:
      "Filter failed outcomes, refresh, and confirm the newest operation appears first.",
  },
  {
    key: "settings",
    purpose: "Manage maintenance policy, API access, password, and service details.",
    setup: "Choose schedules and credentials that fit the devices using this private NAS.",
    title: "Settings",
    verification: "Save one setting, refresh, and confirm the persisted value is shown.",
  },
];

export const GuidePage = () => {
  const [activeKey, setActiveKey] = useState<GuideTopic["key"]>("overview");
  const active = topics.find(({ key }) => key === activeKey) ?? topics[0];

  return (
    <div className="page guide-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Owner handbook</span>
          <h1>Guide</h1>
          <p>Learn what each menu does, how to set it up, and how to confirm it is working.</p>
        </div>
        <BookOpen aria-hidden="true" size={30} />
      </header>

      <div className="guide-layout">
        <nav aria-label="Guide topics" className="guide-topics">
          {topics.map((topic) => (
            <button
              aria-current={activeKey === topic.key ? "page" : undefined}
              data-testid={`guide-topic-${topic.key}`}
              key={topic.key}
              onClick={() => setActiveKey(topic.key)}
              type="button"
            >
              {topic.title}
            </button>
          ))}
        </nav>
        {active === undefined ? null : (
          <article
            className="section-block guide-panel"
            data-active="true"
            data-testid={`guide-panel-${active.key}`}
          >
            <span className="eyebrow">Menu guide</span>
            <h2>{active.title}</h2>
            <section data-section-key="purpose">
              <Sparkles aria-hidden="true" size={20} />
              <div>
                <h3>What it does</h3>
                <p>{active.purpose}</p>
              </div>
            </section>
            <section data-section-key="setup">
              <Settings2 aria-hidden="true" size={20} />
              <div>
                <h3>How to set it up</h3>
                <p>{active.setup}</p>
              </div>
            </section>
            <section data-section-key="verification">
              <CheckCircle2 aria-hidden="true" size={20} />
              <div>
                <h3>How to check it</h3>
                <p>{active.verification}</p>
              </div>
            </section>
          </article>
        )}
      </div>
    </div>
  );
};
