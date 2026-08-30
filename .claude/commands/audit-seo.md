---
description: Audit cuecards SEO health — check titles, descriptions, JSON-LD, robots.txt, and sitemap against content/seo/*.yml
---

# /audit-seo — SEO Health Check for cuecards

Audit the cuecards repo for SEO completeness and correctness.

## What to check

### 1. JSON-LD structured data in README.md
- Verify `<script type="application/ld+json">` block is NOT inside an HTML comment
- Validate JSON parses cleanly: `python3 -c "import json; json.loads(open('README.md').read().split('application/ld+json\">')[1].split('</script>')[0])"`
- Check `@type`, `name`, `description`, `url`, `codeRepository`, `offers` are all present

### 2. web/public/robots.txt
- Exists: `test -f web/public/robots.txt`
- Contains `Sitemap:` directive pointing to sitemap.xml
- Does not disallow `/` globally

### 3. web/public/sitemap.xml
- Exists: `test -f web/public/sitemap.xml`
- Valid XML: `python3 -c "import xml.etree.ElementTree as ET; ET.parse('web/public/sitemap.xml')"`
- All `<loc>` URLs use HTTPS

### 4. web/public/llms.txt
- Exists and contains the product name and at least one `## ` section

### 5. content/seo/ completeness
- All 5 files present: `ls content/seo/ | wc -l` = 5
- `keywords.yml` has at least 3 clusters
- `page-titles.yml` covers home, getting_started, faq at minimum
- `meta-descriptions.yml` ≤ 155 chars per entry: check with
  `python3 -c "import yaml; d=yaml.safe_load(open('content/seo/meta-descriptions.yml')); [print(k,len(v)) for k,v in d['pages'].items() if len(v)>155]"`

### 6. content/geo/ completeness
- All 5 files present: `ls content/geo/ | wc -l` = 5
- `entity-profile.json` validates: `python3 -m json.tool content/geo/entity-profile.json > /dev/null`

## Report format

Output a table:

| Check | Status | Notes |
|---|---|---|
| JSON-LD live in README | ✅/❌ | ... |
| robots.txt | ✅/❌ | ... |
| sitemap.xml | ✅/❌ | ... |
| llms.txt (web) | ✅/❌ | ... |
| content/seo/ (5 files) | ✅/❌ | ... |
| content/geo/ (5 files) | ✅/❌ | ... |
| meta-descriptions ≤155 | ✅/❌ | list any violations |

End with a prioritised fix list for any ❌ items.
