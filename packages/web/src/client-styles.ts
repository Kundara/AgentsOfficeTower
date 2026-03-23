export const CLIENT_STYLES = `

      :root {
        color-scheme: dark;
        --bg: #0b100f;
        --bg-soft: #111917;
        --panel: rgba(18, 28, 24, 0.94);
        --panel-strong: rgba(24, 38, 32, 0.98);
        --border: #29453b;
        --border-bright: #4a7b69;
        --text: #f2ead7;
        --muted: #a7bbb1;
        --accent: #4bd69f;
        --accent-2: #f5b74f;
        --danger: #f06d5e;
        --tile: 24px;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        color: var(--text);
        font-family: "IBM Plex Mono", "Cascadia Code", monospace;
        background:
          radial-gradient(circle at 20% 0%, rgba(75, 214, 159, 0.16), transparent 24%),
          radial-gradient(circle at 80% 0%, rgba(245, 183, 79, 0.1), transparent 18%),
          linear-gradient(180deg, #08100e 0%, #101816 100%);
      }

      button, select {
        font: inherit;
        color: var(--text);
        background: var(--panel-strong);
        border: 1px solid var(--border);
        padding: 8px 10px;
      }

      button:hover, select:hover {
        border-color: var(--border-bright);
      }

      a { color: #98d8ff; }

      .page {
        padding: 18px;
        display: grid;
        gap: 14px;
      }

      .hero {
        border: 1px solid var(--border);
        background:
          linear-gradient(180deg, rgba(20, 32, 27, 0.94) 0%, rgba(13, 21, 18, 0.98) 100%);
        padding: 18px;
        display: grid;
        gap: 14px;
      }

      .hero-top {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
        flex-wrap: wrap;
      }

      .hero-copy {
        min-width: 0;
        display: grid;
        gap: 4px;
      }

      .hero-title-row {
        display: flex;
        align-items: baseline;
        gap: 16px;
        min-width: 0;
        flex-wrap: wrap;
      }

      .hero-title-row h1 {
        margin: 0;
      }

      .hero-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
      }

      .view-toggle {
        display: inline-flex;
        border: 1px solid var(--border);
      }

      .view-toggle button {
        border: 0;
        border-right: 1px solid var(--border);
      }

      .view-toggle button:last-child {
        border-right: 0;
      }

      .view-toggle button.active {
        background: rgba(75, 214, 159, 0.18);
        color: var(--text);
      }

      .toggle-button.active {
        border-color: var(--accent);
        background: rgba(75, 214, 159, 0.12);
        box-shadow: inset 0 0 0 1px rgba(75, 214, 159, 0.2);
      }

      .hero-summary {
        display: inline-flex;
        align-items: baseline;
        gap: 8px;
        min-width: 0;
        flex-wrap: wrap;
        color: var(--muted);
        font-size: 11px;
      }

      .hero-summary-item {
        display: inline-flex;
        align-items: baseline;
        gap: 4px;
        padding-left: 8px;
        border-left: 1px solid rgba(255,255,255,0.12);
        white-space: nowrap;
      }

      .hero-summary-item:first-child {
        padding-left: 0;
        border-left: 0;
      }

      .hero-summary-item strong {
        color: var(--text);
        font-size: 15px;
        letter-spacing: 0.02em;
      }

      .hero-summary-item.primary strong {
        font-size: 18px;
      }

      .hero-summary-item.is-active strong {
        color: var(--accent);
      }

      .hero-summary-item.is-waiting strong {
        color: var(--accent-2);
      }

      .hero-summary-item.is-blocked strong {
        color: var(--danger);
      }

      .hero-summary-item.is-cloud strong {
        color: #98d8ff;
      }

      .layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 360px;
        gap: 14px;
        align-items: start;
      }

      .panel {
        border: 1px solid var(--border);
        background: var(--panel);
        min-height: 220px;
      }

      .panel-header {
        padding: 12px 14px;
        border-bottom: 1px solid var(--border);
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: center;
      }

      .panel-body {
        padding: 14px;
      }

      .session-list, .fleet-grid {
        display: grid;
        gap: 10px;
      }

      .session-card, .fleet-card {
        border: 1px solid var(--border);
        background: rgba(255,255,255,0.03);
        padding: 12px;
      }

      .session-card {
        transition: border-color 120ms linear, background 120ms linear;
      }

      .session-card:hover,
      .session-card:focus-within {
        border-color: rgba(75, 214, 159, 0.36);
        background: rgba(75, 214, 159, 0.06);
      }

      .muted { color: var(--muted); font-size: 12px; }

      .tabs-shell {
        border: 1px solid var(--border);
        background: rgba(255,255,255,0.02);
        padding: 12px;
        display: grid;
        gap: 10px;
        position: sticky;
        top: 12px;
        z-index: 8;
        backdrop-filter: blur(12px);
      }

      .tabs-head {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
      }

      .project-tabs {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .tabs-actions {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
      }

      .project-tab {
        min-width: 0;
      }

      .project-tab.active {
        border-color: var(--accent);
        background: rgba(75, 214, 159, 0.12);
        box-shadow: inset 0 0 0 1px rgba(75, 214, 159, 0.2);
      }

      .scene-shell {
        display: grid;
        gap: 12px;
      }

      .scene-fit {
        position: relative;
        width: 100%;
        min-height: 520px;
        display: flex;
        align-items: flex-start;
        justify-content: flex-start;
        overflow: hidden;
      }

      .scene-notifications {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 50;
        overflow: hidden;
      }

      .agent-toast {
        position: absolute;
        display: inline-flex;
        align-items: baseline;
        gap: 5px;
        max-width: 260px;
        padding: 2px 8px;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 8px;
        background: rgba(20, 30, 26, 0.8);
        color: var(--text);
        box-shadow: 0 4px 14px rgba(0,0,0,0.18);
        transform: translate(-50%, calc(-100% - 4px));
        transform-origin: bottom center;
        animation: agent-toast-float 3300ms ease-out forwards;
      }

      .agent-toast.file-change {
        border-radius: 8px;
        padding: 5px 8px 6px;
        background: rgba(16, 23, 20, 0.9);
      }

      .agent-toast.command-window {
        display: block;
        min-width: 180px;
        max-width: 320px;
        padding: 0;
        border-radius: 6px;
        border-color: rgba(123, 203, 255, 0.34);
        background: rgba(8, 12, 16, 0.96);
        color: #d6ecff;
        box-shadow:
          0 8px 18px rgba(0,0,0,0.28),
          inset 0 0 0 1px rgba(255,255,255,0.04);
      }

      .agent-toast.command-window.blocked {
        border-color: rgba(255, 120, 120, 0.36);
        color: #ffd0d0;
      }

      .agent-toast.edit {
        border-color: rgba(75, 214, 159, 0.22);
        color: #baf6dc;
      }

      .agent-toast.create {
        border-color: rgba(245, 183, 79, 0.28);
        color: #ffe1a2;
      }

      .agent-toast.run {
        border-color: rgba(115, 196, 255, 0.24);
        color: #bee8ff;
      }

      .agent-toast.read {
        border-color: rgba(151, 224, 255, 0.24);
        color: #d5f3ff;
      }

      .agent-toast.waiting {
        border-color: rgba(245, 183, 79, 0.24);
        color: #ffe1a2;
      }

      .agent-toast.blocked {
        border-color: rgba(255, 120, 120, 0.28);
        color: #ffb3b3;
      }

      .agent-toast.update {
        border-color: rgba(214, 183, 255, 0.22);
        color: #ead7ff;
      }

      .agent-toast.image {
        min-width: 120px;
        padding: 3px 7px;
        gap: 6px;
      }

      .agent-toast-preview {
        width: 42px;
        height: 42px;
        flex: 0 0 42px;
        border: 2px solid rgba(255,255,255,0.16);
        background: rgba(255,255,255,0.05);
        object-fit: cover;
        image-rendering: pixelated;
      }

      .agent-toast-copy {
        display: inline-flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
        min-width: 0;
      }

      .agent-toast-head {
        display: inline-flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
        min-width: 0;
      }

      .agent-toast-label-group {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
      }

      .agent-toast-window-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 4px 8px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
        background: linear-gradient(180deg, rgba(70, 92, 112, 0.9), rgba(44, 58, 71, 0.92));
      }

      .agent-toast-window-label {
        font-size: 10px;
        line-height: 1;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: rgba(232,243,255,0.86);
      }

      .agent-toast-window-lights {
        display: inline-flex;
        gap: 4px;
      }

      .agent-toast-window-lights span {
        width: 6px;
        height: 6px;
        border-radius: 999px;
        background: rgba(255,255,255,0.28);
      }

      .agent-toast-window-body {
        padding: 8px 10px 9px;
        background:
          linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0)),
          rgba(8, 12, 16, 0.96);
      }

      .agent-toast-command {
        margin: 0;
        font-size: 12px;
        line-height: 1.35;
        color: inherit;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font-family: Consolas, "Cascadia Mono", "SFMono-Regular", "Liberation Mono", monospace;
      }

      .agent-toast-command-prefix {
        color: rgba(120, 215, 135, 0.92);
      }

      .agent-toast-command-cursor {
        display: inline-block;
        margin-left: 1px;
        color: currentColor;
        animation: agent-toast-cursor-blink 900ms steps(1, end) infinite;
      }

      .agent-toast-label {
        font-size: 11px;
        line-height: 1.2;
        color: currentColor;
        font-weight: 700;
      }

      .agent-toast-label-icon {
        width: 14px;
        height: 14px;
        display: block;
        flex: 0 0 auto;
        image-rendering: pixelated;
      }

      .agent-toast-title {
        font-size: 11px;
        line-height: 1.2;
        color: rgba(255,255,255,0.9);
        white-space: normal;
        overflow: hidden;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        max-width: 186px;
        max-height: 2.4em;
      }

      .agent-toast-stats {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 10px;
        line-height: 1;
        font-weight: 700;
        letter-spacing: 0.01em;
      }

      .agent-toast-delta {
        font-variant-numeric: tabular-nums;
      }

      .agent-toast-delta.add {
        color: #76e39b;
      }

      .agent-toast-delta.remove {
        color: #ff8585;
      }

      @keyframes agent-toast-cursor-blink {
        0%, 49% {
          opacity: 1;
        }
        50%, 100% {
          opacity: 0;
        }
      }

      @keyframes agent-toast-float {
        0% {
          opacity: 0;
          transform: translate(-50%, calc(-78% - 1px)) scale(0.94);
        }
        12% {
          opacity: 1;
          transform: translate(-50%, calc(-100% - 10px)) scale(1);
        }
        78% {
          opacity: 1;
          transform: translate(-50%, calc(-165% - 32px)) scale(1);
        }
        100% {
          opacity: 0;
          transform: translate(-50%, calc(-195% - 44px)) scale(0.96);
        }
      }

      .scene-fit.compact {
        min-height: 280px;
      }

      .scene-grid {
        flex: 0 0 auto;
        position: relative;
        border: 2px solid rgba(46, 92, 123, 0.72);
        border-radius: 14px;
        min-height: 520px;
        overflow: hidden;
        box-shadow:
          inset 0 0 0 2px rgba(255,255,255,0.05),
          0 18px 40px rgba(0,0,0,0.28);
        background:
          radial-gradient(circle at 14% 8%, rgba(255,255,255,0.08), transparent 22%),
          radial-gradient(circle at 82% 4%, rgba(153, 215, 255, 0.1), transparent 20%),
          linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px),
          linear-gradient(180deg, #102235, #0b1b2b 62%, #071522);
        background-size: var(--tile) var(--tile);
        transform-origin: top left;
        will-change: transform;
      }

      .scene-grid.compact {
        min-height: 0;
      }

      .room {
        position: absolute;
        border: 3px solid #365a76;
        border-radius: 10px;
        background:
          linear-gradient(180deg, #96cdf9 0 15%, #dceefe 15% 16%, #ecf4fb 16% 24%, #3aa1eb 24% 25%, #1f7fcf 25% 100%);
        overflow: hidden;
        box-shadow:
          0 10px 0 rgba(0, 0, 0, 0.22),
          0 18px 28px rgba(0, 0, 0, 0.18),
          inset 0 0 0 2px rgba(255, 255, 255, 0.08);
      }

      .room-head {
        padding: 0;
        border-bottom: 0;
        background: none;
      }

      .room::after {
        content: "";
        position: absolute;
        inset: 26px 0 0;
        background:
          linear-gradient(180deg, transparent 0 20%, rgba(13, 24, 20, 0.08) 20% 21%, transparent 21% 100%),
          repeating-linear-gradient(180deg, rgba(255,255,255,0.05) 0 3px, rgba(255,255,255,0) 3px 22px);
        opacity: 0.34;
        pointer-events: none;
      }

      .room-stage {
        position: absolute;
        inset: 26px 0 0;
        overflow: hidden;
      }

      .room-mural {
        position: absolute;
        left: 8px;
        right: 8px;
        top: 8px;
        height: 34%;
        background: linear-gradient(180deg, rgba(157, 214, 255, 0.48), rgba(214, 238, 255, 0.04));
        opacity: 0.52;
        pointer-events: none;
      }

      .room-floor {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 76%;
        background:
          linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0) 18%),
          repeating-linear-gradient(180deg, #48a7ee 0 22px, #7eeaff 22px 24px, #2f8fdf 24px 46px, #63b6ff 46px 48px);
      }

      .role-banner {
        position: absolute;
        z-index: 2;
        min-width: 44px;
        padding: 2px 5px;
        border: 2px solid rgba(13, 24, 20, 0.55);
        background: rgba(243, 234, 215, 0.88);
        color: #1f2e29;
        font-size: 9px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        box-shadow: 2px 2px 0 rgba(0,0,0,0.25);
      }

      .booth {
        position: absolute;
        z-index: var(--stack-order, 3);
        outline: none;
      }

      .booth:hover,
      .booth:focus-within {
        z-index: calc(var(--stack-order, 3) + 200);
      }

      .booth.lead {
        filter: drop-shadow(0 0 10px rgba(245, 183, 79, 0.22));
      }

      .cubicle-cell {
        position: absolute;
        inset: 0 auto auto 0;
        z-index: 3;
        outline: none;
      }

      .cubicle-cell:hover,
      .cubicle-cell:focus-within {
        z-index: 20;
      }

      .cubicle-cell.entering {
        z-index: 16;
      }

      .cubicle-cell.departing {
        z-index: 16;
        pointer-events: none;
      }

      .desk-shell {
        position: absolute;
        inset: 0;
      }

      .cubicle-cell.entering .desk-shell {
        animation: workstation-spawn 180ms steps(1, end) both;
      }

      .cubicle-cell.departing .desk-shell {
        animation: workstation-despawn 180ms steps(1, end) forwards;
      }

      .snapshot-mode .cubicle-cell.entering .desk-shell,
      .snapshot-mode .cubicle-cell.departing .desk-shell {
        animation: none;
        opacity: 1;
        transform: none;
      }

      .lead-banner {
        position: absolute;
        z-index: 3;
        max-width: 220px;
        min-width: 80px;
        padding: 3px 6px;
        border: 2px solid rgba(13,24,20,0.65);
        background: rgba(18, 28, 24, 0.82);
        color: #f5efdd;
        font-size: 10px;
        line-height: 1.2;
        box-shadow: 2px 2px 0 rgba(0,0,0,0.25);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .station-tag {
        position: absolute;
        z-index: 4;
        max-width: 180px;
        min-width: 52px;
        padding: 2px 5px;
        border: 2px solid rgba(13, 24, 20, 0.55);
        background: color-mix(in srgb, var(--station-tone, #f2ead7) 30%, rgba(243, 234, 215, 0.96));
        color: #1f2e29;
        font-size: 9px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        box-shadow: 2px 2px 0 rgba(0,0,0,0.22);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .rec-room {
        position: absolute;
        border: 3px solid #b98b36;
        border-radius: 10px;
        background:
          linear-gradient(180deg, #f6dba0 0 24%, #efd8ab 24% 25%, #ffe7bc 25% 46%, #c99457 46% 47%, #b1783a 47% 100%);
        overflow: hidden;
        box-shadow:
          0 10px 0 rgba(0, 0, 0, 0.22),
          inset 0 0 0 2px rgba(255,255,255,0.14);
      }

      .rec-room::after {
        content: "";
        position: absolute;
        inset: 22px 0 0;
        background:
          linear-gradient(180deg, rgba(255,255,255,0.22), transparent 26%),
          repeating-linear-gradient(180deg, rgba(255,255,255,0.1) 0 3px, rgba(255,255,255,0) 3px 18px);
        opacity: 0.55;
        pointer-events: none;
      }

      .rec-room .room-meta {
        background: rgba(71, 45, 12, 0.7);
      }

      .rec-room.inset {
        z-index: 8;
        box-shadow:
          0 8px 0 rgba(0, 0, 0, 0.2),
          0 14px 24px rgba(0, 0, 0, 0.18),
          inset 0 0 0 2px rgba(255,255,255,0.14);
      }

      .booth-wall {
        position: absolute;
        left: 0;
        top: 0;
        right: 8px;
        height: 16px;
        background: #dce7ef;
        border: 2px solid #5e7d92;
        border-bottom: 0;
        box-shadow: inset 0 2px 0 rgba(255,255,255,0.55);
      }

      .booth-divider {
        position: absolute;
        top: 10px;
        right: 0;
        width: 14px;
        bottom: 6px;
        background: #dce7ef;
        border: 2px solid #5e7d92;
      }

      .booth-desk {
        position: absolute;
        left: 6px;
        right: 18px;
        bottom: 10px;
        height: 14px;
        background: #f0f4f8;
        border: 2px solid #4b7088;
        box-shadow:
          inset 0 2px 0 rgba(255,255,255,0.72),
          0 2px 0 rgba(0,0,0,0.2);
      }

      .booth-monitor {
        position: absolute;
        width: 20px;
        height: 14px;
        left: 14px;
        bottom: 22px;
        border: 2px solid #1e2b35;
        background: linear-gradient(180deg, rgba(255,255,255,0.2), rgba(255,255,255,0.04)), #0f1920;
        box-shadow: 0 0 0 2px rgba(255,255,255,0.04);
      }

      .booth-monitor.state-active {
        background: linear-gradient(180deg, rgba(255,255,255,0.24), rgba(255,255,255,0.06)), #36d59d;
        box-shadow: 0 0 0 2px rgba(75,214,159,0.18), 0 0 10px rgba(75,214,159,0.2);
      }

      .booth-keyboard {
        position: absolute;
        width: 16px;
        height: 4px;
        left: 16px;
        bottom: 14px;
        background: #56788d;
      }

      .booth-plaque {
        position: absolute;
        right: 12px;
        bottom: 12px;
        width: 10px;
        height: 20px;
        background: var(--booth-accent, #4bd69f);
        border: 2px solid rgba(0,0,0,0.34);
      }

      .office-sprite {
        position: absolute;
        background-repeat: no-repeat;
        background-position: 0 0;
        background-size: 100% 100%;
        image-rendering: pixelated;
        pointer-events: none;
      }

      .office-avatar-shell {
        position: absolute;
        z-index: 4;
        transform-origin: 50% 100%;
        transform: scaleX(var(--avatar-flip, 1));
        will-change: transform, opacity;
      }

      .office-avatar-shell.entering {
        z-index: 12;
        animation: avatar-arrive 480ms steps(6, end) both;
      }

      .office-avatar-shell.departing {
        z-index: 12;
        animation: avatar-leave 420ms steps(6, end) forwards;
      }

      .snapshot-mode .office-avatar-shell.entering,
      .snapshot-mode .office-avatar-shell.departing {
        animation: none;
        opacity: 1;
        transform: scaleX(var(--avatar-flip, 1));
      }

      .office-avatar {
        position: absolute;
        inset: 0;
        z-index: 6;
        background-repeat: no-repeat;
        background-position: 0 0;
        background-size: 100% 100%;
        image-rendering: pixelated;
        transform-origin: 50% 100%;
        filter: drop-shadow(0 3px 0 rgba(0,0,0,0.24));
        animation: var(--state-animation, none), var(--fx-animation, none);
      }

      .office-avatar::after {
        content: "";
        position: absolute;
        left: 50%;
        bottom: -2px;
        width: 58%;
        height: 2px;
        background: rgba(10, 20, 28, 0.18);
        opacity: 0.4;
        transform: translateX(-50%);
      }

      .office-avatar-shell.entering .office-avatar {
        --fx-animation: avatar-flash-in 150ms steps(1, end) 1;
      }

      .office-avatar-shell.departing .office-avatar {
        --fx-animation: avatar-flash-out 150ms steps(1, end) 1;
      }

      .office-avatar.state-editing,
      .office-avatar.state-running,
      .office-avatar.state-validating,
      .office-avatar.state-scanning,
      .office-avatar.state-thinking,
      .office-avatar.state-planning,
      .office-avatar.state-delegating {
        --state-animation: worker-bob 1s steps(2, end) infinite;
      }

      .office-avatar.state-idle,
      .office-avatar.state-done {
        --state-animation: none;
      }

      .office-avatar.state-blocked {
        outline: 2px solid rgba(240, 109, 94, 0.65);
        --state-animation: worker-alert 0.9s steps(2, end) infinite;
      }

      .office-avatar.state-waiting {
        outline: 2px solid rgba(245, 183, 79, 0.55);
        --state-animation: none;
      }

      .office-avatar.state-cloud {
        outline: 2px solid rgba(152, 216, 255, 0.55);
        --state-animation: worker-cloud 1.2s steps(2, end) infinite;
      }

      .speech-bubble {
        position: absolute;
        z-index: 5;
        padding: 2px 5px;
        border: 2px solid rgba(13, 24, 20, 0.65);
        background: rgba(255,255,255,0.92);
        color: #1d2c26;
        font-size: 10px;
        line-height: 1;
        box-shadow: 2px 2px 0 rgba(0,0,0,0.2);
        transform: translateX(-50%);
        white-space: nowrap;
      }

      .speech-bubble.waiting {
        background: rgba(255, 241, 201, 0.96);
      }

      .speech-bubble.blocked {
        background: rgba(255, 224, 219, 0.96);
      }

      .speech-bubble.resting {
        background: rgba(227, 244, 237, 0.96);
      }

      .agent-hover,
      .waiting-hover,
      .lounge-hover {
        position: absolute;
        left: 50%;
        bottom: calc(100% + 4px);
        z-index: 9;
        width: min(196px, calc(100vw - 20px));
        min-width: 128px;
        max-width: 196px;
        padding: 3px 4px;
        border: 2px solid rgba(13, 24, 20, 0.7);
        background: rgba(9, 17, 14, 0.95);
        color: #f4efdf;
        box-shadow: 4px 4px 0 rgba(0,0,0,0.28);
        opacity: 0;
        pointer-events: none;
        transform: translate(-50%, 4px);
        transition: opacity 90ms linear, transform 90ms linear;
      }

      .cubicle-cell .agent-hover {
        bottom: calc(100% - 12px);
      }

      .cubicle-cell:hover .agent-hover,
      .cubicle-cell:focus-within .agent-hover,
      .waiting-agent:hover .waiting-hover,
      .waiting-agent:focus-within .waiting-hover,
      .lounge-agent:hover .lounge-hover,
      .lounge-agent:focus-within .lounge-hover {
        opacity: 1;
        transform: translate(-50%, 0);
      }

      .agent-hover-title {
        font-size: 6px;
        line-height: 1.05;
        color: #bdefff;
        margin-bottom: 1px;
      }

      .agent-hover-title strong {
        display: block;
        font-size: 7px;
        line-height: 1.05;
      }

      .agent-hover-summary {
        font-size: 6px;
        line-height: 1;
        color: #f4efdf;
        overflow-wrap: anywhere;
      }

      .agent-hover-meta {
        margin-top: 1px;
        font-size: 6px;
        line-height: 1;
        color: rgba(244, 239, 223, 0.62);
        overflow-wrap: anywhere;
      }

      .room-empty {
        position: absolute;
        left: 12px;
        right: 12px;
        top: 44%;
        z-index: 3;
        padding: 8px;
        border: 2px dashed rgba(0,0,0,0.25);
        background: rgba(255,255,255,0.24);
        color: rgba(20,32,27,0.82);
        font-size: 11px;
        text-align: center;
      }

      .waiting-lane {
        position: absolute;
        left: 10px;
        right: 10px;
        bottom: 12px;
        height: 86px;
      }

      .lounge-zone {
        position: absolute;
        left: 10px;
        right: 10px;
        top: 10px;
        height: 104px;
      }

      .lounge-rug {
        position: absolute;
        left: 18px;
        right: 18px;
        bottom: 18px;
        height: 36px;
        border: 2px solid rgba(112, 84, 37, 0.46);
        background:
          linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0)),
          repeating-linear-gradient(90deg, #dbb26e 0 8px, #c89b55 8px 16px);
        box-shadow: inset 0 0 0 2px rgba(255,255,255,0.08);
        opacity: 0.92;
      }

      .waiting-agent {
        position: absolute;
        z-index: 4;
        width: 52px;
        height: 72px;
        outline: none;
      }

      .waiting-agent:hover,
      .waiting-agent:focus-within {
        z-index: 8;
      }

      [data-focus-agent] {
        transition: opacity 120ms linear;
      }

      .scene-grid[data-focus-active="true"] [data-focus-agent] {
        opacity: 0.5;
      }

      .scene-grid[data-focus-active="true"] [data-focus-agent].is-focused {
        opacity: 1;
      }

      .lounge-agent {
        position: absolute;
        z-index: 4;
        width: 52px;
        height: 72px;
        outline: none;
      }

      .lounge-agent:hover,
      .lounge-agent:focus-within {
        z-index: 8;
      }

      .pixel-asset {
        position: absolute;
        image-rendering: pixelated;
        pointer-events: none;
      }

      .card-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 10px;
      }

      .inline-code {
        font-size: 12px;
        color: var(--muted);
        overflow-wrap: anywhere;
      }

      .empty {
        color: var(--muted);
        padding: 18px;
        border: 1px dashed rgba(255,255,255,0.12);
      }

      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border: 1px solid var(--border);
        background: rgba(255,255,255,0.03);
        font-size: 12px;
      }

      .status-pill::before {
        content: "";
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: currentColor;
      }

      .status-pill.state-live {
        color: var(--accent);
      }

      .status-pill.state-connecting,
      .status-pill.state-reconnecting,
      .status-pill.state-snapshot {
        color: var(--accent-2);
      }

      .status-pill.state-offline {
        color: var(--danger);
      }

      .room-meta {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: center;
        padding: 4px 8px;
        font-size: 11px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
        background: rgba(12, 29, 43, 0.68);
      }

      .room-head {
        padding: 0;
        border-bottom: 0;
        background: none;
      }

      .terminal-shell {
        border: 1px solid rgba(255,255,255,0.08);
        background: #07100d;
        color: #b7ffdd;
        font-size: 12px;
        line-height: 1.55;
        padding: 14px;
        min-height: 520px;
        overflow: auto;
        white-space: pre-wrap;
      }

      .workspace-scroll {
        display: grid;
        gap: 14px;
        max-height: 68vh;
        overflow: auto;
        padding-right: 4px;
        align-content: start;
      }

      .workspace-card {
        border: 1px solid var(--border);
        background: rgba(255,255,255,0.03);
        padding: 12px;
        display: grid;
        gap: 12px;
      }

      .workspace-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: flex-start;
        flex-wrap: wrap;
      }

      .workspace-title {
        display: grid;
        gap: 4px;
      }

      .workspace-title strong {
        font-size: 16px;
      }

      .workspace-card.compact {
        gap: 10px;
        padding: 10px;
      }

      .workspace-card.compact .workspace-title strong {
        font-size: 14px;
      }

      .terminal-dim {
        color: #7aa18e;
      }

      .terminal-hot {
        color: #f5b74f;
      }

      .terminal-warn {
        color: #ff9f95;
      }

      @keyframes worker-bob {
        0% { transform: translateY(0); }
        50% { transform: translateY(-2px); }
        100% { transform: translateY(0); }
      }

      @keyframes worker-alert {
        0% { transform: translateX(0); }
        25% { transform: translateX(-1px); }
        75% { transform: translateX(1px); }
        100% { transform: translateX(0); }
      }

      @keyframes worker-cloud {
        0% { transform: translateY(0); opacity: 1; }
        50% { transform: translateY(-2px); opacity: 0.75; }
        100% { transform: translateY(0); opacity: 1; }
      }

      @keyframes workstation-spawn {
        0% { opacity: 0; }
        16% { opacity: 1; }
        32% { opacity: 0; }
        48% { opacity: 1; }
        64% { opacity: 0; }
        100% { opacity: 1; }
      }

      @keyframes workstation-despawn {
        0% { opacity: 1; }
        18% { opacity: 0; }
        36% { opacity: 1; }
        54% { opacity: 0; }
        72% { opacity: 1; }
        100% { opacity: 0; }
      }

      @keyframes avatar-arrive {
        0% {
          opacity: 0;
          transform: translate(var(--path-x, 0px), var(--path-y, 0px)) scaleX(var(--avatar-flip, 1));
        }
        10% {
          opacity: 1;
          transform: translate(var(--path-x, 0px), var(--path-y, 0px)) scaleX(var(--avatar-flip, 1));
        }
        100% {
          opacity: 1;
          transform: translate(0, 0) scaleX(var(--avatar-flip, 1));
        }
      }

      @keyframes avatar-leave {
        0% {
          opacity: 1;
          transform: translate(0, 0) scaleX(var(--avatar-flip, 1));
        }
        85% {
          opacity: 1;
          transform: translate(var(--path-x, 0px), var(--path-y, 0px)) scaleX(var(--avatar-flip, 1));
        }
        100% {
          opacity: 0;
          transform: translate(var(--path-x, 0px), var(--path-y, 0px)) scaleX(var(--avatar-flip, 1));
        }
      }

      @keyframes avatar-flash-in {
        0% { opacity: 0; }
        16% { opacity: 1; }
        32% { opacity: 0; }
        48% { opacity: 1; }
        64% { opacity: 0; }
        100% { opacity: 1; }
      }

      @keyframes avatar-flash-out {
        0% { opacity: 1; }
        18% { opacity: 0; }
        36% { opacity: 1; }
        54% { opacity: 0; }
        72% { opacity: 1; }
        100% { opacity: 0; }
      }

      @media (max-width: 1240px) {
        .layout {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 640px) {
        .page {
          padding: 12px;
        }

        .hero-title-row {
          gap: 8px 12px;
        }

        .hero-summary {
          gap: 6px;
        }

        .hero-summary-item {
          padding-left: 6px;
        }
      }
`;
