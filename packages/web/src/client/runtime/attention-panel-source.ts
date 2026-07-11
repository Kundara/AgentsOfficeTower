export const CLIENT_RUNTIME_ATTENTION_PANEL_SOURCE = `
      function renderFleetTerminal(fleet) {
        const lines = ["$ aot fleet", ""];
        const sharedNotes = sharedFleetNotes(fleet.projects);
        if (sharedNotes.size > 0) {
          lines.push("FLEET NOTES (apply to every workspace)");
          for (const note of sharedNotes) {
            lines.push(\`  ! \${note}\`);
          }
          lines.push("");
        }
        for (const snapshot of fleet.projects) {
          const counts = countsForSnapshot(snapshot);
          lines.push(\`PROJECT \${projectLabel(snapshot.projectRoot)}\`);
          lines.push(\`  total=\${counts.total} active=\${counts.active} waiting=\${counts.waiting} blocked=\${counts.blocked} cloud=\${counts.cloud}\`);
          const floorNotes = snapshot.notes.filter((note) => !sharedNotes.has(note));
          if (floorNotes.length > 0) {
            for (const note of floorNotes) {
              lines.push(\`  ! \${note}\`);
            }
          }
          lines.push("");
        }

        return \`<div class="terminal-shell">\${lines.map((line) => {
          const className = line.startsWith("$ ") ? "terminal-hot"
            : line.startsWith("  ! ") ? "terminal-warn"
            : /^[A-Z]/.test(line) ? "terminal-dim"
            : "";
          return \`<div class="\${className}">\${escapeHtml(line)}</div>\`;
        }).join("")}</div>\`;
      }

      function agentsNeedingUser(projects) {
        return projects.flatMap((snapshot) =>
          snapshot.agents
            .filter((agent) => agent.needsUser)
            .map((agent) => ({ snapshot, agent }))
        ).sort((left, right) => right.agent.updatedAt.localeCompare(left.agent.updatedAt));
      }

      function needsUserActionProjectRoot(snapshot, agent) {
        if (!snapshot || !agent || !agent.needsUser) {
          return null;
        }
        const isLocalCodex = !agent.network && agent.provenance === "codex" && agent.source === "local";
        const isTypedClaude = !agent.network && agent.provenance === "claude" && agent.confidence === "typed" && agent.source === "claude";
        if (!isLocalCodex && !isTypedClaude) {
          return null;
        }
        const preferredRoot = typeof agent.sourceProjectRoot === "string" && agent.sourceProjectRoot.length > 0
          ? agent.sourceProjectRoot
          : snapshot.projectRoot;
        const localRoots = localProjectRootsForSnapshot(snapshot);
        if (localRoots.includes(preferredRoot)) {
          return preferredRoot;
        }
        return localRoots[0] || preferredRoot;
      }

      function approvalDecisionEntries(need) {
        const supported = ["accept", "acceptForSession", "decline", "cancel"];
        const available = Array.isArray(need && need.availableDecisions)
          ? need.availableDecisions.filter((decision) => supported.includes(decision))
          : [];
        const selected = available.length > 0 ? available : ["accept", "decline", "cancel"];
        return selected.map((decision) => ({
          decision,
          label:
            decision === "accept" ? "Accept"
            : decision === "acceptForSession" ? "Always for session"
            : decision === "decline" ? "Decline"
            : "Cancel"
        }));
      }

      function needsUserActionError(requestId) {
        const errors = state.needsUserActionErrorsByRequestId;
        if (!errors || typeof errors !== "object") {
          return "";
        }
        const value = errors[requestId];
        return typeof value === "string" ? value : "";
      }

      function needsUserInputDraft(requestId, questionId) {
        const drafts = state.needsUserInputDrafts;
        if (!drafts || typeof drafts !== "object") {
          return { selected: "", other: "" };
        }
        const requestDraft = drafts[requestId];
        if (!requestDraft || typeof requestDraft !== "object") {
          return { selected: "", other: "" };
        }
        const questionDraft = requestDraft[questionId];
        if (!questionDraft || typeof questionDraft !== "object") {
          return { selected: "", other: "" };
        }
        return {
          selected: typeof questionDraft.selected === "string" ? questionDraft.selected : "",
          other: typeof questionDraft.other === "string" ? questionDraft.other : ""
        };
      }

      function needsUserInputAnswerValues(question, draft) {
        const options = Array.isArray(question && question.options) ? question.options : [];
        const selected = String(draft && draft.selected || "").trim();
        const other = String(draft && draft.other || "").trim();
        if (options.length === 0) {
          return other ? [other] : [];
        }
        if (!selected) {
          return [];
        }
        if (selected === "__other__") {
          return other ? [other] : [];
        }
        return [selected];
      }

      function needsUserInputQuestionLabel(question, questionIndex = 0) {
        const header = typeof (question && question.header) === "string" ? question.header.trim() : "";
        return header || "Question " + (questionIndex + 1);
      }

      function needsUserInputCompletion(need) {
        const questions = Array.isArray(need && need.questions) ? need.questions : [];
        let answered = 0;
        let requiredAnswered = 0;
        let requiredTotal = 0;
        const missingRequired = [];
        questions.forEach((question, questionIndex) => {
          const hasAnswer = needsUserInputAnswerValues(
            question,
            needsUserInputDraft(need.requestId, question.id)
          ).length > 0;
          if (hasAnswer) {
            answered += 1;
          }
          if (question.required === false) {
            return;
          }
          requiredTotal += 1;
          if (hasAnswer) {
            requiredAnswered += 1;
            return;
          }
          missingRequired.push(needsUserInputQuestionLabel(question, questionIndex));
        });
        return {
          total: questions.length,
          answered,
          requiredTotal,
          requiredAnswered,
          missingRequired
        };
      }

      function needsUserInputReady(need) {
        const completion = needsUserInputCompletion(need);
        if (completion.total === 0) {
          return false;
        }
        return completion.missingRequired.length === 0;
      }

      function needsUserInputSummary(need) {
        const completion = needsUserInputCompletion(need);
        if (completion.total === 0) {
          return "";
        }
        if (completion.requiredTotal > 0) {
          return completion.requiredAnswered + "/" + completion.requiredTotal + " required answered"
            + (completion.total > completion.requiredTotal
              ? " · " + completion.answered + "/" + completion.total + " total answered"
              : "");
        }
        return completion.answered + "/" + completion.total + " optional answered";
      }

      function needsUserInputPendingHint(need) {
        const completion = needsUserInputCompletion(need);
        if (completion.missingRequired.length === 0) {
          return completion.requiredTotal > 0
            ? "All required questions are answered."
            : "Optional answers can be left blank.";
        }
        if (completion.missingRequired.length === 1) {
          return "Still needed: " + completion.missingRequired[0];
        }
        return completion.missingRequired.length + " required questions still need answers.";
      }

      function needsUserInputSubmitLabel(need, isPending) {
        if (isPending) {
          return "Sending...";
        }
        const completion = needsUserInputCompletion(need);
        if (completion.missingRequired.length === 0) {
          return "Send";
        }
        return "Complete " + completion.missingRequired.length + " required "
          + (completion.missingRequired.length === 1 ? "question" : "questions");
      }

      function renderNeedsUserInputQuestion(requestId, question, questionIndex, isPending) {
        const options = Array.isArray(question && question.options) ? question.options : [];
        const draft = needsUserInputDraft(requestId, question.id);
        const selected = String(draft.selected || "");
        const showOther = options.length === 0 || selected === "__other__";
        const questionLabel = needsUserInputQuestionLabel(question, questionIndex);
        const requirementLabel = question.required === false ? "Optional" : "Required";
        const helperLabel = options.length > 0
          ? (question.isOther === true ? "Choose one option or use Other." : "Choose one option.")
          : (question.isSecret === true ? "Enter one value." : "Type your answer.");
        const hasDraftValue = Boolean(selected || String(draft.other || "").trim());
        const selectorBase = \`data-needs-user-request-id="\${escapeHtml(requestId)}" data-needs-user-question-id="\${escapeHtml(question.id)}"\`;
        const optionButtons = options.length > 0
          ? \`<div class="needs-you-options">\${options.map((option) => {
              const isSelected = selected === option.label;
              return \`<button type="button" class="needs-you-option\${isSelected ? " is-selected" : ""}" data-action="select-needs-user-option" \${selectorBase} data-answer="\${escapeHtml(option.label)}" title="\${escapeHtml(option.description || option.label)}"\${isPending ? " disabled" : ""}>\${escapeHtml(option.label)}</button>\`;
            }).join("")}\${question.isOther === true
              ? \`<button type="button" class="needs-you-option\${selected === "__other__" ? " is-selected" : ""}" data-action="select-needs-user-option" \${selectorBase} data-answer="__other__"\${isPending ? " disabled" : ""}>Other</button>\`
              : ""}</div>\`
          : "";
        const otherField = showOther
          ? (question.isSecret === true
            ? \`<input class="needs-you-field" type="password" \${selectorBase} data-needs-user-text="true" placeholder="Type your answer..."\${isPending ? " disabled" : ""} value="\${escapeHtml(draft.other || "")}" />\`
            : \`<textarea class="needs-you-field" rows="2" \${selectorBase} data-needs-user-text="true" placeholder="Type your answer..."\${isPending ? " disabled" : ""}>\${escapeHtml(draft.other || "")}</textarea>\`)
          : "";
        const clearButton = hasDraftValue
          ? \`<div class="needs-you-question-actions"><button type="button" data-action="clear-needs-user-answer" \${selectorBase}\${isPending ? " disabled" : ""}>Clear</button></div>\`
          : "";
        return \`<div class="needs-you-question"><div class="needs-you-question-head"><strong>\${escapeHtml(questionLabel)}</strong><span>\${escapeHtml(requirementLabel)}</span></div><div class="needs-you-question-text">\${escapeHtml(question.question || questionLabel)}</div><div class="needs-you-question-help">\${escapeHtml(helperLabel)}</div>\${optionButtons}\${otherField}\${clearButton}</div>\`;
      }

      function renderNeedsAttention(projects) {
        const entries = agentsNeedingUser(projects);
        if (entries.length === 0) {
          return "";
        }

        const pendingRequestIds = new Set(Array.isArray(state.needsUserActionRequestIds) ? state.needsUserActionRequestIds : []);

        return \`<section class="session-card needs-you-panel"><div class="needs-you-panel-head"><strong>Needs You</strong><span>\${escapeHtml(String(entries.length))}</span></div><div class="needs-you-list" role="list">\${entries.map(({ snapshot, agent }) => {
          const need = agent.needsUser;
          const scope = normalizeDisplayText(snapshot.projectRoot, need?.command || need?.reason || need?.grantRoot || agent.detail);
          const actionProjectRoot = needsUserActionProjectRoot(snapshot, agent);
          const canActOnApproval = Boolean(
            actionProjectRoot
            && need
            && need.kind === "approval"
            && typeof need.requestId === "string"
            && need.requestId.length > 0
          );
          const canActOnInput = Boolean(
            actionProjectRoot
            && need
            && need.kind === "input"
            && typeof need.requestId === "string"
            && need.requestId.length > 0
            && Array.isArray(need.questions)
            && need.questions.length > 0
          );
          const replyProjectRoot = replyActionProjectRoot(snapshot, agent);
          const canReplyToInput = Boolean(
            need
            && need.kind === "input"
            && (!Array.isArray(need.questions) || need.questions.length === 0)
            && replyProjectRoot
            && agent.threadId
          );
          const isPending = Boolean(need && pendingRequestIds.has(need.requestId));
          const requestError = need ? needsUserActionError(need.requestId) : "";
          const errorHtml = requestError
            ? \`<div class="chat-composer-error">\${escapeHtml(requestError)}</div>\`
            : "";
          const actionsHtml = canActOnApproval
            ? \`<div class="needs-you-actions">\${approvalDecisionEntries(need).map(({ decision, label }) =>
              \`<button type="button" data-action="respond-needs-user" data-project-root="\${escapeHtml(actionProjectRoot)}" data-request-id="\${escapeHtml(need.requestId)}" data-decision="\${escapeHtml(decision)}"\${isPending ? " disabled" : ""}>\${escapeHtml(isPending ? "Sending..." : label)}</button>\`
            ).join("")}</div>\${errorHtml}\`
            : canActOnInput
              ? \`<div class="needs-you-form"><div class="needs-you-summary">\${escapeHtml(needsUserInputSummary(need))}</div>\${need.questions.map((question, questionIndex) =>
                renderNeedsUserInputQuestion(need.requestId, question, questionIndex, isPending)
              ).join("")}<div class="needs-you-submit-row"><div class="needs-you-submit-hint">\${escapeHtml(needsUserInputPendingHint(need))}</div><button type="button" class="primary-action" data-action="submit-needs-user-input" data-project-root="\${escapeHtml(actionProjectRoot)}" data-request-id="\${escapeHtml(need.requestId)}"\${isPending || !needsUserInputReady(need) ? " disabled" : ""}>\${escapeHtml(needsUserInputSubmitLabel(need, isPending))}</button></div>\${errorHtml}</div>\`
            : canReplyToInput
              ? \`<div class="needs-you-form"><div class="needs-you-actions"><button type="button" data-action="open-reply-composer" data-project-root="\${escapeHtml(replyProjectRoot)}" data-thread-id="\${escapeHtml(agent.threadId)}">\${escapeHtml(replyComposerMatchesThread(replyProjectRoot, agent.threadId) ? "Editing reply..." : "Reply")}</button></div>\${renderReplyComposerForThread(replyProjectRoot, agent.threadId, "Reply to this input...")}\${need?.kind === "input" && agent.resumeCommand ? \`<div class="needs-you-fallback">Terminal fallback: <code>\${escapeHtml(agent.resumeCommand)}</code></div>\` : ""}\${errorHtml}</div>\`
            : (need?.kind === "input" && agent.resumeCommand
              ? \`<div class="needs-you-fallback">Reply in Codex: <code>\${escapeHtml(agent.resumeCommand)}</code></div>\`
              : "");
          return \`<article class="needs-you-item" role="listitem" data-session-key="\${escapeHtml(sessionDomKey(snapshot, agent))}" data-needs-user-project-root="\${escapeHtml(actionProjectRoot || "")}"><div class="needs-you-item-meta"><span>\${escapeHtml(projectLabel(snapshot.projectRoot))}</span><span>\${escapeHtml(agent.label)}</span><span>\${escapeHtml(need?.kind || "input")}</span></div><div class="needs-you-item-scope">\${escapeHtml(scope)}</div>\${actionsHtml}</article>\`;
        }).join("")}</div></section>\`;
      }`;
