import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { characterDetails, cueRepository, featuredCharacter, profilePublicSkills } from "../../lib/public-profiles";
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
  const skills = profile && roster.data ? profilePublicSkills(profile, roster.data) : undefined;
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
            <h2>When to use it</h2>
            <p>{detail?.when ?? `Choose ${id} when you need its specialty${skills?.direct[0] ? `, such as ${skills.direct[0].label}` : ""}. Start with one task and check the listed skills against what the project needs.`}</p>
            <h2>Example prompt</h2>
            <blockquote>{detail?.example ?? `Review my repository using the ${id} profile. Identify one improvement that fits this profile and propose a way to verify it before making changes.`}</blockquote>
            <h2>Public skills</h2>
            {skills && <>
              <SkillLinks label="Direct skills" skills={skills.direct} />
              <SkillLinks label="Inherited skills" skills={skills.inherited} />
            </>}
            <p>Only verified public skill links are shown. See the profile source for the full configuration, or <Link to="/skills">browse the public skill catalog</Link>.</p>
          </div>
          <div className={layout.loadout}>
            <h2>Use this profile</h2>
            <p><Link to="/" search={{}} hash="setup">Install Cue</Link>, then run this in your project:</p>
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

function SkillLinks({ label, skills }: { label: string; skills: { label: string; href: string }[] }) {
  return <details className={styles.loadout}>
    <summary>{label} ({skills.length})</summary>
    {skills.length ? <ul>{skills.map(skill => <li key={skill.href}><a href={skill.href}>{skill.label} ↗</a></li>)}</ul>
      : <p>No public skills to list.</p>}
  </details>;
}
