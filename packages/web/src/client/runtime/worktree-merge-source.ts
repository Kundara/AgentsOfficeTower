export const CLIENT_RUNTIME_WORKTREE_MERGE_SOURCE = `
      function mergedParentAgentIdentity(agent) {
        const parentThreadId = String(agent && agent.parentThreadId || "").trim();
        const sourceProjectRoot = String(agent && agent.sourceProjectRoot || "").trim();
        const syntheticPrefix = sourceProjectRoot ? sourceProjectRoot + "::" : "";
        return syntheticPrefix && parentThreadId.startsWith(syntheticPrefix)
          ? parentThreadId.slice(syntheticPrefix.length)
          : parentThreadId;
      }

      function mergedAgentSourceRoots(entries) {
        const sourceRootByIdentity = new Map();
        for (const entry of entries) {
          const identity = mergedAgentIdentity(entry && entry.agent);
          const sourceProjectRoot = String(entry && entry.snapshot && entry.snapshot.projectRoot || "").trim();
          if (identity && sourceProjectRoot) {
            sourceRootByIdentity.set(identity, sourceProjectRoot);
          }
        }
        return sourceRootByIdentity;
      }
`;
