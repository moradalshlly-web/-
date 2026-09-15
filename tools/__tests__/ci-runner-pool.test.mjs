import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chooseSlots } from '../ci-runner/pool.mjs'

const now = Date.parse('2026-09-15T12:00:00Z')
const slot = (id, age = 900, status = 'SUCCESS') => ({ id, deployment: {
  id: `deployment-${id}`, status, createdAt: new Date(now - age * 1000).toISOString(),
} })
const runner = (id, busy = false, status = 'online') => ({ name: `nodaro-ci-${id}-123`, busy, status })
test('launches only the capacity needed for queued jobs', () => {
  assert.deepEqual(chooseSlots({ slots: [slot('a'), slot('b')], runners: [], jobs: [], queued: 1, now }), ['a'])
})
test('keeps a busy runner even if its deployment is old', () => {
  assert.deepEqual(chooseSlots({ slots: [slot('a'), slot('b')], runners: [runner('a', true)], jobs: [], queued: 1, now }), ['b'])
})
test('an online idle runner already supplies queued capacity', () => {
  assert.deepEqual(chooseSlots({ slots: [slot('a'), slot('b')], runners: [runner('a')], jobs: [], queued: 1, now }), [])
})
test('startup grace prevents duplicate provisioning after controller restart', () => {
  assert.deepEqual(chooseSlots({ slots: [slot('a', 40), slot('b')], runners: [], jobs: [], queued: 1, now }), [])
})
test('a running GitHub job protects its slot if runner discovery is incomplete', () => {
  const jobs = [{ status: 'in_progress', runner_name: 'nodaro-ci-a-123' }]
  assert.deepEqual(chooseSlots({ slots: [slot('a')], runners: [], jobs, queued: 1, now }), [])
})
test('does not redeploy a building service or spin up an idle pool', () => {
  assert.deepEqual(chooseSlots({ slots: [slot('a', 900, 'BUILDING')], runners: [], jobs: [], queued: 1, now }), [])
  assert.deepEqual(chooseSlots({ slots: [slot('a')], runners: [], jobs: [], queued: 0, now }), [])
})
test('recovers a stopped slot and caps growth at the configured slot count', () => {
  assert.deepEqual(chooseSlots({ slots: [slot('a', 900, 'REMOVED')], runners: [], jobs: [], queued: 10, now }), ['a'])
})
test('a completed short job releases capacity without waiting for startup grace', () => {
  const jobs = [{ status: 'completed', runner_name: 'nodaro-ci-a-123', started_at: new Date(now - 20_000).toISOString() }]
  assert.deepEqual(chooseSlots({ slots: [slot('a', 40)], runners: [], jobs, queued: 1, now }), ['a'])
})
test('a completed job from an older deployment cannot override startup grace', () => {
  const jobs = [{ status: 'completed', runner_name: 'nodaro-ci-a-old', started_at: new Date(now - 600_000).toISOString() }]
  assert.deepEqual(chooseSlots({ slots: [slot('a', 40)], runners: [], jobs, queued: 1, now }), [])
})
