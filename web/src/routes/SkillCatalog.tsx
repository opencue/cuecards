import { Link } from "@tanstack/react-router";
import { useState } from "react";
import bundledSkills from "virtual:cue-bundled-skills";
import { filterPublicSkills, type PublicSkill } from "../bundled-skill-catalog";
import blogListings from "../fork-skill-listings.json";
import { forkSkillUrl, searchForkSkills } from "../skill-catalog";
import styles from "../studio/views/Welcome.module.css";

const pageSize = 36;
const forkCategory = "GitHub forks";
const blogRepo = "NagyVikt/claude-blog";
const reviewed = searchForkSkills();
const { commit: blogPin, ...blogSkills } = blogListings;
const catalog: (PublicSkill & { sourceUrl?: string; install?: string })[] = [
  ...bundledSkills,
  ...reviewed.map(skill => ({
    id: skill.id, name: skill.id, description: skill.description, category: forkCategory,
    source: skill.repo, sourceUrl: forkSkillUrl(skill), install: `cue skills catalog install ${skill.id}`,
  })),
  ...Object.entries(blogSkills).map(([id, description]) => ({
    id, name: id, description, category: forkCategory, source: blogRepo,
    sourceUrl: `https://github.com/${blogRepo}/tree/${blogPin}/skills/${id}`,
  })),
].sort((a, b) => a.id.localeCompare(b.id, "en"));
const categories = [...new Set(catalog.map(skill => skill.category))].sort((a, b) => a.localeCompare(b, "en"));

export function SkillCatalog() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState(pageSize);
  const skills = filterPublicSkills(catalog, query, category);

  return (
    <main className={`${styles.page} ${styles.catalog}`}>
      <Link to="/">← Cuecards home</Link>
      <h1>Skills</h1>
      <p className={styles.intro}>See what each public Cue skill does and browse skills from the featured GitHub forks.</p>
      <div className={styles.catalogFilters}>
        <div>
          <label htmlFor="skill-filter">Search skills</label>
          <input id="skill-filter" type="search" value={query} onChange={event => {
            setQuery(event.target.value);
            setLimit(pageSize);
          }} placeholder="e.g. publishing or animations" />
        </div>
        <div>
          <label htmlFor="skill-category">Category</label>
          <select id="skill-category" value={category} onChange={event => {
            setCategory(event.target.value);
            setLimit(pageSize);
          }}>
            <option value="">All categories</option>
            {categories.map(name => <option key={name}>{name}</option>)}
          </select>
        </div>
      </div>
      <p className={styles.note} role="status">{skills.length === 0 ? "No skills match your search." :
        `Showing ${Math.min(limit, skills.length)} of ${skills.length} ${skills.length === 1 ? "skill" : "skills"}.`}</p>
      <ul className={`${styles.steps} ${styles.catalogResults}`}>
        {skills.slice(0, limit).map(skill => (
          <li key={`${skill.source ?? "cue"}:${skill.id}`}>
            <section>
              <span className={styles.number}>{skill.source ?? skill.category}</span>
              <h2>{skill.name}</h2>
              <p>{skill.description}</p>
              {skill.sourceUrl && <a href={skill.sourceUrl}>View source for {skill.id} ↗</a>}
              {skill.install ? <code>{skill.install}</code> : skill.source ? <small>Browse only</small> : <code>{skill.id}</code>}
            </section>
          </li>
        ))}
      </ul>
      {limit < skills.length && <button type="button" className={styles.catalogMore} onClick={() => setLimit(limit + pageSize)}>Show more skills</button>}
    </main>
  );
}
