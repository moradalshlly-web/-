import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
const jobs = Object.fromEntries([...workflow.matchAll(/^  ([\w-]+):\n([\s\S]*?)(?=^  [\w-]+:\n|$(?![\s\S]))/gm)]
  .map(([, name, body]) => [name, body]))
const consumers = ['frontend-tests', 'backend-tests', 'typecheck', 'remotion-tests', 'characterize', 'build-backend', 'backend-boot-smoke']

for (const name of consumers) test(`${name} fails closed when preparation fails or is skipped`, () => {
  const job = jobs[name]
  const condition = job.match(/^    if: \$\{\{ (.+) \}\}$/m)?.[1]
  assert.ok(condition?.includes('!cancelled()'), 'must run its failure assertion after failed dependencies')
  const command = job.match(/- name: Require successful preparation\n[\s\S]*?        run: (.+)/)?.[1]
  assert.ok(command, 'failure assertion must precede checkout and expensive work')
  assert.ok(job.indexOf('Require successful preparation') < job.indexOf('actions/checkout'))
  for (const result of ['success', 'failure', 'skipped', 'cancelled']) {
    const needs = {
      changes: { result: 'success', outputs: { frontend: 'false', backend: 'false' } },
      'prepare-packages': { result }, typecheck: { result }, 'build-backend': { result },
    }
    const shouldRun = Function('needs', 'cancelled', `return (${condition.replace(/needs\.([a-z-]+)/g, "needs['$1']")})`)(needs, () => false)
    if (['frontend-tests', 'backend-tests'].includes(name) && result === 'success') {
      assert.equal(shouldRun, false, 'unrelated diff still skips')
    } else assert.equal(shouldRun, true, 'failed preparation cannot skip a required check')
    const r = spawnSync('bash', ['-c', command], { env: { ...process.env,
      DEPENDENCIES: JSON.stringify({ prepare: { result } }), PREPARE_RESULT: result,
    } })
    assert.equal(r.status === 0, result === 'success')
  }
})

test('independent security guards do not inherit unrelated suite skips', () => {
  for (const name of ['check-ee-imports', 'check-pricing-leaks', 'check-surface-funnel']) {
    assert.doesNotMatch(jobs[name], /^    needs:/m)
  }
})

test('production migrations retain every original prerequisite', () => {
  const needs = jobs.migrate.match(/^    needs: \[(.+)\]/m)[1].split(', ')
  for (const name of ['frontend-tests', 'backend-tests', 'typecheck', 'tenant-scope-lint',
    'check-locale-completeness', 'check-ee-imports', 'check-pricing-leaks', 'check-billing-dumps',
    'check-public-surface', 'check-surface-funnel', 'i18n-completeness', 'backend-boot-smoke',
    'migration-behavior', 'prepare-packages', 'build-backend']) assert.ok(needs.includes(name), name)
  assert.match(jobs.migrate, /github\.ref == 'refs\/heads\/main' && github\.event_name == 'push'/)
})

test('both edition probes and coverage commands survive preparation sharing', () => {
  assert.match(jobs['backend-boot-smoke'], /edition: \[cloud, community\]/)
  assert.match(jobs['backend-boot-smoke'], /WEBHOOK_STATUS.*404/)
  for (const name of ['frontend-tests', 'backend-tests']) assert.match(jobs[name], /run: npm run test:coverage/)
  assert.equal(workflow.match(/run: npm run build:packages/g)?.length, 1)
  assert.equal(workflow.match(/run: npx tsc -p tsconfig.build.json && node scripts\/copy-build-assets.mjs/g)?.length, 1)
})

test('failed-job reruns can restore preparation from an earlier attempt', () => {
  const action = readFileSync('.github/actions/restore-ci-build/action.yml', 'utf8')
  assert.doesNotMatch(action, /github\.run_attempt/)
  for (const name of ['prepare-packages', 'build-backend']) {
    assert.doesNotMatch(jobs[name], /github\.run_attempt/)
    assert.match(jobs[name], /overwrite: true/)
  }
})
