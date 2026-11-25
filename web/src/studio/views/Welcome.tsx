import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { crew, cueRepository as repository, profileTasks, type ProfileTask } from "../../lib/public-profiles";
import styles from "./Welcome.module.css";

export function PublicNav({ current }: { current: "home" | "skills" | "market" }) {
  return (
    <header className={styles.header}>
      <Link className={styles.brand} to="/" search={{}} activeOptions={{ exact: true }} aria-label="Cuecards home"><span aria-hidden="true">C</span> cuecards</Link>
      <nav aria-label="Public navigation">
        <Link to="/" search={{}} hash="crew" activeOptions={{ includeHash: true }}>Crew</Link>
        <Link to="/skills" aria-current={current === "skills" ? "page" : undefined}>Skills</Link>
        <Link to="/" search={{ view: "market" }} aria-current={current === "market" ? "page" : undefined}>Marketplace</Link>
        <Link to="/" search={{}} hash="setup" activeOptions={{ includeHash: true }}>Setup</Link>
      </nav>
      <a className={styles.github} href={repository}>GitHub <span aria-hidden="true">↗</span></a>
    </header>
  );
}

export function Welcome({ onBrowse }: { onBrowse?: () => void }) {
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState(0);
  const character = crew[selected] ?? crew[0];
  const command = `cue use ${character.profile}`;
  async function copy(command: string) {
    try {
      await navigator.clipboard.writeText(command);
      setNotice("Command copied. Review it, then run it in your terminal.");
    } catch {
      setNotice("Clipboard unavailable. Select and copy the command below.");
    }
  }
  return (
    <div className={`${styles.site} ${onBrowse ? "" : styles.viewport}`}>
      {!onBrowse && <PublicNav current="home" />}
      <main>
        <section className={styles.hero} aria-labelledby="welcome-heading">
          <img className={styles.heroArt} src="/cuecards-coast.webp" alt="" fetchPriority="high" />
          <div className={styles.heroInner}>
            <p className={styles.eyebrow}><span /> The Cue community</p>
            <h1 id="welcome-heading">Build your<br /><em>crew.</em></h1>
            <p className={styles.intro}>Give your coding agent the right skills, tools, and instructions. Pick a profile built for the job and run it locally with Cue.</p>
            <div className={styles.actions}>
              <Link className={styles.primary} to="/" search={onBrowse ? { view: "welcome" } : {}} hash="crew">Choose your character <span aria-hidden="true">↓</span></Link>
              <Link className={styles.secondary} to="/skills">Browse skills <span aria-hidden="true">↗</span></Link>
            </div>
          </div>
          <span className={styles.heroCaption} aria-hidden="true">01 / CUE COAST</span>
        </section>

        {!onBrowse && <section className={styles.section} aria-labelledby="task-heading">
          <div className={styles.sectionHead}>
            <div><p className={styles.eyebrow}>Start with a task</p><h2 id="task-heading">What are you working on?</h2></div>
          </div>
          <div className={styles.actions}>
            {(Object.keys(profileTasks) as ProfileTask[]).map(task => (
              <Link key={task} className={styles.secondary} to="/" search={{ view: "market", task }} hash="roster">
                {profileTasks[task].label} <span aria-hidden="true">↗</span>
              </Link>
            ))}
          </div>
        </section>}

        <section className={styles.section} id="crew" aria-labelledby="crew-heading">
          <div className={styles.sectionHead}>
            <div><p className={styles.eyebrow}>01 / Agent profiles</p><h2 id="crew-heading">The crew.</h2></div>
            <p>Four profiles, four ways to work. Select a character to see what their Cue profile brings to your project.</p>
          </div>
          <div className={styles.crew} role="group" aria-label="Featured Cue profiles">
            {crew.map((member, index) => (
              <button key={member.profile} type="button" aria-pressed={selected === index} aria-controls="crew-detail" onClick={() => { setSelected(index); setNotice(""); }} className={styles.character}>
                <span className={`${styles.portrait} ${styles[member.portrait]}`} aria-hidden="true" />
                <span className={styles.characterIndex} aria-hidden="true">0{index + 1}</span>
                {selected === index && <span className={styles.selected} aria-hidden="true">Selected</span>}
                <span className={styles.characterLabel}><strong>{member.name}</strong><small>{member.role}</small></span>
              </button>
            ))}
          </div>
          <div className={styles.detail} id="crew-detail">
            <div aria-live="polite">
              <div className={styles.dossier} key={character.profile}>
                <p className={styles.eyebrow}>{character.role} / Cue profile</p>
                <h3>{character.name}</h3>
                <p>{character.summary}</p>
                <ul className={styles.tags} aria-label="Specialties">{character.specialties.map(skill => <li key={skill}>{skill}</li>)}</ul>
              </div>
            </div>
            <div className={styles.loadout}>
              <p className={styles.eyebrow}>Run in your project</p>
              <code>{command}</code>
              <div className={styles.links}>
                <button type="button" onClick={() => void copy(command)}>Copy command</button>
                {!onBrowse && <Link to="/profiles/$id" params={{ id: character.profile }}>Meet {character.name} ↗</Link>}
                <a href={`${repository}/tree/main/profiles/${character.profile}`}>Profile source ↗</a>
              </div>
            </div>
          </div>
          <div className={styles.links}>
            {onBrowse ? <button type="button" onClick={onBrowse}>Browse community profiles</button> : <Link to="/" search={{ view: "market" }}>Explore all profile cards ↗</Link>}
            <a href={`${repository}/tree/main/profiles`}>All bundled profiles on GitHub ↗</a>
          </div>
        </section>

        <section className={styles.section} id="setup" aria-labelledby="setup-heading">
          <div className={styles.sectionHead}>
            <div><p className={styles.eyebrow}>02 / Set up Cue</p><h2 id="setup-heading">Ready to run?</h2></div>
            <p>Install the CLI, run setup in your project, then select a profile. This site never connects to your local machine.</p>
          </div>
          <div className={styles.steps}>
            <section><span className={styles.eyebrow}>01 / Install</span><h3>Get the CLI</h3><code>npm install -g cue-ai</code><button type="button" onClick={() => void copy("npm install -g cue-ai")}>Copy install command</button></section>
            <section><span className={styles.eyebrow}>02 / Configure</span><h3>Set up your project</h3><code>cue setup</code><button type="button" onClick={() => void copy("cue setup")}>Copy setup command</button></section>
            <section><span className={styles.eyebrow}>03 / Inspect</span><h3>Open local Studio</h3><code>cue dashboard</code><button type="button" onClick={() => void copy("cue dashboard")}>Copy dashboard command</button><a href="http://127.0.0.1:7891" target="_blank" rel="noopener noreferrer">Open after starting Cue ↗</a></section>
          </div>
          <p className={styles.note}>Review third-party tools before running them. Community hooks, skills and MCP servers can execute code.</p>
        </section>
        <div className={styles.status} role="status">{notice}</div>
      </main>
      <footer className={styles.footer}><span>Cuecards · The Cue community</span><a href={repository}>Open source on GitHub ↗</a></footer>
    </div>
  );
}
