import { sameProjectPath } from "./project-paths";

export function claudeSdkSessionListOptions(projectRoot: string, limit: number): {
  dir: string;
  limit: number;
  includeWorktrees: false;
} {
  return {
    dir: projectRoot,
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
