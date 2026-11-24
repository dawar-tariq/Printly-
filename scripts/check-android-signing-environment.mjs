#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

// This one-off review build is deliberately limited to the current working
// branch. A future release process must review and update these constraints.
export const SIGNING_REPOSITORY = 'dawar-tariq/Printly-';
export const SIGNING_BRANCH = 'arena/309fdf51-printly';
export const SIGNING_ENVIRONMENT = 'printly-owner-signing';

export function validateSigningEnvironment({ repository, repositoryInfo, ref, event, environment, policies }) {
  if (repository !== SIGNING_REPOSITORY || ref !== `refs/heads/${SIGNING_BRANCH}` || !['push', 'workflow_dispatch'].includes(event)) {
    throw new Error('The signing request is not from the authorized repository and branch.');
  }
  // Some GitHub plans ignore environment protections after conversion to a
  // private repository. This review workflow is intentionally public-only.
  if (repositoryInfo?.full_name !== SIGNING_REPOSITORY || repositoryInfo?.private !== false || repositoryInfo?.visibility !== 'public') {
    throw new Error('This review workflow requires the verified public repository.');
  }
  if (!environment || environment.name !== SIGNING_ENVIRONMENT) {
    throw new Error('The protected signing environment is missing.');
  }
  // GitHub currently includes this field in the REST response. Fail closed if
  // it is absent: an administrator must also check the setting in the UI.
  if (environment.can_admins_bypass !== false) {
    throw new Error('Disable administrator bypass for the signing environment before requesting a build.');
  }
  const reviewers = Array.isArray(environment.protection_rules)
    ? environment.protection_rules.find((rule) => rule?.type === 'required_reviewers')?.reviewers : null;
  if (!Array.isArray(reviewers) || reviewers.length === 0 || !reviewers.every((entry) => ['User', 'Team'].includes(entry?.type) && entry?.reviewer && Number.isSafeInteger(entry.reviewer.id) && entry.reviewer.id > 0)) {
    throw new Error('The signing environment must require at least one valid reviewer.');
  }
  if (environment.deployment_branch_policy?.custom_branch_policies !== true || environment.deployment_branch_policy?.protected_branches !== false) {
    throw new Error('The signing environment must use selected branch restrictions.');
  }
  const branches = policies?.branch_policies;
  if (policies?.total_count !== 1 || !Array.isArray(branches) || branches.length !== 1 || branches[0]?.name !== SIGNING_BRANCH) {
    throw new Error('Allow only the exact reviewed working branch in the signing environment.');
  }
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('The read-only GitHub Actions token is unavailable.');
  const repository = process.env.GITHUB_REPOSITORY;
  const ref = process.env.GITHUB_REF;
  const event = process.env.GITHUB_EVENT_NAME;
  // Do not send the token to any host or repository selected by untrusted input.
  if (repository !== SIGNING_REPOSITORY || ref !== `refs/heads/${SIGNING_BRANCH}` || !['push', 'workflow_dispatch'].includes(event)) {
    throw new Error('The signing request is not from the authorized repository and branch.');
  }
  const repositoryUrl = `https://api.github.com/repos/${SIGNING_REPOSITORY}`;
  const environmentUrl = `${repositoryUrl}/environments/${SIGNING_ENVIRONMENT}`;
  const getJson = async (url) => {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
    if (!response.ok) throw new Error(`Could not verify signing-environment protections (GitHub HTTP ${response.status}).`);
    return response.json();
  };
  const repositoryInfo = await getJson(repositoryUrl);
  const environment = await getJson(environmentUrl);
  const policies = await getJson(`${environmentUrl}/deployment-branch-policies?per_page=100`);
  validateSigningEnvironment({ repository, repositoryInfo, ref, event, environment, policies });
  console.log('Signing environment has reviewers, no administrator bypass, and the exact branch restriction.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : 'Could not verify signing-environment protections.'); process.exitCode = 1; });
}
