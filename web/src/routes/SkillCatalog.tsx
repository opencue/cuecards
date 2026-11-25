import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { forkSkillUrl, searchForkSkills } from "../skill-catalog";
import styles from "../studio/views/Welcome.module.css";

export function SkillCatalog() {
  const [query, setQuery] = useState("");
  const skills = searchForkSkills(query);

  return (
    <main className={`${styles.page} ${styles.catalog}`}>
      <Link to="/">← Cuecards home</Link>
      <h1>Skills</h1>
      <p className={styles.intro}>See what each skill does, review its source, and install it with Cue. This collection covers selected GitHub forks, not all bundled Cue skills.</p>
      <label htmlFor="skill-filter">Search skills</label>
      <input id="skill-filter" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="e.g. publishing or animations" />
      <p className={styles.note} role="status">{skills.length === 0 ? "No skills match your search." : `${skills.length} ${skills.length === 1 ? "skill" : "skills"}`}</p>
      <ul className={`${styles.steps} ${styles.catalogResults}`}>
        {skills.map(skill => (
          <li key={skill.id}>
            <section>
              <span className={styles.number}>{skill.repo}</span>
              <h2>{skill.id}</h2>
              <p>{skill.description}</p>
              <a href={forkSkillUrl(skill)}>View source for {skill.id} ↗</a>
              <code>cue skills catalog install {skill.id}</code>
            </section>
          </li>
        ))}
      </ul>
    </main>
  );
}
