import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { fetcher } from "../../lib/fetcher";
import { crew, cueRepository, featuredCharacter, filterPublicProfiles, type ProfileFilter, type PublicProfile } from "../../lib/public-profiles";
import { MarketView } from "./Market";
import { PublicNav } from "./Welcome";
import layout from "./Welcome.module.css";
import styles from "./PublicMarket.module.css";

const pageSize = 12;
const filters: { value: ProfileFilter; label: string }[] = [
  { value: "all", label: "All profiles" },
  { value: "featured", label: "Featured characters" },
  { value: "bundled", label: "Standard profiles" },
  { value: "extensions", label: "AAS extensions" },
];

function ProfileCard({ profile, onCopy }: { profile: PublicProfile; onCopy: (command: string) => void }) {
  const member = featuredCharacter(profile.id);
  const extension = profile.id.startsWith("aas-");
  const command = `cue use ${profile.id}`;
  return (
    <article className={styles.card}>
      <div className={`${styles.cover} ${member ? styles.featured : ""}`}>
        {member
          ? <span className={`${layout.portrait} ${layout[member.portrait]}`} aria-hidden="true" />
          : <span className={styles.emblem} aria-hidden="true">{profile.icon}</span>}
        <span className={styles.badge}>{member ? "Featured crew" : extension ? "AAS extension" : "Cue profile"}</span>
        {member && <span className={styles.role}>{member.role}</span>}
      </div>
      <div className={styles.cardBody}>
        <h3>{member?.name ?? profile.id.replaceAll("-", " ")}</h3>
        <code className={styles.profileId}>{profile.id}</code>
        <p>{member?.summary ?? (profile.description || "View the source for this profile’s configuration and instructions.")}</p>
        <details className={styles.loadout}>
          <summary aria-label={`View loadout for ${member?.name ?? profile.id}`}>View loadout</summary>
          <div>
            {member && <ul className={layout.tags} aria-label="Specialties">{member.specialties.map(skill => <li key={skill}>{skill}</li>)}</ul>}
            {profile.extends.length > 0 && <p>Extends <code>{profile.extends.join(" + ")}</code></p>}
            <code className={styles.command}>{command}</code>
            <div className={layout.links}>
              <button type="button" onClick={() => onCopy(command)}>Copy command</button>
              <a href={`${cueRepository}/tree/main/profiles/${profile.id}`}>Inspect source ↗</a>
            </div>
          </div>
        </details>
      </div>
    </article>
  );
}

export function PublicMarket() {
  const roster = useQuery({
    queryKey: ["public-profile-roster"],
    queryFn: () => fetcher<PublicProfile[]>("/profile-roster"),
    staleTime: Infinity,
    retry: false,
  });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ProfileFilter>("all");
  const [limit, setLimit] = useState(pageSize);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  const all = roster.data ?? [];
  const featured = crew.flatMap(member => all.filter(profile => profile.id === member.profile));
  const remaining = all.filter(profile => !featuredCharacter(profile.id));
  const visible = filterPublicProfiles([
    ...featured, ...remaining.filter(profile => !profile.id.startsWith("aas-")), ...remaining.filter(profile => profile.id.startsWith("aas-")),
  ], query, filter);
  async function copy(command: string) {
    try {
      await navigator.clipboard.writeText(command);
      setNotice(`Copied: ${command}. Run it in your project.`);
    } catch {
      setNotice("Clipboard unavailable. Select and copy the displayed command.");
    }
  }
  return (
    <div className={`${layout.site} ${layout.viewport} ${layout.marketplace}`}>
      <PublicNav current="market" />
      <main>
        <section className={styles.hero} aria-labelledby="market-title">
          <img src="/cuecards-market.webp" alt="" fetchPriority="high" className={styles.heroArt} />
          <div className={`${layout.section} ${styles.heroCopy}`}>
            <p className={layout.eyebrow}><span /> Cue Coast / Marketplace</p>
            <h1 id="market-title">Find your<br /><em>next specialist.</em></h1>
            <p className={layout.intro}>Explore the complete Cue profile roster. Compare specialties, open a loadout, and bring the right skills to your project.</p>
            <div className={layout.actions}>
              <Link className={layout.primary} to="/" search={{ view: "market" }} hash="roster">Explore profiles <span aria-hidden="true">↓</span></Link>
              <Link className={layout.secondary} to="/" search={{ view: "market" }} hash="community">Community listings <span aria-hidden="true">↘</span></Link>
            </div>
          </div>
        </section>
        <section className={`${layout.section} ${styles.roster}`} id="roster" aria-labelledby="roster-title">
          <div className={layout.sectionHead}>
            <div><p className={layout.eyebrow}>01 / Official Cue profiles</p><h2 id="roster-title">The roster.</h2></div>
            <p>Start with a featured character, or search by a tool, stack, or job. Profiles run through Cue on your machine.</p>
          </div>
          <div className={`${layout.catalogFilters} ${styles.filters}`}>
            <div>
              <label htmlFor="roster-search">Search Cue profiles</label>
              <input type="search" id="roster-search" placeholder="e.g. REST API, React, or deployment" value={query} onChange={e => { setQuery(e.target.value); setLimit(pageSize); }} />
            </div>
            <div>
              <label htmlFor="roster-type">Profile type</label>
              <select id="roster-type" value={filter} onChange={e => {
                const option = filters.find(entry => entry.value === e.target.value);
                if (option) { setFilter(option.value); setLimit(pageSize); }
              }}>{filters.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select>
            </div>
          </div>
          {roster.isError
            ? <p className={layout.note} role="alert">Profile roster unavailable. <a href={`${cueRepository}/tree/main/profiles`}>Browse the profile sources on GitHub ↗</a></p>
            : <p className={styles.results} role="status">{roster.isPending ? "Loading Cue profiles…" : visible.length ? `Showing ${Math.min(limit, visible.length)} of ${visible.length} Cue profiles` : "No Cue profiles match your search."}</p>}
          <div className={styles.grid}>{visible.slice(0, limit).map(profile => <ProfileCard key={profile.id} profile={profile} onCopy={command => void copy(command)} />)}</div>
          {limit < visible.length && <button type="button" className={layout.catalogMore} onClick={() => setLimit(n => n + pageSize)}>Show more profiles</button>}
        </section>
        <section className={styles.community} id="community" aria-label="Community listings">
          <MarketView />
        </section>
        <div className={layout.status} role="status">{notice}</div>
      </main>
      <footer className={layout.footer}><span>Cuecards · Cue Coast</span><a href={cueRepository}>Open source on GitHub ↗</a></footer>
    </div>
  );
}
