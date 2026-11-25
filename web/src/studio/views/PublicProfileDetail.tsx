import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { characterDetails, cueRepository, featuredCharacter } from "../../lib/public-profiles";
import { usePublicProfileRoster } from "../../lib/use-public-profile-roster";
import { PublicNav } from "./Welcome";
import layout from "./Welcome.module.css";
import styles from "./PublicMarket.module.css";

export function PublicProfileDetail() {
  const { id } = useParams({ from: "/profiles/$id" });
  return <ProfileDossier key={id} id={id} />;
}

function ProfileDossier({ id }: { id: string }) {
  const roster = usePublicProfileRoster();
  const profile = roster.data?.find(entry => entry.id === id);
  const member = featuredCharacter(id);
  const detail = member && characterDetails[member.profile];
  const name = member?.name ?? id;
  const command = `cue use ${id}`;
  const [notice, setNotice] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setNotice(`Copied: ${command}. Run it in your project.`);
    } catch {
      setNotice("Clipboard unavailable. Select and copy the displayed command.");
    }
  }

  return <div className={`${layout.site} ${layout.viewport}`}>
    <PublicNav current="market" />
    <main className={layout.section}>
      <Link to="/" search={{ view: "market" }} hash="roster">← All Cue profiles</Link>
      {profile ? <>
        <title>{`${name} | Cuecards`}</title>
        <div className={`${layout.detail} ${styles.profileDetail}`}>
          <div className={`${styles.cover} ${member ? styles.featured : ""}`}>
            {member
              ? <span className={`${layout.portrait} ${layout[member.portrait]}`} aria-hidden="true" />
              : <span className={styles.emblem} aria-hidden="true">{profile.icon}</span>}
          </div>
          <div className={layout.dossier}>
            <p className={layout.eyebrow}>{member?.role ?? "Official Cue profile"}</p>
            <h1>{name}</h1>
            <code className={styles.profileId}>{id}</code>
            {member && <ul className={layout.tags} aria-label="Specialties">{member.specialties.map(skill => <li key={skill}>{skill}</li>)}</ul>}
          </div>
        </div>
        <div className={layout.detail}>
          <div>
            <h2>What it does</h2>
            <p>{member?.summary ?? (profile.description || "See the profile source for its configuration and instructions.")}</p>
            {profile.extends.length > 0 && <p>Extends <code>{profile.extends.join(" + ")}</code></p>}
            {detail && <>
              <h2>When to use it</h2>
              <p>{detail.when}</p>
              <h2>Example prompt</h2>
              <blockquote>{detail.example}</blockquote>
            </>}
            <h2>Public skills</h2>
            {detail
              ? <ul>{detail.skills.map(([label, href]) => <li key={href}><a href={href}>{label} ↗</a></li>)}</ul>
              : <p>See the profile source for its skill list, or <Link to="/skills">browse the public skill catalog</Link>.</p>}
          </div>
          <div className={layout.loadout}>
            <h2>Use this profile</h2>
            <code>{command}</code>
            <div className={layout.links}>
              <button type="button" onClick={() => void copy()}>Copy command</button>
              <a href={`${cueRepository}/tree/main/profiles/${id}`}>Profile source ↗</a>
            </div>
            <p role="status">{notice}</p>
          </div>
        </div>
      </> : roster.isError
        ? <p role="alert">Profile roster unavailable. <a href={`${cueRepository}/tree/main/profiles`}>Browse profiles on GitHub ↗</a></p>
        : roster.isPending ? <p role="status">Loading Cue profile…</p> : <h1>Profile not found</h1>}
    </main>
  </div>;
}
