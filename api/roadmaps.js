// GET /api/roadmaps[?force=1] — proxy aman GitHub GraphQL + cache memori.
// Token (GITHUB_PAT) hanya dibaca dari environment server, tidak pernah ke browser.
// Cache: hasil GitHub disimpan di memori selama CACHE_TTL_SECONDS (default 720 = 12 menit).
// ?force=1 = lewati cache, tarik ulang (dipakai tombol "Sync Sekarang").

const GITHUB_GRAPHQL_ENDPOINT = 'https://api.github.com/graphql';
const CACHE_TTL_MS = (parseInt(process.env.CACHE_TTL_SECONDS || '720', 10) || 720) * 1000;

// Query sama persis dengan ROADMAP_QUERY di index.html (1 HTTP call per 50 repo).
// Builder + fallback: token lama tanpa scope Projects bisa tolak blok projectsV2.
const ROADMAP_QUERY_NODES_TAIL = `
        openIssues: issues(states: OPEN) { totalCount }
        closedIssues: issues(states: CLOSED) { totalCount }
        projectsV2(first: 10) {
          totalCount
          nodes {
            id
            title
            number
            url
            closed
            fieldValues(first: 20) {
              nodes {
                __typename
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field { ... on ProjectV2SingleSelectField { name } }
                }
                ... on ProjectV2ItemFieldDateValue {
                  date
                  field { ... on ProjectV2Field { name } }
                }
                ... on ProjectV2ItemFieldTextValue {
                  text
                  field { ... on ProjectV2Field { name } }
                }
              }
            }
            fields(first: 20) {
              nodes {
                __typename
                ... on ProjectV2SingleSelectField { name }
                ... on ProjectV2Field { name }
              }
            }
          }
        }`;

function buildRoadmapQuery(withProjectsV2) {
  const tail = withProjectsV2
    ? ROADMAP_QUERY_NODES_TAIL
    : `
        openIssues: issues(states: OPEN) { totalCount }
        closedIssues: issues(states: CLOSED) { totalCount }`;
  return `query GetAllProjectRoadmaps($cursor: String) {
  rateLimit {
    limit
    cost
    remaining
    resetAt
  }
  viewer {
    repositories(
      first: 50
      after: $cursor
      ownerAffiliations: [OWNER]
      isFork: false
      orderBy: { field: PUSHED_AT, direction: DESC }
    ) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
        description
        url
        isPrivate
        pushedAt
        updatedAt
        primaryLanguage {
          name
          color
        }
        milestones(first: 10, states: [OPEN, CLOSED], orderBy: { field: DUE_DATE, direction: ASC }) {
          totalCount
          nodes {
            id
            title
            state
            dueOn
            progressPercentage
            openIssues: issues(states: OPEN) { totalCount }
            closedIssues: issues(states: CLOSED) { totalCount }
          }
        }
        roadmapUpper: object(expression: "HEAD:ROADMAP.md") {
          ... on Blob { text }
        }
        roadmapLower: object(expression: "HEAD:roadmap.md") {
          ... on Blob { text }
        }
${tail}
      }
    }
  }
}`;
}

const ROADMAP_QUERY = buildRoadmapQuery(true);
const ROADMAP_QUERY_BASE = buildRoadmapQuery(false);

async function postGraphQLPage(pat, query, cursor) {
  const response = await fetch(GITHUB_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pat}`,
    },
    body: JSON.stringify({ query, variables: { cursor } }),
  });

  if (!response.ok) {
    throw new Error(`GitHub HTTP ${response.status}: token tidak valid / akses ditolak.`);
  }

  const result = await response.json();
  if (result.errors && result.errors.length > 0) {
    throw new Error(result.errors[0].message);
  }

  return result.data;
}

let cache = { at: 0, payload: null };

async function githubPagedFetch(pat) {
  let repos = [];
  let hasNextPage = true;
  let cursor = null;
  let latestRateLimit = null;

  while (hasNextPage) {
    let data;
    try {
      data = await postGraphQLPage(pat, ROADMAP_QUERY, cursor);
    } catch (e) {
      // Fallback v1.0 bila API tolak blok projectsV2 (token lama / tanpa scope Projects).
      if (!/projectsV2/i.test(String((e && e.message) || e))) throw e;
      data = await postGraphQLPage(pat, ROADMAP_QUERY_BASE, cursor);
    }

    latestRateLimit = data.rateLimit;
    const page = data.viewer.repositories;
    repos = repos.concat(page.nodes || []);
    hasNextPage = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
  }

  return { rateLimit: latestRateLimit, repos };
}

async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'METHOD', message: 'Gunakan GET.' });
    return;
  }

  const pat = process.env.GITHUB_PAT;
  if (!pat) {
    res.status(503).json({
      error: 'NO_TOKEN',
      message: 'Server belum punya token (GITHUB_PAT kosong). Pakai Mode Demo atau input token manual.',
    });
    return;
  }

  const force = req.query && (req.query.force === '1' || req.query.force === 'true');
  const fresh = Date.now() - cache.at < CACHE_TTL_MS;

  if (!force && fresh && cache.payload) {
    res.status(200).json(Object.assign({}, cache.payload, { cached: true }));
    return;
  }

  try {
    const { rateLimit, repos } = await githubPagedFetch(pat);
    const payload = {
      ok: true,
      cached: false,
      cachedAt: new Date().toISOString(),
      rateLimit,
      totalCount: repos.length,
      repos,
    };
    cache = { at: Date.now(), payload: Object.assign({}, payload) };
    res.status(200).json(payload);
  } catch (err) {
    res.status(502).json({ error: 'UPSTREAM', message: String((err && err.message) || err) });
  }
}

handler._test = { ROADMAP_QUERY, ROADMAP_QUERY_BASE, buildRoadmapQuery, githubPagedFetch };

module.exports = handler;
