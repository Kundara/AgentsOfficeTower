import { filesystemPathForProjectRoot, sameProjectPath } from "./project-paths";

export function claudeSdkSessionListOptions(projectRoot: string, limit: number): {
  dir: string;
  limit: number;
  includeWorktrees: false;
} {
  return {
    // The SDK matches host-native paths; `/mnt/<drive>/...` finds nothing on native Windows.
    dir: filesystemPathForProjectRoot(projectRoot),
    limit,
    includeWorktrees: false
  };
}

export function filterClaudeSdkSessionsForProject<T extends { cwd?: string }>(
  projectRoot: string,
  sessions: T[]
): T[] {
  return sessions.filter((session) => sameProjectPath(session.cwd, projectRoot));
}
