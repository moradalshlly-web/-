// One service per slot: never scale down a replica pool containing active jobs.
// A fresh deployment supplies a fresh filesystem and a single-use JIT runner.
export const runnerPrefix = id => `nodaro-ci-${id}-`

export function chooseSlots({ slots, runners, jobs, queued, now = Date.now() }) {
  const available = []
  let waiting = 0
  for (const slot of slots) {
    const prefix = runnerPrefix(slot.id)
    const matches = runners.filter(r => r.name.startsWith(prefix))
    if (matches.some(r => r.busy) || jobs.some(j => j.status === 'in_progress' && j.runner_name?.startsWith(prefix))) continue
    if (matches.some(r => r.status === 'online')) { waiting++; continue }
    const deployment = slot.deployment
    if (!deployment) continue // A slot must have a successfully built image first.
    const finished = jobs.some(j => j.status === 'completed'
      && j.runner_name?.startsWith(prefix)
      && Date.parse(j.started_at) >= Date.parse(deployment.createdAt))
    if (['BUILDING', 'DEPLOYING', 'INITIALIZING', 'QUEUED', 'WAITING'].includes(deployment.status)
      || (!finished && now - Date.parse(deployment.createdAt) < 300_000)) {
      waiting++
      continue
    }
    available.push(slot.id)
  }
  return available.slice(0, Math.max(0, queued - waiting))
}
