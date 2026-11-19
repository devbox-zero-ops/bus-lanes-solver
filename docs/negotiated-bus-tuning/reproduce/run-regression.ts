import { resolve } from "node:path"

const [mainCheckout, prCheckout, output] = process.argv.slice(2)
if (!mainCheckout || !prCheckout || !output)
  throw Error(
    "Usage: bun run-regression.ts <base-checkout> <fix-checkout> <output.json>",
  )
const reports = []
for (const revision of ["base", "head", "head", "base", "base", "head"]) {
  const child = Bun.spawn(
    [
      process.execPath,
      resolve(import.meta.dir, "regression-worker.ts"),
      revision,
      resolve(revision === "base" ? mainCheckout : prCheckout),
    ],
    { stdout: "pipe", stderr: "pipe" },
  )
  const deadline = setTimeout(() => child.kill("SIGKILL"), 15000)
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  clearTimeout(deadline)
  if (exitCode !== 0) throw Error(`${revision} exited ${exitCode}: ${stderr}`)
  reports.push(JSON.parse(stdout))
}
await Bun.write(
  output,
  JSON.stringify({ runtime: Bun.version, reports }, null, 2),
)
