import { describe, expect, it } from 'vitest';
import { SIGNING_BRANCH, SIGNING_ENVIRONMENT, SIGNING_REPOSITORY, validateSigningEnvironment } from './check-android-signing-environment.mjs';

const valid = () => ({
  repository: SIGNING_REPOSITORY, repositoryInfo: { full_name: SIGNING_REPOSITORY, private: false, visibility: 'public' },
  ref: `refs/heads/${SIGNING_BRANCH}`, event: 'push',
  environment: {
    name: SIGNING_ENVIRONMENT, can_admins_bypass: false,
    deployment_branch_policy: { custom_branch_policies: true, protected_branches: false },
    protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { id: 123 } }] }],
  },
  policies: { total_count: 1, branch_policies: [{ name: SIGNING_BRANCH, type: 'branch' }] },
});

describe('protected Android signing environment', () => {
  it('accepts only the exact branch with a required reviewer and no admin bypass', () => {
    expect(() => validateSigningEnvironment(valid())).not.toThrow();
    expect(() => validateSigningEnvironment({ ...valid(), event: 'workflow_dispatch' })).not.toThrow();
  });
  it.each([
    ['a different repository', (v) => { v.repository = 'other/repo'; }],
    ['an unexpected repository identity', (v) => { v.repositoryInfo.full_name = 'other/repo'; }],
    ['a private repository', (v) => { v.repositoryInfo.private = true; v.repositoryInfo.visibility = 'private'; }],
    ['unverifiable repository visibility', (v) => { delete v.repositoryInfo.visibility; }],
    ['a different branch', (v) => { v.ref = 'refs/heads/main'; }],
    ['a tag ref', (v) => { v.ref = `refs/tags/${SIGNING_BRANCH}`; }],
    ['an unexpected trigger', (v) => { v.event = 'pull_request'; }],
    ['an absent environment', (v) => { v.environment = null; }],
    ['a differently named environment', (v) => { v.environment.name = 'other'; }],
    ['administrator bypass', (v) => { v.environment.can_admins_bypass = true; }],
    ['an unverifiable bypass setting', (v) => { delete v.environment.can_admins_bypass; }],
    ['no required reviewers', (v) => { v.environment.protection_rules = []; }],
    ['an empty reviewer rule', (v) => { v.environment.protection_rules[0].reviewers = []; }],
    ['a malformed reviewer', (v) => { v.environment.protection_rules[0].reviewers = [{ type: 'User', reviewer: {} }]; }],
    ['unrestricted branches', (v) => { v.environment.deployment_branch_policy = null; }],
    ['all protected branches', (v) => { v.environment.deployment_branch_policy = { custom_branch_policies: false, protected_branches: true }; }],
    ['a wildcard branch', (v) => { v.policies.branch_policies[0].name = 'arena/*'; }],
    ['a tag rule named like the branch', (v) => { v.policies.branch_policies[0].type = 'tag'; }],
    ['an unverifiable policy type', (v) => { delete v.policies.branch_policies[0].type; }],
    ['an additional branch or tag', (v) => { v.policies.total_count = 2; v.policies.branch_policies.push({ name: 'main', type: 'branch' }); }],
    ['inconsistent policy metadata', (v) => { v.policies.total_count = 2; }],
  ])('refuses %s', (_name, mutate) => {
    const input = valid(); mutate(input);
    expect(() => validateSigningEnvironment(input)).toThrow();
  });
});
