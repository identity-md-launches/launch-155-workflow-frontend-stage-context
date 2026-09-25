import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, relative, join } from "node:path";
import { keccak256, toBytes } from "viem";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dist = resolve(
  root,
  process.argv.includes("--config-only") ? "web/public" : "dist",
);
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const deployment = await readJson(resolve(root, "web/config/deployment.json"));
const networkInput = await readJson(resolve(root, "web/config/network.json"));
const canonical = (value) =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value && typeof value === "object"
      ? `{${Object.keys(value)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
          .join(",")}}`
      : JSON.stringify(value);
const same = (a, b) => canonical(a) === canonical(b);
const verify = process.argv.includes("--verify");
if (
  deployment.chainId !== networkInput.network.chainId ||
  deployment.chainId !== Number(networkInput.walletAddChain.chainId)
)
  throw Error("Network mismatch");
const pinnedLaunch = JSON.parse(
  execFileSync("git", ["show", `${deployment.sourceCommit}:launch.json`], {
    cwd: root,
    encoding: "utf8",
  }),
);
if (!same(pinnedLaunch, deployment.manifest))
  throw Error("Pinned launch differs from handoff");
const contracts = [];
for (const contract of deployment.contracts) {
  if (!/^[A-Za-z0-9_]+$/.test(contract.name)) throw Error("Unsafe ABI name");
  const path = `docs/abi/${contract.name}.json`;
  const bytes = execFileSync(
    "git",
    ["show", `${deployment.sourceCommit}:${path}`],
    { cwd: root },
  );
  const abi = JSON.parse(bytes);
  if (!Array.isArray(abi)) throw Error("Expected raw ABI array");
  const hash = keccak256(toBytes(canonical(abi))).slice(2);
  if (hash !== contract.abiHash)
    throw Error(`ABI hash mismatch: ${contract.name}: ${hash}`);
  if (!bytes.equals(await readFile(resolve(root, path))))
    throw Error(`Working ABI changed: ${path}`);
  const abiPath = `abi/${contract.name}.json`;
  if (verify) {
    if (!bytes.equals(await readFile(resolve(dist, abiPath))))
      throw Error(`Export ABI mismatch: ${abiPath}`);
  } else {
    await mkdir(resolve(dist, "abi"), { recursive: true });
    await writeFile(resolve(dist, abiPath), bytes);
  }
  contracts.push({
    name: contract.name,
    address: contract.address,
    abiHash: hash,
    abiPath,
  });
}
async function inventory(dir) {
  const assets = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isSymbolicLink()) throw Error("Export must not contain symlinks");
    if (item.isDirectory()) assets.push(...(await inventory(path)));
    else if (relative(dist, path) !== "imd-deployment.json") {
      if ((await stat(path)).size > 8388608) throw Error("Asset too large");
      assets.push({
        path: relative(dist, path),
        sha256: createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
      });
    }
  }
  return assets.sort((a, b) => a.path.localeCompare(b.path, "en"));
}
const assets = await inventory(dist);
if (assets.length > 128) throw Error("Too many assets");
const manifest = {
  version: 1,
  launchId: deployment.launchId,
  chainId: deployment.chainId,
  sourceCommit: deployment.sourceCommit,
  attestationHash: deployment.attestationHash,
  contracts,
  assets,
  network: networkInput.network,
  walletAddChain: networkInput.walletAddChain,
  manifest: deployment.manifest,
};
if (verify) {
  if (!same(await readJson(resolve(dist, "imd-deployment.json")), manifest))
    throw Error("Export manifest mismatch");
} else
  await writeFile(
    resolve(dist, "imd-deployment.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
console.log(
  `${verify ? "Verified" : "Exported"} ${contracts.length} pinned ABIs and ${assets.length} assets`,
);
