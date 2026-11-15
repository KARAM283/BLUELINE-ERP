const { spawnSync } = require('node:child_process')

const npmCli = process.env.npm_execpath
if (!npmCli) {
  console.error('Run tests with "npm test" so the correct npm executable can be located.')
  process.exit(1)
}

function runNpm(args) {
  const result = spawnSync(process.execPath, [npmCli, ...args], { stdio: 'inherit' })
  if (result.error) {
    console.error(result.error)
    return 1
  }
  return result.status ?? 1
}

let testStatus = 1
try {
  const rebuildStatus = runNpm(['run', 'rebuild:node'])
  if (rebuildStatus === 0) testStatus = runNpm(['exec', '--', 'vitest', 'run'])
  else testStatus = rebuildStatus
} finally {
  const restoreStatus = runNpm(['run', 'rebuild:electron'])
  if (restoreStatus !== 0) {
    console.error('Failed to restore the SQLite binding for Electron. Run "npm run rebuild:electron" before launching the app.')
    process.exitCode = restoreStatus
  } else {
    process.exitCode = testStatus
  }
}
