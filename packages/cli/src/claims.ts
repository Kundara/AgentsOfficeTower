import { cwd, exit } from "node:process";
import { resolve } from "node:path";

import {
  adviseOnClaimOverlap,
  heartbeatCoordinationClaim,
  listCoordinationClaims,
  releaseCoordinationClaim,
  startCoordinationClaim,
  type CoordinationClaimView
} from "@agents-tower/core";

function flagValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) {
    return null;
  }
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

function positional(args: string[], index: number): string | null {
  const values = args.filter((arg, position) => !arg.startsWith("--") && (position === 0 || !args[position - 1].startsWith("--") || flagValue(args, args[position - 1]) !== arg));
  return values[index] ?? null;
}

function resolveClaimProjectRoot(args: string[]): string {
  return resolve(flagValue(args, "--project") ?? cwd());
}

function splitScope(value: string | null): string[] {
  return value ? value.split(",").map((entry) => entry.trim()).filter(Boolean) : [];
}

function formatClaimLine(claim: CoordinationClaimView): string {
  const scope = claim.scope.length > 0 ? ` scope=${claim.scope.join(",")}` : "";
  const who = claim.agentLabel ? ` by ${claim.agentLabel}` : "";
  const blocked = claim.blockedOn ? ` blockedOn="${claim.blockedOn}"` : "";
  return `  [${claim.lifecycle}] ${claim.id.slice(0, 8)} "${claim.objective}"${who}${scope}${blocked} heartbeat=${claim.heartbeatAt} expires=${claim.expiresAt}`;
}

export async function runClaims(args: string[], showUsage: () => void): Promise<void> {
  const subcommand = args[0];
  const rest = args.slice(1);
  const json = rest.includes("--json");
  const projectRoot = resolveClaimProjectRoot(rest);

  if (subcommand === "start") {
    const objective = flagValue(rest, "--objective");
    if (!objective) {
      console.error("claims start requires --objective \"...\"");
      exit(1);
    }
    const ttlMinutes = Number.parseInt(flagValue(rest, "--ttl") ?? "", 10);
    const claim = startCoordinationClaim({
      projectRoot,
      objective,
      scope: splitScope(flagValue(rest, "--scope") ?? flagValue(rest, "--paths")),
      branch: flagValue(rest, "--branch"),
      agentLabel: flagValue(rest, "--agent"),
      blockedOn: flagValue(rest, "--blocked-on"),
      ttlMs: Number.isFinite(ttlMinutes) ? ttlMinutes * 60 * 1000 : undefined
    });
    if (json) {
      console.log(JSON.stringify(claim, null, 2));
    } else {
      console.log(`Claim ${claim.id} started for ${projectRoot}. Heartbeat before ${claim.expiresAt} or it reads as stale.`);
    }
    return;
  }

  if (subcommand === "list") {
    const claims = listCoordinationClaims(projectRoot);
    if (json) {
      console.log(JSON.stringify({ projectRoot, claims }, null, 2));
      return;
    }
    if (claims.length === 0) {
      console.log(`No declared claims for ${projectRoot}.`);
      return;
    }
    console.log(`Declared claims for ${projectRoot}:`);
    for (const claim of claims) {
      console.log(formatClaimLine(claim));
    }
    return;
  }

  if (subcommand === "heartbeat") {
    const id = positional(rest, 0);
    if (!id) {
      console.error("claims heartbeat requires a claim id");
      exit(1);
    }
    const matched = matchClaimId(projectRoot, id);
    const updated = matched ? heartbeatCoordinationClaim(projectRoot, matched, {
      blockedOn: rest.includes("--blocked-on") ? flagValue(rest, "--blocked-on") : undefined
    }) : null;
    if (!updated) {
      console.error(`No active claim matching ${id} for ${projectRoot}.`);
      exit(1);
    }
    console.log(json ? JSON.stringify(updated, null, 2) : `Claim ${updated.id} extended to ${updated.expiresAt}.`);
    return;
  }

  if (subcommand === "release") {
    const id = positional(rest, 0);
    if (!id) {
      console.error("claims release requires a claim id");
      exit(1);
    }
    const matched = matchClaimId(projectRoot, id);
    const released = matched ? releaseCoordinationClaim(projectRoot, matched, { handoff: rest.includes("--handoff") }) : null;
    if (!released) {
      console.error(`No claim matching ${id} for ${projectRoot}.`);
      exit(1);
    }
    console.log(json ? JSON.stringify(released, null, 2) : `Claim ${released.id} marked ${released.status}.`);
    return;
  }

  if (subcommand === "check") {
    const scope = splitScope(flagValue(rest, "--scope") ?? flagValue(rest, "--paths"));
    if (scope.length === 0) {
      console.error("claims check requires --paths a,b (or --scope)");
      exit(1);
    }
    const advice = adviseOnClaimOverlap(projectRoot, scope);
    if (json) {
      console.log(JSON.stringify({ projectRoot, scope, ...advice }, null, 2));
      return;
    }
    console.log(advice.verdict === "proceed" ? "Proceed: " + advice.reasons.join(" ") : "Caution:");
    if (advice.verdict === "caution") {
      for (const reason of advice.reasons) {
        console.log(`  - ${reason}`);
      }
      for (const claim of advice.overlapping) {
        console.log(formatClaimLine(claim));
      }
    }
    return;
  }

  showUsage();
  exit(1);
}

function matchClaimId(projectRoot: string, prefix: string): string | null {
  const matches = listCoordinationClaims(projectRoot).filter((claim) => claim.id.startsWith(prefix));
  return matches.length === 1 ? matches[0].id : matches.length > 1 ? null : null;
}
