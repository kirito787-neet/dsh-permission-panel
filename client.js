window.__ModuleLoader__.load({
	id: "dsh-permission-panel",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const reactModule = require("react");
		const React = reactModule.default && reactModule.default.useState ? reactModule.default : reactModule;
		const reactDomModule = require("react-dom");
		const createPortal = reactDomModule.createPortal || (reactDomModule.default && reactDomModule.default.createPortal);

		/** Dictionary namespace owned by this plugin. */
		const NS = "permissionPanel";
		/** Host settings namespace carrying the new-session default permission preset. */
		const PERMISSION_SETTINGS_NS = "permission";
		/** Fallback options for the default-preset cell when the schema offers none. */
		const FALLBACK_PRESETS = ["read-only", "workspace-write", "danger-full-access"];
		/** Default-preset options derived from the schema's own choices when available. */
		let defaultPresetOptions = (current) => FALLBACK_PRESETS.map((value) => ({ id: value, label: value }));
		/** Generated Host Remote namespaces, late-bound in apply. */
		let remoteRef = null;
		/** Abort controller owning the Workspace archive stream (0.2.1 surface). */
		let archiveAbort = null;
		/** One catalog load at a time; later requests piggyback on it. */
		let catalogLoading = false;
		/** localStorage key holding the user's shortcut preferences. */
		const STORAGE_KEY = "dsh.permissionPanel.v1";
		/**
		 * The key this plugin used before the rename. Read as a fallback so a user
		 * who had shortcuts turned off does not silently get them back; never
		 * written, so the document migrates forward on first change.
		 */
		const LEGACY_STORAGE_KEY = "dsh.hotkeyToolkit.v1";
		/** Electron preload bridge exposing argument-free Desktop actions. */
		const ACTIONS_BRIDGE = "dshDesktopActions";
		/** Loopback fallback, used when the renderer runs without the preload bridge. */
		const RESTART_PATH = "/api/desktop/restart";
		/** URL marker the Electron main process appends when it owns the window. */
		const MODE_MARKER = "dsh-desktop-mode";

		const zh = {
			nav: "权限面板",
			title: "权限面板",
			intro: "重启 DSH 已并入官方「设置 → 快捷键」界面，可录制、可恢复默认。本页只保留插件自身的开关与权限面板入口。",
			introWeb: "重启 DSH 已并入官方「设置 → 快捷键」界面。该命令只在 DSH Desktop 中可用；浏览器载体会把它显示为未绑定。",
			shortcutSection: "快捷键",
			shortcutHint: "本插件只提供一个命令「重启 DSH」，它已在官方快捷键列表中，可在「设置 → 快捷键」里查看与修改。",
			shortcutRestartNote: "「重启 DSH」在 DSH Desktop 中默认绑定 Ctrl+Shift+R（macOS 为 ⌘+Shift+R）；浏览器载体中不绑定。",
			openShortcuts: "打开快捷键设置",
			switchSection: "快捷键开关",
			switchSectionHint: "逐个启用或停用本插件提供的快捷键。停用后命令仍保留在官方快捷键列表中，键位与冲突检测都不变，只是按下时不执行（也不会拦截该按键）。",
			switch_restart: "重启 DSH",
			switchHint_restart: "重新启动 DSH Desktop 应用。",
			/* Labels shown as rows in the official shortcut list (Settings → Keyboard shortcuts). */
			cmdRestart: "重启 DSH（权限面板）",
			cmdAliasRestart: "重启 DSH 重新启动",
			restarting: "DSH 正在重启…",
			actionFailed: "操作失败：",
			noShortcut: "快捷键未绑定或不可用。",
			subpluginSection: "子插件",
			subpluginMoved: "模型搜索搜索框已迁移到「Claude 风格推理滑块」插件，请在那边开关（设置 → 插件）。本插件不再占用输入框的模型席位。",
			desktopOnly: "该操作仅在 DSH Desktop 中可用。",
			scopeUnavailable: "设置作用域不可用。",
			webCarrierNote: "当前运行在浏览器（Web）载体中：重启 DSH 仅在 DSH Desktop 中可用，因此在官方快捷键列表里默认不绑定。",
			wpNav: "工作区权限",
			wpIntro: "查看并调整每个会话的工作区权限（沙盒模式 + 审批策略），并可设置新会话的默认权限；改动即时生效。",
			wpSessionSection: "会话权限",
			wpDefaultSection: "新会话默认权限",
			wpDefaultHint: "仅对之后新建的会话生效，已有会话不受影响。",
			wpRefresh: "刷新列表",
			wpEmpty: "当前没有会话。",
			wpArchivedSkipped: "已跳过已归档会话：",
			wpSelectAll: "全选可管理会话",
			wpSelectOne: "选择会话 {name}",
			wpSelectedCount: "已选 {n} 个会话",
			wpBulkApply: "应用到所选",
			wpBulkWorking: "正在应用…",
			wpBulkClear: "清除选择",
			wpBulkDone: "已修改 {n} 个会话，{s} 个无需变动。",
			wpBulkFailed: "{n} 个会话修改失败：{d}",
			wpUnavailable: "不可用",
			wpReading: "读取中…",
			wpNoProjection: "该会话无权限投影",
			wpReadFailed: "投影读取失败",
			wpDefaultUnavailable: "此部署未提供权限设置（host 上没有 permission 命名空间），无法修改新会话的默认权限。",
			wpLoadFailed: "默认权限加载失败：",
			wpApplied: "已切换到 ",
			wpDefaultSaved: "默认权限已保存。",
			wpSwitchFailed: "权限切换失败：",
			wpSessionUnreachable: "该会话暂时无法下发指令（尚未装载）。",
			wpDefaultFailed: "默认权限保存失败：",
			wpConfirmTitle: "确认启用完全权限？",
			wpConfirmDesc: "完全权限会减少确认步骤，允许该会话直接执行敏感操作、修改文件或运行外部命令。仅在你信任该任务时继续。",
			wpParent: "子会话",
			wpCurrent: "当前",
			wpCustom: "自定义",
			wpCount: "会话数：",
			wpPresetReadOnly: "仅可查看",
			wpPresetWorkspaceWrite: "工作区内修改",
			wpPresetFullAccess: "完全权限",
			wpAcknowledge: "我已了解风险，并愿意继续",
			confirmEnable: "启用完全权限",
			cancel: "取消",
		};
		const en = {
			nav: "Permission Panel",
			title: "Permission Panel",
			intro: "Shortcuts now live in the official Settings → Keyboard shortcuts dialog, where they can be recorded and restored to defaults. This page keeps only the plugin's own switches.",
			introWeb: "Restart DSH now lives in the official Settings → Keyboard shortcuts dialog. That command exists only in DSH Desktop; the browser carrier lists it as unbound.",
			shortcutSection: "Shortcuts",
			shortcutHint: "This plugin contributes exactly one command, Restart DSH. It lives in the official shortcut list, editable from Settings → Keyboard shortcuts.",
			shortcutRestartNote: "\"Restart DSH\" ships bound to Ctrl+Shift+R (⌘+Shift+R on macOS) in DSH Desktop; it ships unbound in the browser carrier.",
			openShortcuts: "Open keyboard shortcuts",
			switchSection: "Shortcut switches",
			switchSectionHint: "Enable or disable each shortcut this plugin contributes. A disabled command stays in the official shortcut list with its keys and conflict checks intact — it simply does not run when pressed (and does not swallow the key).",
			switch_restart: "Restart DSH",
			switchHint_restart: "Relaunches the DSH Desktop application.",
			/* Labels shown as rows in the official shortcut list (Settings → Keyboard shortcuts). */
			cmdRestart: "Restart DSH (Permission Panel)",
			cmdAliasRestart: "restart DSH relaunch",
			restarting: "DSH is restarting…",
			actionFailed: "Operation failed: ",
			noShortcut: "The shortcut is unbound or unavailable.",
			subpluginSection: "Sub-plugins",
			subpluginMoved: "The model-search box moved to the \"Claude-style reasoning slider\" plugin — toggle it there (Settings → Plugins). This plugin no longer takes over the composer's model cell.",
			desktopOnly: "This action is only available in DSH Desktop.",
			scopeUnavailable: "Settings scope unavailable.",
			webCarrierNote: "Running on the browser (Web) carrier: Restart DSH exists only in DSH Desktop, so it ships unbound in the official shortcut list.",
			wpNav: "Workspace Permissions",
			wpIntro: "View and adjust each session's workspace permissions (sandbox mode + approval policy), plus the default for new sessions. Changes apply immediately.",
			wpSessionSection: "Session permissions",
			wpDefaultSection: "Default permission for new sessions",
			wpDefaultHint: "Applies to sessions created afterwards only; existing sessions keep their permissions.",
			wpRefresh: "Refresh list",
			wpEmpty: "No sessions right now.",
			wpArchivedSkipped: "Archived sessions skipped: ",
			wpSelectAll: "Select every manageable session",
			wpSelectOne: "Select session {name}",
			wpSelectedCount: "{n} selected",
			wpBulkApply: "Apply to selected",
			wpBulkWorking: "Applying…",
			wpBulkClear: "Clear selection",
			wpBulkDone: "Changed {n} session(s); {s} needed no change.",
			wpBulkFailed: "{n} session(s) failed: {d}",
			wpUnavailable: "Unavailable",
			wpReading: "Reading…",
			wpNoProjection: "This session has no permission projection",
			wpReadFailed: "Projection read failed",
			wpDefaultUnavailable: "This deployment exposes no permission settings (no `permission` namespace on the host), so the default for new sessions cannot be changed.",
			wpLoadFailed: "Failed to load the default permission: ",
			wpApplied: "Switched to ",
			wpDefaultSaved: "Default permission saved.",
			wpSwitchFailed: "Permission switch failed: ",
			wpSessionUnreachable: "This session cannot receive commands yet (not materialized).",
			wpDefaultFailed: "Failed to save the default permission: ",
			wpConfirmTitle: "Enable Full access?",
			wpConfirmDesc: "Full access reduces confirmation steps and lets this session perform sensitive operations, file changes, or external commands directly. Continue only when you trust the task.",
			wpParent: "subagent",
			wpCurrent: "current",
			wpCustom: "Custom",
			wpCount: "Sessions: ",
			wpPresetReadOnly: "Read Only",
			wpPresetWorkspaceWrite: "Workspace Write",
			wpPresetFullAccess: "Full access",
			wpAcknowledge: "I understand the risks and want to continue",
			confirmEnable: "Enable Full access",
			cancel: "Cancel",
		};

		/** Plugin styles. Class names are prefixed dshk- to stay collision-free. */
		const STYLES = [
			".dshk-page{max-width:680px;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-primary,#e8eaee)}",
			".dshk-page p{margin:0}",
			".dshk-intro{margin:0 0 16px;color:var(--dsw-alias-label-secondary,#c8ccd4)}",
			/* Centered Full-access confirmation: a fixed overlay, independent of the panel flow. */
			".dshk-overlay{position:fixed;inset:0;z-index:2147483004;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:24px}",
			".dshk-modal{width:min(440px,100%);max-height:calc(100vh - 48px);overflow-y:auto;box-shadow:var(--dsw-elevation-prominent,0 10px 32px rgba(0,0,0,.35));border:1px solid var(--dsw-alias-state-warn-label,#e0a03b);border-radius:14px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1,#26282d));color:var(--dsw-alias-label-primary,inherit);padding:18px 20px}",
			".dshk-modal h4{margin:0 0 6px;font-size:15px;font-weight:600}",
			".dshk-modalAck{margin:12px 0 16px}",
			".dshk-card{border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.24));border-radius:12px;background:var(--dsw-alias-bg-layer-1,transparent);padding:14px 16px;margin-bottom:12px}",
			".dshk-card h4{margin:0 0 2px;font-size:13px;font-weight:600}",
			".dshk-hint{margin:2px 0 10px;color:var(--dsw-alias-label-tertiary,#9aa0aa);font-size:12px}",
			".dshk-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:8px 0;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.16))}",
			".dshk-row:first-of-type{border-top:none}",
			".dshk-rowCopy{min-width:0}",
			".dshk-rowLabel{font-size:13px}",
			".dshk-rowHint{color:var(--dsw-alias-label-tertiary,#9aa0aa);font-size:11px;line-height:1.5;margin-top:2px}",
			".dshk-keys{display:flex;align-items:center;gap:6px;flex:none}",
			".dshk-key{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:20px;padding:2px 7px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:6px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08));color:var(--dsw-alias-label-secondary,#c8ccd4);white-space:nowrap}",
			".dshk-key.dshk-unset{color:var(--dsw-alias-label-dimmed,#7b828c)}",
			".dshk-btn{font:inherit;font-size:12px;line-height:18px;padding:5px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,#e8eaee);cursor:pointer;white-space:nowrap}",
			".dshk-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14))}",
			".dshk-btn:disabled{opacity:.45;cursor:not-allowed}",
			".dshk-btn.dshk-recording{border-color:var(--dsw-alias-state-warn-label,#e0a03b);color:var(--dsw-alias-state-warn-label,#e0a03b)}",
			".dshk-switch{display:flex;align-items:center;gap:8px;flex:none}",
			".dshk-switch input{width:16px;height:16px;accent-color:var(--dsw-alias-interactive-bg-primary,#3b6fe0);cursor:pointer}",
			".dshk-note{margin-top:10px;color:var(--dsw-alias-state-warn-label,#e0a03b);font-size:11px;line-height:1.5}",
			".dshk-platformNote{margin:-2px 0 12px;font-size:11px;line-height:1.6}",
			".dshk-toast{position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:2147483003;padding:9px 16px;border-radius:10px;background:var(--dsw-specific-menu,#26282d);color:var(--dsw-alias-label-primary,#e8eaee);box-shadow:var(--dsw-elevation-prominent,0 10px 32px rgba(0,0,0,.35));border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.24));font-size:12px;line-height:18px;pointer-events:none;max-width:min(420px,90vw);text-align:center}",
			/* Shared by the permissions panel's preset dropdown (its own chevron). */
			".dshk-chevron{color:var(--dsw-alias-label-caption,#9aa0aa);flex:none;transition:transform .12s}",
			".dshk-chevronOpen{transform:rotate(180deg)}",
		".dshk-wpHead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px}",
		".dshk-wpRow{display:flex;align-items:center;gap:12px;padding:9px 0;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.16))}",
		".dshk-wpRow:first-of-type{border-top:none}",
		".dshk-wpRowPicked{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08));border-radius:8px}",
		".dshk-wpHeadMain{display:flex;align-items:center;gap:8px;min-width:0}",
		".dshk-pickAll,.dshk-pick{width:15px;height:15px;flex:none;margin:0;accent-color:var(--dsw-alias-interactive-bg-primary,#3b6fe0);cursor:pointer}",
		".dshk-bulk{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;margin:6px 0 2px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2));border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.06))}",
		".dshk-bulkCount{font-size:12px;color:var(--dsw-alias-label-secondary,#c8ccd4);white-space:nowrap}",
		".dshk-bulkApply{margin-left:auto}",
		".dshk-wpAvatar{flex:none;width:26px;height:26px;border-radius:8px;display:grid;place-items:center;font-size:11px;font-weight:600;color:#fff}",
		".dshk-wpCopy{flex:1;min-width:0}",
		".dshk-wpTitle{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
		".dshk-wpSub{color:var(--dsw-alias-label-tertiary,#9aa0aa);font-size:11px;line-height:16px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
		".dshk-wpTag{display:inline-block;margin-left:6px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:8px;font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0aa);vertical-align:1px}",
		".dshk-wpDot{display:inline-block;margin-right:5px;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-label,#4caf7d);vertical-align:1px}",
		".dshk-wpSelect{font:inherit;font-size:12px;line-height:18px;max-width:200px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:9px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08));color:var(--dsw-alias-label-secondary,#c8ccd4);padding:5px 8px 5px 10px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}",
		".dshk-wpSelect:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));color:var(--dsw-alias-label-primary,#e8eaee)}",
		".dshk-wpSelect:disabled{opacity:.45;cursor:not-allowed}",
		".dshk-wpValue{overflow:hidden;text-overflow:ellipsis}",
		".dshk-wpMenu{z-index:2147483002;background:var(--dsw-specific-menu,#26282d);min-width:230px;max-height:min(280px,60vh);overflow-y:auto;box-shadow:var(--dsw-elevation-prominent,0 10px 32px rgba(0,0,0,.35));border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.24));border-radius:12px;padding:4px;position:fixed}",
		".dshk-wpItem{width:100%;color:inherit;text-align:left;cursor:pointer;background:0 0;border:none;border-radius:8px;padding:7px 10px;display:flex;align-items:center;gap:8px}",
		".dshk-wpItem:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14))}",
		".dshk-wpItemMark{flex:none;width:14px;display:grid;place-items:center;color:var(--dsw-alias-label-primary,#e8eaee)}",
		".dshk-wpItemCopy{flex:1;min-width:0}",
		".dshk-wpItemLabel{font-size:13px;line-height:18px}",
		".dshk-wpItemDesc{color:var(--dsw-alias-label-tertiary,#9aa0aa);font-size:11px;line-height:15px;margin-top:1px}",
		".dshk-wpState{color:var(--dsw-alias-label-tertiary,#9aa0aa);font-size:12px}",
		].join("\n");
		const STYLE_ID = "dsh-permission-panel-styles";

		/** Install the plugin stylesheet once; returns a disposer. */
		function installStyles() {
			if (typeof document === "undefined") return () => {};
			if (document.getElementById(STYLE_ID) !== null) return () => {};
			const style = document.createElement("style");
			style.id = STYLE_ID;
			style.textContent = STYLES;
			document.head.appendChild(style);
			return () => {
				style.remove();
			};
		}

		/** Transient bottom-center notice; dependency-free so it can never break a seat. */
		function notify(message) {
			if (typeof document === "undefined" || message === void 0 || message === null || message === "") return;
			const node = document.createElement("div");
			node.className = "dshk-toast";
			node.setAttribute("role", "status");
			node.textContent = String(message);
			document.body.appendChild(node);
			setTimeout(() => {
				node.remove();
			}, 2600);
		}

		/**
		 * Shipped defaults for the preferences this plugin owns itself.
		 *
		 * Keyboard bindings are deliberately ABSENT. They belong to the official
		 * shortcut service now (`ctx.shortcuts.register`), which persists them in
		 * the host's own document (Web: localStorage `dsh.keybindings.v1`; Desktop:
		 * `userData/keybindings.json`) and edits them in 设置 → 快捷键. Keeping a
		 * second copy here is exactly what let the old bespoke recorder drift out of
		 * sync with the official one — two recorders, two stores, two answers to
		 * "what is Ctrl+R bound to".
		 *
		 * What this DOES own:
		 *  - `shortcuts`: one arm/disarm switch PER command this plugin contributes.
		 *    These are gates on the action, not on the binding: the command stays
		 *    registered, keeps its keys, and keeps its row in the official dialog —
		 *    its `resolve` simply refuses while disarmed. That is what makes the
		 *    switch reversible without churning the shortcut registry (every
		 *    register/unregister invalidates open edit drafts and briefly disables
		 *    editing) and without ever losing a recorded combination.
		 *
		 * The model-search sub-plugin used to live here too. It now ships in
		 * `dsh-client-ui-effort-slider`, which already owns the same
		 * `conversation.input.model` cell — the two could never have coexisted.
		 */
		const DEFAULT_CONFIG = {
			/*
			 * A legacy payload may still carry `modelSearch`. normalizeConfig simply
			 * ignores it, so a profile written before the move upgrades cleanly and the
			 * slider plugin can read that value once to inherit the user's old choice.
			 *
			 * `refresh` and the three mode arms are intentionally GONE. 2.1 keeps one
			 * contributed command — Restart DSH — because Refresh duplicated the
			 * official page refresh and the mode switches belong to the Desktop shell's
			 * own settings, not to a keyboard shortcut. Stored payloads that still carry
			 * the retired keys are tolerated: normalizeConfig only reads the live keys.
			 */
			shortcuts: {
				restart: true,
			},
		};

		/** Every per-command switch this plugin exposes, in display order. */
		const SHORTCUT_SWITCHES = ["restart"];

		/**
		 * Merge a stored payload over the defaults.
		 *
		 * Tolerant by design, for two separate reasons:
		 *  - the pre-1.5 payload carried `enabled`, `refresh`, `restart`, and `modes`;
		 *    those fields are simply ignored now;
		 *  - `shortcuts` is merged key-by-key, so a payload written before a new
		 *    switch existed still gets the shipped default for the missing keys
		 *    rather than inheriting `undefined` (which would read as "off").
		 *
		 * `modelSearch` is carried through UNTOUCHED — see the deprecated-passthrough
		 * note above createConfigStore.
		 */
		function normalizeConfig(raw) {
			const next = { shortcuts: { ...DEFAULT_CONFIG.shortcuts } };
			if (raw === null || typeof raw !== "object") return next;
			if (typeof raw.modelSearch === "boolean") next.modelSearch = raw.modelSearch;
			if (raw.shortcuts !== null && typeof raw.shortcuts === "object") {
				for (const key of SHORTCUT_SWITCHES) {
					if (typeof raw.shortcuts[key] === "boolean") next.shortcuts[key] = raw.shortcuts[key];
				}
			}
			return next;
		}

		/**
		 * Whether one contributed command is currently armed.
		 *
		 * Absent or non-boolean reads as ENABLED: a missing key must never silently
		 * disable a shortcut the user never touched.
		 * @param action - switch key (currently only `restart`).
		 * @returns whether the command may run.
		 */
		function shortcutEnabled(action) {
			const value = configStore.getSnapshot().shortcuts[action];
			return value !== false;
		}

		/**
		 * Plugin preference store: one module-level snapshot so the settings page and
		 * the seat registrar always read the same value.
		 *
		 * This holds ONLY what the plugin owns. Keyboard bindings are not here — they
		 * live in the host's shortcut document (see DEFAULT_CONFIG).
		 */
		function createConfigStore() {
			let snapshot = DEFAULT_CONFIG;
			const listeners = new Set();
			const emit = () => {
				for (const listener of listeners) listener();
			};
			try {
				/*
				 * Read the CURRENT key first, then the pre-rename one. A user who had
				 * switched a shortcut off before the rename must not silently get it back
				 * just because the document key changed.
				 */
				const stored = window.localStorage.getItem(STORAGE_KEY);
				const legacy = stored === null ? window.localStorage.getItem(LEGACY_STORAGE_KEY) : null;
				if (stored !== null) snapshot = normalizeConfig(JSON.parse(stored));
				else if (legacy !== null) snapshot = normalizeConfig(JSON.parse(legacy));
			} catch {}
			return {
				getSnapshot: () => snapshot,
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				update(patch) {
					snapshot = normalizeConfig({ ...snapshot, ...patch });
					try {
						window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
					} catch {}
					emit();
				},
			};
		}
		const configStore = createConfigStore();
		/** Subscribe React to the plugin preference store. */
		function useConfig() {
			return React.useSyncExternalStore((listener) => configStore.subscribe(listener), () => configStore.getSnapshot());
		}

		/**
		 * Command ids this plugin contributes to the official shortcut service.
		 *
		 * The official `commandPattern` is
		 * `/^[a-z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)+$/u`, and — critically —
		 * the renderer's `ShortcutRegistry.register()` does NOT enforce it, while the
		 * persistence layer DOES. An id that misses the pattern therefore registers,
		 * shows up editable, and then corrupts the whole shortcut document the first
		 * time the user edits it (the read classifies the document `invalid` and the
		 * settings UI goes permanently read-only). These ids are asserted against the
		 * pattern at load time below, so a typo fails loudly and locally instead.
		 */
		const COMMAND_RESTART = "permissionPanel.restart";
		/** The official command-id grammar, mirrored so we can self-validate. */
		const COMMAND_ID_PATTERN = /^[a-z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)+$/u;

		/**
		 * Every command id this plugin contributes, as one list.
		 *
		 * Exactly ONE command: Restart DSH. Refresh duplicated the official page
		 * refresh, and the window-mode switches wrote a Desktop-owned namespace the
		 * shell's own settings page already owns — neither belongs behind a keyboard
		 * shortcut, so both were removed.
		 *
		 * Checked against `COMMAND_ID_PATTERN` at load time. This is not defensive
		 * padding: the renderer's registry accepts a malformed id silently, and the
		 * damage only appears later, when the user's first edit makes the persistence
		 * layer classify the whole shortcut document `invalid` — which turns the
		 * entire 设置 → 快捷键 page read-only and leaves the user's own file
		 * unreadable. Failing loudly here costs one console error; failing there costs
		 * the user every shortcut they ever customized.
		 */
		const COMMAND_IDS = [COMMAND_RESTART];
		for (const id of COMMAND_IDS) {
			if (!COMMAND_ID_PATTERN.test(id)) {
				throw new Error("dsh-permission-panel: command id " + JSON.stringify(id) + " violates the official shortcut grammar");
			}
		}

		/**
		 * Binding presets, chosen so registration can never throw.
		 *
		 * `ShortcutRegistry.register()` validates every declared default against
		 * `normalizeBinding`, `isWebBindingAllowed`, `bindingIssue`, and the other
		 * registered commands' defaults — for ALL SIX runtime:platform profiles at
		 * once, not just the device in front of you. A throw there escapes through
		 * `ctx.effect` and fails plugin activation outright, so the defaults matter
		 * more than they look.
		 *
		 * Two constraints drive the shape below, each verified against the official
		 * validators by `test/binding-audit.cjs`:
		 *
		 *  1. **Restart declares Desktop profiles only.** It is Desktop-only by
		 *     nature — a browser carrier has no application to relaunch — so a Web
		 *     default would advertise a binding that can never fire. It also sidesteps
		 *     a genuine minefield: on Web `Ctrl+Shift+R` is `session.rename`, and
		 *     `web:linux` admits ONLY `Mod+/`, `Mod+Shift+,`, `Mod+Shift+.` — every
		 *     other combination is rejected by `isWebBindingAllowed`. Omitting a
		 *     profile is legal and means "unbound".
		 *  2. The Desktop default stays on `Ctrl+Shift+R`, which is free on all three
		 *     Desktop platforms and collides with no official core default.
		 */
		const DESKTOP_BINDINGS = {
			restart: { code: "KeyR", modifiers: ["primary", "shift"] },
		};

		/**
		 * Expand one action into its `defaults` record.
		 *
		 * Desktop profiles get the shipped binding; Web profiles are deliberately
		 * absent (see above). `test/binding-audit.cjs` re-derives this expansion and
		 * proves every combination passes the official validators and collides with
		 * no official core default.
		 * @param action - key into `DESKTOP_BINDINGS`.
		 * @returns the `defaults` record for `shortcuts.register`.
		 */
		function desktopBindingsFor(action) {
			const binding = DESKTOP_BINDINGS[action];
			return {
				"desktop:macos": binding,
				"desktop:windows": binding,
				"desktop:linux": binding,
			};
		}

		/**
		 * Whether this page is carried by the DSH Desktop shell.
		 *
		 * The renderer is byte-identical on both carriers, so the shell has to be
		 * detected from what only it contributes: the context-isolated
		 * `dshDesktopActions` preload bridge, or the `dsh-desktop-mode` marker the
		 * Electron main process appends to the window URL. A plain browser (the
		 * `dsh web` carrier, or a remote browser session) has neither, and the
		 * Desktop-only rows must not be offered there — restarting "DSH" and
		 * switching a window mode are meaningless without the shell that owns them.
		 *
		 * Probed on every call rather than cached: the preload bridge is installed
		 * before any bundle runs, but a plugin may be reloaded into a page whose
		 * bridge arrives with a later generation, and a stale negative would
		 * permanently hide rows the shell can serve.
		 */
		function hasDesktopHost() {
			if (typeof window === "undefined") return false;
			try {
				const bridge = window[ACTIONS_BRIDGE];
				if (bridge !== void 0 && bridge !== null && typeof bridge.invoke === "function") return true;
				return new URLSearchParams(window.location.search).get(MODE_MARKER) !== null;
			} catch {
				return false;
			}
		}

		/** Invoke one argument-free Desktop action, preferring the preload bridge. */
		async function desktopAction(action) {
			const bridge = typeof window !== "undefined" ? window[ACTIONS_BRIDGE] : void 0;
			if (bridge !== void 0 && bridge !== null && typeof bridge.invoke === "function") {
				await bridge.invoke(action);
				return;
			}
			const response = await fetch(RESTART_PATH, {
				method: "POST",
				credentials: "same-origin",
				redirect: "error",
				cache: "no-store",
				headers: { "content-type": "application/json" },
				body: "{}",
			});
			if (!response.ok) throw new Error("HTTP " + String(response.status));
		}

		/** Late-bound translator for imperative (non-React) notices. */
		let translate = (key) => key;
		/** Translate one of this plugin's dictionary keys. */
		function text(key) {
			return translate(key);
		}
		/** Narrow an unknown rejection to a readable suffix. */
		function describe(cause) {
			return cause instanceof Error ? cause.message : String(cause);
		}

		/**
		 * Record a failure from a panel-side capability probe.
		 *
		 * Kept separate from the seat diagnostics because these are not seat faults:
		 * they mean a service this plugin depends on was missing or threw, which is
		 * exactly the class of failure that used to be silent (a nested `ctx.inject`
		 * whose service does not exist never calls back and never reports anything).
		 * Surfacing it on the console and in the shared diagnostic slot is what turns
		 * "the panel is mysteriously empty" into a one-line answer.
		 * @param where - the probe that failed.
		 * @param cause - the thrown value.
		 */
		function reportPanelFailure(where, cause) {
			const message = describe(cause);
			console.error("dsh-permission-panel: " + where + " failed:", cause);
			if (typeof window !== "undefined") {
				window.__dshPermissionPanel = { where, message, at: Date.now() };
			}
		}

		/**
		 * Relaunch DSH Desktop through the Desktop-owned restart action.
		 *
		 * Desktop-only by nature: a browser carrier has no application to relaunch,
		 * and the row that binds this shortcut is hidden there. The guard keeps a
		 * stale binding (or a programmatic call) from firing a request at an
		 * endpoint the carrier does not serve.
		 */
		async function restartApplication() {
			if (!hasDesktopHost()) throw new Error(text("desktopOnly"));
			notify(text("restarting"));
			await desktopAction("restart");
		}

		/** Preset machine value that must pass an explicit risk gate before switching. */
		const FULL_ACCESS_PRESET = "danger-full-access";
		/**
		 * How many per-session failures a bulk run spells out before summarizing.
		 *
		 * A failed switch is worth naming — "3 failed" without saying which is not
		 * actionable. But an unbounded join would turn a systemic outage (every session
		 * refusing) into a wall of text that buries the first real cause.
		 */
		const MAX_REPORTED_FAILURES = 5;
		/** Built-in preset labels, per locale dictionary key. */
		const PRESET_LABEL_KEYS = {
			"read-only": "wpPresetReadOnly",
			"workspace-write": "wpPresetWorkspaceWrite",
			[FULL_ACCESS_PRESET]: "wpPresetFullAccess",
		};
		/** Turn a kebab-case preset key into Title Case for unknown table entries. */
		function titleCasePreset(name) {
			return String(name).split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
		}
		/** User-facing label for one preset value; unknown values render title-cased. */
		function presetLabel(value, t) {
			const key = PRESET_LABEL_KEYS[value];
			return key === void 0 ? titleCasePreset(value) : t(key);
		}

		/*
		 * Session catalog — the 0.2.1-rc.2 data layer.
		 *
		 * 0.2.1 REMOVED the two client-side snapshots this panel used to read:
		 * `sessions.list` (a list store on the Client sessions service) and
		 * `workspaces.list` (the Workspace registry snapshot carrying
		 * `archivedSessionIds`). Reading either one now yields `undefined`, and the
		 * panel threw on `undefined.subscribe` the moment it mounted.
		 *
		 * The supported surfaces are the generated Remote namespaces:
		 *
		 *   - `remote.session.list({})` → `{ items: SessionSummary[] }`, where each
		 *     summary already carries `projections.values` hints (permissions and
		 *     title included) for sessions whose checkpoint has been read.
		 *   - `remote.session.projections({ sessionId })` → exact values for one
		 *     Session, the cold read that fills a row the list left without hints.
		 *   - `remote.workspace.follow(signal)` → baseline plus increments; the
		 *     baseline and `archived` frames carry `archivedSessionIds`.
		 *
		 * Rows are normalized into the small shape the panel already renders, so
		 * the permission UI itself needed no rewrite.
		 */
		/** Observer set for catalog revisions (React useSyncExternalStore). */
		const sessionCatalogListeners = new Set();
		/** Normalized rows, the archive set, and the load state. */
		const sessionCatalog = {
			status: "idle",
			error: null,
			order: [],
			byId: Object.create(null),
			archived: [],
			version: 0,
			notify() {
				this.version += 1;
				for (const listener of sessionCatalogListeners) listener();
			},
		};

		/** Read the current permission preset out of one projection values bag. */
		function currentPresetOf(values) {
			if (values === null || typeof values !== "object") return null;
			const permission = values.permissions;
			/* Both shapes have existed: a bare string and `{ currentValue }`. */
			if (typeof permission === "string") return permission;
			if (permission !== null && typeof permission === "object" && typeof permission.currentValue === "string") return permission.currentValue;
			return null;
		}

		/** Read a session title out of its projections, falling back to the id. */
		function titleOf(values, fallback) {
			if (values !== null && typeof values === "object" && typeof values.title === "string" && values.title !== "") return values.title;
			return fallback;
		}

		/**
		 * Fold one `remote.session.list` answer into the catalog.
		 *
		 * Rows this catalog already knows keep what they learned: a list answer only
		 * carries projection HINTS, so a session that was cold when the hint was taken
		 * comes back with no `permissions` key — and re-adopting would throw away the
		 * preset a previous cold read had already resolved. Pressing "refresh" must not
		 * make a working row go back to "unavailable".
		 */
		function adoptSessionItems(items) {
			const order = [];
			const byId = Object.create(null);
			const previous = sessionCatalog.byId;
			for (const item of items) {
				if (item === null || typeof item !== "object" || typeof item.sessionId !== "string") continue;
				const hints = item.projections;
				const values = hints !== null && hints !== void 0 && hints.values !== void 0 ? hints.values : void 0;
				const known = previous[item.sessionId];
				const preset = currentPresetOf(values);
				order.push(item.sessionId);
				byId[item.sessionId] = {
					id: item.sessionId,
					parentId: item.parentSessionId,
					title: titleOf(values, known !== void 0 ? known.title : item.sessionId),
					cwd: item.cwd,
					running: item.running === true,
					/*
					 * A hint-less row keeps the preset a previous read resolved, so pressing
					 * "refresh" never makes a working row fall back to "unavailable" — but its
					 * read state goes back to `idle`, which is what queues a fresh cold read.
					 * Keeping the value AND keeping it fresh are both required: dropping it
					 * flickers the cell, freezing `ready` makes the refresh button a no-op.
					 */
					preset: preset === null && known !== void 0 ? known.preset : preset,
					read: preset === null ? "idle" : "ready",
				};
			}
			sessionCatalog.order = order;
			sessionCatalog.byId = byId;
			sessionCatalog.status = "ready";
			sessionCatalog.error = null;
			sessionCatalog.notify();
		}

		/**
		 * Load the visible Session rows, then subscribe to the archive stream.
		 *
		 * Failure is reported on the panel rather than thrown: a Host without the
		 * Remote namespaces must degrade to "unavailable", not take the settings
		 * page down with it.
		 */
		async function loadSessionCatalog() {
			const namespaces = remoteRef;
			if (namespaces === null || namespaces.session === void 0 || typeof namespaces.session.list !== "function") {
				sessionCatalog.status = "unavailable";
				sessionCatalog.error = null;
				sessionCatalog.notify();
				return;
			}
			if (catalogLoading) return;
			catalogLoading = true;
			if (sessionCatalog.status !== "ready") {
				sessionCatalog.status = "loading";
				sessionCatalog.notify();
			}
			try {
				const response = await namespaces.session.list({}, void 0);
				const value = response !== null && typeof response === "object" && response.ok === true ? response.value : null;
				if (value === null) throw new Error(describe(response !== null && typeof response === "object" ? response.error : response));
				adoptSessionItems(Array.isArray(value.items) ? value.items : []);
				/*
				 * NOT awaited. `followArchiveSet` consumes a stream that stays open for
				 * the life of the page, so awaiting it never resolves — the `finally`
				 * below would never run, `catalogLoading` would stay true forever, and
				 * every later refresh would be short-circuited by the guard above.
				 * That is exactly the "refresh button does nothing" bug.
				 */
				followArchiveSet().catch(() => {});
			} catch (cause) {
				sessionCatalog.status = "error";
				sessionCatalog.error = describe(cause);
				sessionCatalog.notify();
			} finally {
				catalogLoading = false;
			}
		}

		/**
		 * Consume `remote.workspace.follow` for the archive set.
		 *
		 * Fail-open on purpose: an unreadable archive state must never hide rows
		 * the user can still act on. A row that turns out to be archived is a
		 * harmless no-op — the Host refuses the command and the panel says so.
		 */
		async function followArchiveSet() {
			const namespaces = remoteRef;
			if (namespaces === null || namespaces.workspace === void 0 || typeof namespaces.workspace.follow !== "function") return;
			if (archiveAbort !== null) return;
			const controller = new AbortController();
			archiveAbort = controller;
			const adopt = (ids) => {
				sessionCatalog.archived = Array.isArray(ids) ? ids : [];
				sessionCatalog.notify();
			};
			try {
				for await (const frame of namespaces.workspace.follow(controller.signal)) {
					if (frame === null || typeof frame !== "object") continue;
					if (frame.type === "baseline" || frame.type === "replace") {
						adopt(frame.value !== void 0 && frame.value !== null ? frame.value.archivedSessionIds : void 0);
					} else if (frame.type === "archived") {
						adopt(frame.archivedSessionIds);
					}
				}
			} catch {
				/* Aborted on dispose, or the carrier does not stream: keep empty. */
			} finally {
				if (archiveAbort === controller) archiveAbort = null;
			}
		}

		/**
		 * Subscribe React to the session catalog, exposed in the legacy shape the
		 * permission rows already consume (`ids`, `byId`, `current`).
		 */
		function useSessions() {
			const version = React.useSyncExternalStore(
				(listener) => {
					sessionCatalogListeners.add(listener);
					return () => {
						sessionCatalogListeners.delete(listener);
					};
				},
				() => sessionCatalog.version,
			);
			return React.useMemo(() => {
				void version;
				const byId = Object.create(null);
				for (const id of sessionCatalog.order) {
					const row = sessionCatalog.byId[id];
					if (row === void 0) continue;
					byId[id] = {
						id,
						parentId: row.parentId,
						displayTitle: row.title,
						cwd: row.cwd,
						running: row.running,
						projectionValues: row.preset === null ? void 0 : { permissions: { currentValue: row.preset } },
						/*
						 * The catalog row's read state travels with the snapshot so the
						 * panel can tell "not read yet" apart from "read and empty" and
						 * from "read failed" — three states that would otherwise all
						 * render the same "unavailable".
						 */
						projectionRead: row.read,
					};
				}
				return { ids: sessionCatalog.order, current: null, byId };
			}, [version]);
		}

		/**
		 * Ask the Host for one session's projections, without opening it.
		 *
		 * WHY THIS EXISTS. `remote.session.list` returns projection HINTS: rows whose
		 * persisted checkpoint has been read carry values, rows that never were read
		 * since this generation started may not. A row without them cannot know its
		 * current preset, so `current` is null and the row renders as "unavailable".
		 *
		 * `remote.session.projections({ sessionId })` is the supported cold read,
		 * answered by a Host-side observation that never activates an Agent — reading
		 * a preset must not be as expensive as opening the conversation, and must not
		 * depend on the user having visited the session.
		 *
		 * Deliberately NOT `retain()`: retaining materializes a client scope and
		 * starts the session's history, so doing it for every row would open every
		 * conversation in the sidebar.
		 *
		 * The read is recorded as a per-row state (`idle` → `loading` → `ready` |
		 * `empty` | `error`) for two reasons. It stops the panel from firing the same
		 * request on every render, and it lets a row say WHY it has no value instead of
		 * rendering the same "unavailable" for "not read yet", "the Host has no
		 * permission service", and "the read failed".
		 * @param id - session to read projections for.
		 */
		function ensureProjections(id) {
			const namespaces = remoteRef;
			if (namespaces === null || namespaces.session === void 0 || typeof namespaces.session.projections !== "function") return;
			const entry = sessionCatalog.byId[id];
			/*
			 * Only a row whose state is `idle` is read. `loading` is in flight,
			 * `ready` came from a hint the Host itself pushed, and `empty`/`error` were
			 * already answered — retrying those on every render would hammer the Host for
			 * a session that simply has no permission projection to offer. A list answer
			 * that comes back without a hint resets the row to `idle` (see
			 * adoptSessionItems), which is what makes the refresh button able to retry.
			 */
			if (entry === void 0 || entry.read !== "idle") return;
			entry.read = "loading";
			Promise.resolve(namespaces.session.projections({ sessionId: id }, void 0)).then((response) => {
				const value = response !== null && typeof response === "object" && response.ok === true ? response.value : null;
				if (value === null || typeof value !== "object") {
					/* `null` means the Host has no such Session (it vanished under us). */
					entry.read = "empty";
					sessionCatalog.notify();
					return;
				}
				const values = value.values !== void 0 ? value.values : void 0;
				const preset = currentPresetOf(values);
				const title = titleOf(values, entry.title);
				/*
				 * The read is authoritative: it answered from the Session's own log, so it
				 * overrides the value a previous read left behind. It is the only way a
				 * permission change made elsewhere ever reaches this row.
				 */
				entry.preset = preset;
				entry.title = title;
				entry.read = preset === null ? "empty" : "ready";
				sessionCatalog.notify();
			}).catch(() => {
				entry.read = "error";
				sessionCatalog.notify();
			});
		}

		/**
		 * Dispatch one slash command to a session BY ID, without materializing it.
		 *
		 * `remote.commands.execute` is the same surface the official ui-plan chip
		 * uses. The Host resolves the receiving Agent on demand (resuming a cold
		 * session), so an unopened session is a perfectly valid target and no
		 * client-side scope, history open, or retention is involved.
		 *
		 * The first argument is the receiving Agent, but on the wire it is the
		 * BARE Session id: `commands/execute` declares
		 * `parameters[0] = { name: "agent", wire: "agentId", source: "lookup",
		 * codec: SessionId }` with `jsonSchema: { type: "string" }`. Passing
		 * `{ id }` fails boundary validation with
		 * `wire field "agentId" failed boundary validation`, which is exactly the
		 * bug this comment exists to prevent from coming back. Every official
		 * caller writes `execute(sessionId, line, [])`.
		 *
		 * There is deliberately NO second "try the other shape" attempt: a
		 * rejected call throws, and the object shape can never succeed on any
		 * carrier, so the retry only turned one clear error into the same error.
		 * @param remoteCommands - the `remote.commands` namespace, or undefined.
		 * @param id - target session.
		 * @param line - full command line, leading slash included.
		 * @returns `{ ok: true }`, or `{ ok: false, message }` describing the refusal.
		 */
		async function dispatchCommand(remoteCommands, id, line) {
			if (remoteCommands === void 0 || remoteCommands === null || typeof remoteCommands.execute !== "function") {
				return { ok: false, message: text("wpSessionUnreachable") };
			}
			try {
				const result = await remoteCommands.execute(id, line, [], void 0);
				if (!result.ok) {
					return { ok: false, message: result.error && result.error.message ? result.error.message : String(result.error) };
				}
				/*
				 * `undefined` means syntax or name did not resolve — the Host never
				 * entered a handler. Report it instead of claiming success: a preset
				 * the deployment does not define would otherwise look applied.
				 */
				if (result.value === void 0) return { ok: false, message: "the host offers no " + line.split(" ")[0] + " command" };
				return { ok: true };
			} catch (cause) {
				return { ok: false, message: describe(cause) };
			}
		}

		/**
		 * Subscribe React to the Workspace registry's archive set.
		 *
		 * Returns the set of archived session ids. It degrades to an EMPTY set when
		 * the registry is absent, which is the safe direction: an unknown archive
		 * state must not hide sessions the user can still act on. Showing a row that
		 * turns out to be archived is a harmless no-op (the Host refuses the command);
		 * hiding an active row would silently remove a control the user needs.
		 */
		function useArchivedIds() {
			const version = React.useSyncExternalStore(
				(listener) => {
					sessionCatalogListeners.add(listener);
					return () => {
						sessionCatalogListeners.delete(listener);
					};
				},
				() => sessionCatalog.version,
			);
			return React.useMemo(() => new Set(sessionCatalog.archived), [version]);
		}

		/**
		 * Settings page.
		 *
		 * Deliberately small: keyboard recording is gone. It used to be a bespoke
		 * recorder writing this plugin's own localStorage, which meant two recorders,
		 * two stores, and two disagreeing answers to "what is Ctrl+R bound to". The
		 * bindings now live in the official shortcut service and are edited in
		 * 设置 → 快捷键, so this page only owns what is genuinely the plugin's:
		 * the per-command switches, plus a pointer to the official dialog.
		 *
		 * The model-search sub-plugin switch that used to sit here is gone with the
		 * seat it drove; the card now points at the plugin that owns it.
		 *
		 * Switches are read per render, not cached at activation: the same bundle
		 * serves both carriers and the page can outlive an activation.
		 */
		function SettingsSection(props) {
			const { t } = props;
			const config = useConfig();
			const desktop = hasDesktopHost();
			/*
			 * Per-command switches. Desktop-only commands are listed on every carrier
			 * anyway: the switch is a property of the COMMAND, not of the current page,
			 * and hiding it here would make the stored preference invisible (and
			 * therefore unchangeable) on a browser carrier. The row notes the carrier
			 * restriction instead.
			 */
			const switchRows = SHORTCUT_SWITCHES.map((action) => {
				const desktopOnly = true;
				return React.createElement("div", { className: "dshk-row", key: action }, [
					React.createElement("div", { className: "dshk-rowCopy", key: "c" }, [
						React.createElement("div", { className: "dshk-rowLabel", key: "l" }, t("switch_" + action)),
						React.createElement("div", { className: "dshk-rowHint", key: "h" },
							desktopOnly && !desktop ? t("desktopOnly") : t("switchHint_" + action)),
					]),
					React.createElement("label", { className: "dshk-switch", key: "s" }, React.createElement("input", {
						type: "checkbox",
						checked: config.shortcuts[action] !== false,
						onChange: (event) => configStore.update({
							shortcuts: { ...config.shortcuts, [action]: event.target.checked },
						}),
					})),
				]);
			});
			return React.createElement("div", { className: "dshk-page" }, [
				React.createElement("p", { className: "dshk-intro", key: "intro" }, desktop ? t("intro") : t("introWeb")),
				/*
				 * Shortcut ownership note. This card is informational by design: it
				 * explains where the shortcuts went and why Refresh ships unbound, so a
				 * user who upgraded from the old page is not left hunting for the
				 * recorder that used to be here.
				 */
				React.createElement("div", { className: "dshk-card", key: "shortcuts" }, [
					React.createElement("h4", { key: "h" }, t("shortcutSection")),
					React.createElement("div", { className: "dshk-hint", key: "hh" }, t("shortcutHint")),
					React.createElement("div", { className: "dshk-hint", key: "rn" }, t("shortcutRestartNote")),
					desktop ? null : React.createElement("div", { className: "dshk-hint dshk-platformNote", key: "pn" }, t("webCarrierNote")),
				]),
				React.createElement("div", { className: "dshk-card", key: "switches" }, [
					React.createElement("h4", { key: "h" }, t("switchSection")),
					React.createElement("div", { className: "dshk-hint", key: "hh" }, t("switchSectionHint")),
					...switchRows,
				]),
				React.createElement("div", { className: "dshk-card", key: "subplugins" }, [
					React.createElement("h4", { key: "h" }, t("subpluginSection")),
					React.createElement("div", { className: "dshk-hint", key: "hh" }, t("subpluginMoved")),
				]),
			]);
		}

		/** Down chevron: the permissions panel's preset dropdown trigger. */
		function ChevronDown(props) {
			return React.createElement("svg", { className: props.className, width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" }, React.createElement("path", {
				d: "M4 6.25 8 10.25l4-4",
				stroke: "currentColor",
				strokeWidth: "1.4",
				strokeLinecap: "round",
				strokeLinejoin: "round",
			}));
		}
		/** Check glyph: marks the active preset in the permissions panel. */
		function CheckIcon() {
			return React.createElement("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" }, React.createElement("path", {
				d: "M3.5 8.5 6.5 11.5 12.5 4.5",
				stroke: "currentColor",
				strokeWidth: "1.5",
				strokeLinecap: "round",
				strokeLinejoin: "round",
			}));
		}

		/**
		 * Required services.
		 *
		 * NESTED REMOTE NAMESPACES ARE SEPARATELY GATED. `ctx.remote` is one service,
		 * but every namespace under it (`ctx.remote.settings`,
		 * `ctx.remote.permissionPresets`, `ctx.remote.session`, …) must ALSO be
		 * declared by its own dotted name. Cordis resolves a property through the
		 * fiber's `inject` set and throws
		 * `cannot get property "remote.settings" without inject` otherwise — and a
		 * plain `remote` entry does NOT cover its children.
		 *
		 * That is exactly how the permissions panel stayed broken after the first fix:
		 * it read `remote.settings.describe()` while only `remote` was declared, so
		 * every read threw. The failure was swallowed into the panel's own error state,
		 * which rendered as the generic "unavailable" the user saw.
		 *
		 * 0.2.1 gating, per namespace:
		 *   - `remote.session` — the permissions panel's Session catalog
		 *     (`list`/`projections`) and its per-Session live view.
		 *   - `remote.workspace` — the archive stream (`follow`) that filters rows.
		 *   - `remote.commands` — the `/permission` dispatch transport.
		 *   - `remote.settings` — the new-session default preset read/write.
		 *   - `remote.permissionPresets` — the selectable preset catalog.
		 *
		 * `remote.session` and `remote.workspace` moved back INTO this array in
		 * 0.2.1: the Client sessions service lost its list snapshot and the
		 * Workspace registry lost its snapshot too, so the panel now reads the
		 * Remotes instead, and a hard gate is what makes a missing namespace
		 * visible rather than an empty panel. `workspaces` and `shortcuts` (the
		 * CLIENT services, not the Remote namespaces) remain lazily injected via
		 * `ctx.inject([...], ...)` inside `apply`: a carrier without them still
		 * gets the settings page and the permissions panel instead of the whole
		 * plugin waiting forever for a service that never arrives.
		 *
		 * The difference between the two gates is not cosmetic. A name in THIS array
		 * is a hard requirement: cordis leaves the plugin PENDING forever when it is
		 * missing. A nested `ctx.inject` is a soft one: the callback simply never
		 * runs, and the feature that depends on it degrades.
		 */
		const inject = [
			"locale",
			"remote",
			"remote.commands",
			"remote.session",
			"remote.workspace",
			"remote.settings",
			"remote.permissionPresets",
			"slots",
		];

		/**
		 * Client plugin body: dictionaries + stylesheet, the settings page, the
		 * official shortcut commands, and the permissions panel. The searchable
		 * model seat that used to be here moved to `dsh-client-ui-effort-slider`.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-permission-panel: dictionaries");
			ctx.effect(() => installStyles(), "dsh-permission-panel: styles");
			translate = ctx.locale.bind(NS);

			/*
			 * This plugin contributes NO settings form of its own any more.
			 *
			 * DSH 0.1.7 removed `ctx.settingsScope` and 0.2.1 removed the `configForms`
			 * replacement as well, so a plugin cannot publish a rendered form. The only
			 * host-owned surface left is the `permission` settings namespace, and the
			 * panel drives it through `remote.settings.describe` / `mutate` — see
			 * permissionPanel below.
			 */

			/*
			 * The Remote namespaces, bound once so their lifetime belongs to this
			 * plugin's fiber. 0.2.1 has no client-side Session list store: the panel
			 * enumerates rows through `remote.session.list` and the archive set
			 * through `remote.workspace.follow` (see loadSessionCatalog).
			 */
			ctx.inject(["remote"], (scope) => {
				remoteRef = scope.remote;
				loadSessionCatalog().catch(() => {});
			});

			/* Abort the archive stream when this plugin's fiber goes away. */
			ctx.effect(() => () => {
				if (archiveAbort !== null) {
					archiveAbort.abort();
					archiveAbort = null;
				}
			}, "dsh-permission-panel: session catalog");

			ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "dsh-permission-panel",
				order: 60,
				label: () => translate("nav"),
				locale: NS,
			}, SettingsSection)), "dsh-permission-panel: settings page");

			/*
			 * Keyboard commands — contributed to the OFFICIAL shortcut service.
			 *
			 * This replaces the plugin's own global `keydown` listener. The official
			 * service owns the whole lifecycle: physical-key matching, region and modal
			 * arbitration, conflict detection, recording, and persistence (Web:
			 * localStorage `dsh.keybindings.v1`; Desktop: `userData/keybindings.json`).
			 * Every command registered here appears as an editable row in
			 * 设置 → 快捷键 with no extra work, and a user edit is durable.
			 *
			 * `ctx.inject(['shortcuts'], ...)` rather than a top-level `inject` entry:
			 * the shortcut service is optional from this plugin's point of view. If a
			 * carrier ever ships without it, the settings page, the permissions panel,
			 * and the model seat must still work — only the commands go missing.
			 *
			 * Registration is wrapped in a try/catch on purpose. `register()` validates
			 * every declared default against all six runtime:platform profiles at once
			 * and throws on a reserved key, a web-illegal combination, or an overlap
			 * with another command's default; that throw would otherwise escape through
			 * `ctx.effect` and fail plugin activation outright. A plugin that loses its
			 * shortcuts is degraded; a plugin that refuses to load is broken.
			 */
			ctx.inject(["shortcuts"], (scope) => {
				const shortcuts = scope.shortcuts;
				/* A localized label thunk: the registry re-reads it on every locale change. */
				const label = (key) => () => translate(key);
				/**
				 * Register one command, refusing to let a validation failure propagate.
				 *
				 * The per-command switch is enforced HERE, in a wrapper around the owner's
				 * `resolve`, rather than by registering and unregistering the command. That
				 * choice matters: every register/unregister round invalidates open edit
				 * drafts in the official dialog and briefly disables editing, and a
				 * user-recorded combination would be dropped from the running catalog while
				 * disarmed. Gating the action keeps the row, its keys, and its conflicts
				 * intact — the command simply declines to run.
				 *
				 * A disarmed command returns `pass`, not `blocked`. `blocked` CONSUMES the
				 * keystroke, which would let a disabled plugin shortcut shadow whatever the
				 * user actually meant to press; `pass` leaves the key to everyone else.
				 * @param id - command id, already checked against the official grammar.
				 * @param action - switch key in `config.shortcuts`.
				 * @param spec - label key, aliases, defaults, and the action.
				 * @returns nothing; failures are reported once and dropped.
				 */
				const contribute = (id, action, spec) => {
					scope.effect(() => {
						try {
							return shortcuts.register({
								id,
								label: label(spec.labelKey),
								aliases: spec.aliases,
								defaults: spec.defaults,
								regions: spec.regions,
								modals: spec.modals,
								resolve: (context) => {
									if (!shortcutEnabled(action)) return { status: "pass" };
									return spec.resolve(context);
								},
							});
						} catch (cause) {
							/*
							 * Degrade to "no shortcut" instead of taking the plugin down.
							 * The settings page explains where shortcuts live, so the user
							 * still has a path to the official dialog.
							 */
							console.error("dsh-permission-panel: could not register shortcut " + id, cause);
							notify(text("actionFailed") + describe(cause));
							return () => {};
						}
					}, "dsh-permission-panel: command " + id);
				};

				/*
				 * Restart DSH — the ONLY command this plugin contributes.
				 *
				 * 2.1 removed Refresh and the three window-mode switches: Refresh
				 * duplicated the official `page.refresh`, and the mode switches write a
				 * Desktop-owned settings namespace the shell's own page already owns.
				 *
				 * The defaults are declared for Desktop profiles only. A Web default
				 * would advertise a binding that can never fire (there is no application
				 * to relaunch), and it would also be a real hazard: on Web
				 * `Ctrl+Shift+R` is `session.rename` and `Ctrl+Alt+R` is `page.refresh`,
				 * while `web:linux` admits only `Mod+/`, `Mod+Shift+,`, `Mod+Shift+.`.
				 * Omitting a profile is legal and simply means "unbound".
				 *
				 * `resolve` refuses on a browser carrier even when a binding exists —
				 * the binding may have been recorded on Desktop and synced, and firing a
				 * request at an endpoint this carrier does not serve is worse than
				 * doing nothing.
				 */
				contribute(COMMAND_RESTART, "restart", {
					labelKey: "cmdRestart",
					aliases: [translate("cmdAliasRestart"), "restart", "relaunch"],
					defaults: desktopBindingsFor("restart"),
					regions: ["page", "editable", "terminal"],
					modals: ["settings", "shortcuts"],
					resolve: () => {
						if (!hasDesktopHost()) return { status: "blocked", reason: text("desktopOnly") };
						return { status: "handled", run: () => {
							restartApplication().catch((cause) => notify(text("actionFailed") + describe(cause)));
						} };
					},
				});
			});

			/*
		 * Permissions panel state.
		 *
		 * Two things were wrong here, and both were silent.
		 *
		 * 1. It read the settings surface through `ctx.settingsScope`, which DSH 0.1.7
		 *    REMOVED (replaced by `configForms`). A nested `ctx.inject(['settingsScope'],
		 *    …)` does not throw and does not fail activation — the callback simply never
		 *    runs, so `describeFace` stayed null and the default-preset cell rendered as
		 *    permanently "loading" with no way to write. The panel now resolves the
		 *    `permission` namespace through the supported `remote.settings` transport.
		 * 2. It derived each row's preset OPTIONS from the session projection, but the
		 *    `permissions` projection is `{ currentValue }` only — there is no `options`
		 *    field. `capable` was therefore always false and EVERY session row rendered
		 *    disabled. The options come from the process-level catalog Remote
		 *    (`remote.permissionPresets.catalog()`), which is what the official picker
		 *    uses too.
		 *
		 * Both bugs shared a shape: the code trusted a field or a service that does not
		 * exist, and nothing failed loudly. The suite's stubs were richer than the real
		 * host, which is why they passed.
		 */
		const permissionPanel = {
			/** Settings transport context (`remote`), or null until injected. */
			settingsCtx: null,
			/**
			 * The `remote.commands` namespace, captured at bind time.
			 *
			 * Held here rather than read off `settingsCtx` at dispatch time so the
			 * dispatcher (module scope) never has to reach into a sibling `const`
			 * declared inside `apply`. That mistake is invisible in a bundler and
			 * fatal at runtime: the name simply does not resolve there, so every
			 * dispatch threw `permissionPanel is not defined` before it could send
			 * anything — a silent "nothing happens" on every row.
			 */
			remoteCommands: void 0,
			/** Latest known `permission` namespace revision, fencing writes. */
			revision: void 0,
			current: null,
			options: [],
			writable: false,
			saving: false,
			status: "idle",
			error: null,
			/** Process-level preset catalog from the Host (shared by every session). */
			catalog: [],
			/**
			 * Presets eligible as a NEW-SESSION DEFAULT, straight from the Host.
			 *
			 * `catalog.options` is every selectable preset; `catalog.defaultOptions`
			 * is the subset configured as an eligible default. The official
			 * settings row uses the latter, and so must this: a preset that exists
			 * for live switching is not necessarily a legal default.
			 */
			defaultCatalog: [],
			/**
			 * The catalog's `defaultPreset`: the EFFECTIVE default the Host derives.
			 *
			 * `defaultPreset` is `z.string().volatile()` with neither `.required()`
			 * nor `.default()`, and a volatile settings form only projects fields
			 * that carry a value. A user who never set the default therefore gets
			 * `namespace.value === {}` — absent, not broken. The Host still knows
			 * the effective value (composition defaults folded through
			 * `presets`), and publishes it here. It is the documented fallback for
			 * exactly this case; the official settings row reads
			 * `view.value.defaultPreset ?? catalog.defaultPreset`.
			 */
			catalogDefault: null,
			catalogStatus: "idle",
			catalogError: null,
			version: 0,
			notify() {
				this.version += 1;
				for (const listener of permissionPanelListeners) listener();
			},
			/**
			 * Read the process-level permission catalog.
			 *
			 * This is the ONLY source of selectable presets; the per-session
			 * projection carries just the current value. It is read once per panel load
			 * and reused for every row.
			 */
			async loadCatalog() {
				const panelCtx = this.settingsCtx;
				if (panelCtx === null) return;
				this.catalogStatus = "loading";
				this.catalogError = null;
				this.notify();
				try {
					const response = await panelCtx.remote.permissionPresets.catalog();
					if (!response.ok) {
						throw new Error(response.error && response.error.message ? response.error.message : String(response.error));
					}
					const value = response.value;
					const readOptions = (raw) => (Array.isArray(raw) ? raw : [])
						.filter((option) => option !== null && typeof option === "object" && typeof option.value === "string")
						.map((option) => ({ value: option.value, name: typeof option.name === "string" ? option.name : option.value }));
					this.catalog = readOptions(value !== null && typeof value === "object" ? value.options : void 0);
					/*
					 * `defaultOptions` is a distinct field, not a synonym for `options`.
					 * The settings schema for `defaultPreset` is a bare string
					 * (`z.string().volatile()`), so it advertises NO enum values — the
					 * schema-derived list collapsed to the current value alone and the
					 * default-permission dropdown could never actually switch anything.
					 * The Host's own catalog is what the official row reads.
					 */
					this.defaultCatalog = readOptions(value !== null && typeof value === "object" ? value.defaultOptions : void 0);
					this.catalogDefault = value !== null && typeof value === "object" && typeof value.defaultPreset === "string" && value.defaultPreset !== ""
						? value.defaultPreset
						: null;
					this.catalogStatus = "ready";
				} catch (cause) {
					this.catalogStatus = "error";
					this.catalogError = describe(cause);
				}
				this.notify();
			},
			/** Read the `permission` namespace's current `defaultPreset` and writability. */
			async load() {
				const panelCtx = this.settingsCtx;
				if (panelCtx === null) return;
				this.status = "loading";
				this.error = null;
				this.notify();
				/*
				 * Catalog FIRST. The effective default can live only in the catalog
				 * when the user never wrote `defaultPreset`, and `adopt()` needs it
				 * as a fallback. It reports its own failures and never throws.
				 */
				await this.loadCatalog();
				try {
					const response = await panelCtx.remote.settings.describe();
					if (!response.ok) {
						throw new Error(response.error && response.error.message ? response.error.message : String(response.error));
					}
					this.adopt(response.value);
				} catch (cause) {
					this.fail(cause);
					return;
				}
			},
			/** Fold one `settings.describe` answer into the panel snapshot. */
			adopt(view) {
				const namespaces = view !== null && typeof view === "object" && Array.isArray(view.namespaces) ? view.namespaces : [];
				const namespace = namespaces.find((entry) => entry !== null && typeof entry === "object" && entry.ns === PERMISSION_SETTINGS_NS) ?? null;
				if (namespace === null) {
					this.current = null;
					this.options = [];
					this.writable = false;
					this.revision = void 0;
					this.status = "unavailable";
					this.notify();
					return;
				}
				const raw = namespace.value;
				const configured = raw !== null && typeof raw === "object" && typeof raw.defaultPreset === "string" && raw.defaultPreset !== ""
					? raw.defaultPreset
					: null;
				/*
				 * ABSENT IS NOT BROKEN. `defaultPreset` is `z.string().volatile()`
				 * with no `.required()` and no `.default()`, and a volatile settings
				 * form projects only fields that hold a value — so a user who never
				 * wrote a default sees `value === {}`. The Host still derives an
				 * effective default and publishes it in `catalog.defaultPreset`.
				 * Failing here was the bug: it reported "has no defaultPreset
				 * value" for a perfectly healthy deployment that simply had no
				 * override on disk.
				 */
				const value = configured !== null ? configured : this.catalogDefault;
				if (value === null) {
					this.fail(new Error("permission settings has no defaultPreset value and the catalog advertises no effective default"));
					return;
				}
				this.current = value;
				this.options = defaultPresetOptions(value);
				this.writable = view.writable === true;
				this.revision = namespace.revision;
				this.status = "ready";
				this.error = null;
				this.notify();
			},
			/** Write one new-session default preset through the settings transport. */
			async select(preset) {
				const panelCtx = this.settingsCtx;
				if (panelCtx === null || this.saving) return;
				this.saving = true;
				this.status = "saving";
				this.error = null;
				this.notify();
				try {
					const response = await panelCtx.remote.settings.mutate(PERMISSION_SETTINGS_NS, [{
						op: "set",
						path: ["defaultPreset"],
						value: preset,
					}], this.revision);
					if (!response.ok) throw new Error(response.error && response.error.message ? response.error.message : String(response.error));
					/*
					 * Fold the answer back rather than assuming success: the Host may have
					 * clamped or rewritten the value, and the accepted revision is what the
					 * next write must be fenced against.
					 */
					const accepted = response.value;
					if (accepted !== null && typeof accepted === "object" && accepted.ns === PERMISSION_SETTINGS_NS) {
						this.current = typeof accepted.value === "object" && accepted.value !== null && typeof accepted.value.defaultPreset === "string"
							? accepted.value.defaultPreset
							: preset;
						this.revision = accepted.revision;
						this.options = defaultPresetOptions(this.current);
					} else {
						this.current = preset;
					}
					this.status = "ready";
					notify(text("wpDefaultSaved"));
				} catch (cause) {
					this.fail(cause);
				} finally {
					this.saving = false;
					this.notify();
				}
			},
			fail(cause) {
				this.status = "error";
				this.error = describe(cause);
				this.notify();
			},
		};
		const permissionPanelListeners = new Set();
		const usePermissionPanel = () => React.useSyncExternalStore(
			(listener) => {
				permissionPanelListeners.add(listener);
				return () => {
					permissionPanelListeners.delete(listener);
				};
			},
			() => permissionPanel.version,
		);
		/*
		 * Bind the settings transport. `remote.settings` is the supported 0.1.7
		 * surface for both reading the document and writing it.
		 *
		 * Deliberately injected WITHOUT `settingsSchema`: the selectable defaults
		 * now come from the Host catalog's `defaultOptions`, so the schema is only
		 * a fallback. Coupling the two would mean a carrier without the schema
		 * service leaves this callback unfired, `settingsCtx` null, and the panel
		 * permanently on "loading" — the same silent-failure shape as the original
		 * `settingsScope` bug, and one this plugin has no reason to risk.
		 */
		ctx.inject(["remote"], (scope) => {
			permissionPanel.settingsCtx = scope;
			/*
			 * Capture the command namespace here, where it is reachable.
			 *
			 * `remote.commands` is a declared dotted namespace (see the inject array),
			 * so it resolves through this fiber. It is read ONCE and stored because the
			 * dispatcher lives at module scope and cannot see this closure.
			 */
			try {
				permissionPanel.remoteCommands = scope.remote.commands;
			} catch (cause) {
				reportPanelFailure("remote.commands", cause);
			}
		});

		/*
		 * Optional schema fallback for the default-preset choices.
		 *
		 * 0.2.1 no longer composes a client-side `settingsSchema` service, so this
		 * callback never fires there and the built-in fallback stays in charge. It
		 * is kept because an older or differently composed carrier may still offer
		 * the service, and a deployment that constrains `defaultPreset` to a union
		 * of consts would then get a better answer than a hardcoded list. Absent the
		 * service, nothing breaks: the catalog Remote supplies the real options.
		 */
		ctx.inject(["settingsSchema"], (scope) => {
			const schema = scope.settingsSchema;
			defaultPresetOptions = (current) => {
				try {
					const descriptor = schema.describe();
					const namespace = descriptor.namespaces.find((entry) => entry.ns === PERMISSION_SETTINGS_NS);
					if (namespace === void 0) return [];
					const node = schema.nodeAtPath(schema.rehydrate(namespace.schema), ["defaultPreset"]);
					if (node === void 0) return [];
					const candidates = node.type === "union" ? node.list ?? [] : [node];
					const options = candidates.flatMap((candidate) => {
						if (candidate === null || typeof candidate !== "object") return [];
						if (candidate.type !== "const" || typeof candidate.value !== "string") return [];
						return [{ id: candidate.value, label: candidate.value }];
					});
					return options.some((option) => option.id === current) ? options : [{ id: current, label: current }, ...options];
				} catch {
					return [];
				}
			};
		});

		/** One permission row: optional selection box, session title, tags, preset selector. */
		function PermissionRow(props) {
			const { t, title, subtitle, tags, value, options, disabled, onSwitch, selectable, selected, onToggle, placeholder } = props;
			return React.createElement("div", { className: "dshk-wpRow" + (selected === true ? " dshk-wpRowPicked" : ""), key: title }, [
				/*
				 * The checkbox is rendered ONLY for a row that can actually be changed.
				 * Offering a tick on an unusable row would let the user build a selection
				 * that the Apply step then silently skips — the count and the outcome
				 * would disagree, which is worse than not offering it.
				 */
				selectable === true ? React.createElement("input", {
					type: "checkbox",
					className: "dshk-pick",
					key: "pick",
					checked: selected === true,
					"aria-label": t("wpSelectOne").replace("{name}", title),
					onChange: onToggle,
				}) : null,
				avatarOf(title),
				React.createElement("div", { className: "dshk-wpCopy", key: "copy" }, [
					React.createElement("div", { className: "dshk-wpTitle", key: "t" }, title),
					subtitle !== void 0 && subtitle !== "" ? React.createElement("div", { className: "dshk-wpSub", key: "s" }, subtitle) : null,
				]),
				tags !== void 0 && tags.length > 0 ? React.createElement("div", { key: "tags", className: "dshk-keys" }, tags.map((tag, index) => tag !== null && typeof tag === "object" && tag.node === true ? React.createElement("span", { className: "dshk-wpDot", key: index, title: "running" }) : React.createElement("span", { className: "dshk-wpTag", key: index }, tag))) : null,
				React.createElement(PresetDropdown, {
					key: "sel",
					value,
					options: options.filter((option) => option.custom !== true),
					disabled,
					onSwitch,
					placeholder,
					t,
				}),
				]);
			}


			/** Avatar chip derived from the session title (stable color, first glyph). */
			function avatarOf(rawTitle) {
				const title = rawTitle === null || rawTitle === void 0 ? "" : String(rawTitle);
				let hash = 0;
				for (let index = 0; index < title.length; index++) hash = (hash * 31 + title.charCodeAt(index)) >>> 0;
				const hues = [212, 158, 262, 20, 330, 190, 45, 288];
				const color = "hsl(" + hues[hash % hues.length] + " 55% 45%)";
				const glyph = (title.trim()[0] ?? "?").toUpperCase();
				return React.createElement("span", { className: "dshk-wpAvatar", key: "avatar", style: { background: color } }, glyph);
			}

			/** Preset-mark glyph for the dropdown items. */
			function presetMark(preset) {
				const palette = { "read-only": "#7b828c", "workspace-write": "#3b6fe0", "danger-full-access": "#e0a03b" };
				return React.createElement("span", { style: { color: palette[preset] ?? "#7b828c", flex: "none" } }, "\u25cf");
			}

			/**
			 * Styled preset dropdown: a button + portal menu (fixed, viewport-clamped,
			 * outside-click + Escape to close). Replaces the native <select> so rows can
			 * carry marks and descriptions consistent with the rest of DSH.
			 */
			function PresetDropdown(props) {
				const { value, options, disabled, onSwitch, placeholder, t } = props;
				const [open, setOpen] = React.useState(false);
				const [pos, setPos] = React.useState(null);
				const btnRef = React.useRef(null);
				const menuRef = React.useRef(null);
				const current = options.find((option) => option.value === value);
				React.useLayoutEffect(() => {
					if (!open) {
						setPos(null);
						return;
					}
					const place = () => {
						const rect = btnRef.current?.getBoundingClientRect();
						if (rect === void 0) return;
						const MARGIN = 8;
						const width = menuRef.current?.offsetWidth ?? 230;
						const height = menuRef.current?.offsetHeight ?? 0;
						let x = rect.right - width;
						let y = rect.bottom + 6;
						if (width > 0) x = Math.min(Math.max(x, MARGIN), window.innerWidth - width - MARGIN);
						if (height > 0 && y + height > window.innerHeight - MARGIN) y = Math.max(MARGIN, rect.top - height - 6);
						setPos({ left: x, top: y });
					};
					place();
					window.addEventListener("resize", place);
					window.addEventListener("scroll", place, true);
					return () => {
						window.removeEventListener("resize", place);
						window.removeEventListener("scroll", place, true);
					};
				}, [open]);
				React.useEffect(() => {
					if (!open) return;
					const onDown = (event) => {
						if (btnRef.current?.contains(event.target) === true) return;
						if (menuRef.current?.contains(event.target) === true) return;
						setOpen(false);
					};
					const onKey = (event) => {
						if (event.key === "Escape") setOpen(false);
					};
					document.addEventListener("mousedown", onDown);
					document.addEventListener("keydown", onKey);
					return () => {
						document.removeEventListener("mousedown", onDown);
						document.removeEventListener("keydown", onKey);
					};
				}, [open]);
							const trigger = React.createElement("button", {
				ref: btnRef,
				type: "button",
				className: "dshk-wpSelect",
				disabled: disabled || options.length === 0,
				"aria-haspopup": "listbox",
				"aria-expanded": open,
				onClick: () => setOpen(!open),
			}, [
				current !== void 0 ? React.createElement("span", { key: "dot" }, presetMark(current.value)) : null,
				React.createElement("span", { className: "dshk-wpValue", key: "v" }, current !== void 0 ? current.label : (typeof placeholder === "string" ? placeholder : t("wpUnavailable"))),
				React.createElement(ChevronDown, { className: "dshk-chevron" + (open ? " dshk-chevronOpen" : ""), key: "c" }),
			]);
			const portalHost = typeof document === "undefined" ? null : document.body;
			const menu = open && pos !== null && portalHost !== null ? createPortal(React.createElement("div", {
				ref: menuRef,
				className: "dshk-wpMenu",
				style: pos,
				role: "listbox",
			}, options.map((option) => React.createElement("button", {
				key: option.value,
				type: "button",
				role: "option",
				"aria-selected": option.value === value,
				className: "dshk-wpItem",
				onClick: () => {
					setOpen(false);
					if (option.value !== value) onSwitch(option.value);
				},
			}, [
				React.createElement("span", { className: "dshk-wpItemMark", key: "m" }, option.value === value ? React.createElement(CheckIcon, {}) : presetMark(option.value)),
				React.createElement("span", { className: "dshk-wpItemCopy", key: "c" }, React.createElement("span", { className: "dshk-wpItemLabel" }, option.label)),
			]))), portalHost) : null;
			return React.createElement(React.Fragment, null, trigger, menu);
			}

		/**
		 * Workspace-permissions panel: every session's permission projection (read
		 * straight from the sessions list snapshot, no session needs to be opened) with
		 * a per-row preset selector riding the /permission command, plus the new-session
		 * default write-through. Full access always passes the confirmation gate first.
		 */
		function PermissionsSection(props) {
			const { t } = props;
			const sessions = useSessions();
			const archivedIds = useArchivedIds();
			usePermissionPanel();
			const panel = permissionPanel;
			const [gate, setGate] = React.useState(null);
			const [acknowledged, setAcknowledged] = React.useState(false);
			const [problem, setProblem] = React.useState(null);
			/** Ids ticked for a bulk change; cleared after a successful run. */
			const [selected, setSelected] = React.useState(() => new Set());
			/** Chosen preset in the bulk bar; null until the user picks one. */
			const [bulkPreset, setBulkPreset] = React.useState(null);
			const [bulkBusy, setBulkBusy] = React.useState(false);
			/** Portal host for the centered confirmation; <body> escapes the panel scroll box. */
			const gateHost = typeof document === "undefined" ? null : document.body;

			React.useEffect(() => {
				panel.load();
			}, [panel]);

			/*
			 * Pull the `permissions` projection for every listed session.
			 *
			 * The list snapshot only carries projections the Host has already pushed:
			 * the live control baseline, or cached list hints read from the persisted
			 * checkpoint. A session the user has never opened generally has neither, so
			 * `projectionValues.permissions` is absent, `current` is null, and the row
			 * renders as "不可用" even though nothing is wrong with it. Reading the
			 * projection explicitly is what makes an unopened session show its real
			 * preset — and it deliberately does NOT open the session: the Host answers
			 * this read from a plain observation, never activating an Agent.
			 *
			 * Keyed on the id LIST, not on the snapshot object: the snapshot identity
			 * changes on every unrelated field (running flags, retention counts), and
			 * re-reading every projection each time would hammer the Host for no reason.
			 * The effect re-runs when the set of sessions changes, which is precisely
			 * when there is something new to read.
			 *
			 * Already-answered sessions short-circuit inside the manager (a `ready`
			 * projection load returns immediately), so the re-run is cheap.
			 */
			const sessionKey = sessions.ids.join("\n");
			/*
			 * Read states are part of the key: a refresh adopts the fresh list without
			 * changing the id set, yet it resets unanswered rows to `idle`. Without this
			 * the effect would not re-run and the refresh control would be a no-op.
			 */
			const readKey = sessions.ids.map((id) => {
				const summary = sessions.byId[id];
				return summary === void 0 ? "" : summary.projectionRead;
			}).join(",");
			React.useEffect(() => {
				for (const id of sessions.ids) {
					const summary = sessions.byId[id];
					if (summary === void 0 || summary.parentId !== void 0) continue;
					if (archivedIds.has(id)) continue;
					/*
					 * Gate on the read state, NOT on `projectionValues`: a row whose preset was
					 * carried over from an earlier read still answers `current`, but its state
					 * is `idle` because the new list had no hint for it — that is exactly the
					 * row the refresh must re-read.
					 */
					if (summary.projectionRead !== "idle") continue;
					ensureProjections(id);
				}
			}, [sessionKey, readKey, archivedIds]);

			React.useEffect(() => {
				if (gate === null) return;
				setAcknowledged(false);
				/** A centered modal is expected to close on Escape. */
				const onKeyDown = (event) => {
					if (event.key === "Escape") setGate(null);
				};
				document.addEventListener("keydown", onKeyDown);
				return () => document.removeEventListener("keydown", onKeyDown);
			}, [gate]);

			const rows = React.useMemo(() => {
				const out = [];
				/*
				 * Preset OPTIONS come from the process-level catalog, not from the session
				 * projection. The `permissions` projection is `{ currentValue }` alone —
				 * reading `permission.options` here (as this used to) yields undefined for
				 * every session, so `capable` was always false and every row rendered
				 * disabled. That was the second half of "permission management does not
				 * work": the rows existed but could never be clicked.
				 */
				const catalog = panel.catalog;
				const options = catalog.map((option) => ({ value: option.value, label: presetLabel(option.value, t) }));
				for (const id of sessions.ids) {
					const summary = sessions.byId[id];
					if (summary === void 0 || summary.parentId !== void 0) continue;
					/*
					 * Archived sessions are skipped. Archiving means "this session is done",
					 * and the Host's own archived-session gate refuses to run a model step
					 * for one — so a permission switch here would be a control that cannot
					 * affect anything. Subagents are skipped above for the same reason: they
					 * inherit their parent's permissions rather than owning a switch.
					 */
					if (archivedIds.has(id)) continue;
					const values = summary.projectionValues;
					const permission = values !== void 0 ? values.permissions : void 0;
					const current = permission !== void 0 && permission !== null && typeof permission.currentValue === "string" ? permission.currentValue : null;
					/*
					 * WHY A PLACEHOLDER. "Unavailable" used to be the answer to three very
					 * different situations: the row has not been read yet (normal, and
					 * transient), the Host served the row without a permission projection
					 * (this deployment composes no permission service), or the read threw.
					 * Collapsing them into one word sent users hunting for a bug that was
					 * really a deployment fact — or, on a cold session, nothing at all.
					 */
					const placeholder = current !== null
						? void 0
						: summary.projectionRead === "idle" || summary.projectionRead === "loading"
							? t("wpReading")
							: summary.projectionRead === "error" ? t("wpReadFailed") : t("wpNoProjection");
					const tags = [];
					if (summary.id === sessions.current) tags.push(t("wpCurrent"));
					if (summary.running === true) tags.push({ node: true, key: "run" });
					out.push({
						id: summary.id,
						title: summary.displayTitle || summary.id,
						subtitle: typeof summary.cwd === "string" ? summary.cwd : "",
						tags,
						current,
						options,
						placeholder,
						/*
						 * A row is actionable when the Host advertises a catalog AND the
						 * session actually carries a permission projection. The projection's
						 * presence is the real capability signal: it is absent when no
						 * permission service is composed.
						 */
						capable: options.length > 0 && current !== null,
					});
				}
				out.sort((a, b) => a.title.localeCompare(b.title));
				return out;
			}, [sessions, t, panel.catalog, panel.version, archivedIds]);

			/**
			 * How many sessions the archive filter removed from the list.
			 *
			 * Counted rather than silently dropped: a user who archived a session and
			 * then wonders where its row went deserves an answer in the panel, not an
			 * empty space. Only ordinary (non-subagent) sessions are counted, so the
			 * number matches what would otherwise have been listed.
			 */
			const archivedCount = React.useMemo(() => {
				let count = 0;
				for (const id of sessions.ids) {
					const summary = sessions.byId[id];
					if (summary === void 0 || summary.parentId !== void 0) continue;
					if (archivedIds.has(id)) count += 1;
				}
				return count;
			}, [sessions, archivedIds]);

			/** Rows that can actually be acted on, i.e. the only ones worth offering. */
			const selectableRows = React.useMemo(
				() => rows.filter((row) => row.capable === true),
				[rows],
			);

			/*
			 * Prune the selection against the CURRENT row set.
			 *
			 * A ticked id can disappear (session removed, archived, or its projection
			 * failed to load). Left alone, the bulk bar would keep claiming "3 selected"
			 * for rows that no longer exist, and "apply to selected" would silently target
			 * fewer sessions than the user believes. Intersecting on read keeps the count
			 * honest without needing a cleanup effect racing the render.
			 */
			const effectiveSelection = React.useMemo(() => {
				const live = new Set(selectableRows.map((row) => row.id));
				return new Set([...selected].filter((id) => live.has(id)));
			}, [selected, selectableRows]);

			const selectedCount = effectiveSelection.size;
			const allSelected = selectableRows.length > 0 && selectedCount === selectableRows.length;

			/** Toggle one row's membership. */
			const toggleSelected = (id) => {
				setSelected((previous) => {
					const next = new Set(previous);
					if (next.has(id)) next.delete(id);
					else next.add(id);
					return next;
				});
			};

			const toggleAll = () => {
				setSelected(() => (allSelected ? new Set() : new Set(selectableRows.map((row) => row.id))));
			};

			/*
			 * Apply a preset to one session: the part that actually talks to the Host.
			 *
			 * Split out from the gate deliberately. The confirmation handler used to call
			 * switchSession() again, which re-detected "full access from a non-full-access
			 * session" (row.current has not changed yet) and reopened the very dialog just
			 * confirmed - so Full access was never applied, only re-confirmed forever.
			 *
			 * Dispatches BY SESSION ID (see `dispatchCommand`) so a session the user has
			 * never opened is a valid target. Reaching for the client-side binding here is
			 * what produced "该会话暂时无法下发指令（尚未装载）" for every unopened session.
			 * @returns true when the Host accepted the switch.
			 */
			const applySessionPreset = async (row, preset) => {
				setProblem(null);
				if (row.capable !== true) return false;
				if (preset === row.current) return true;
				const result = await dispatchCommand(panel.remoteCommands, row.id, "/permission " + preset);
				if (!result.ok) {
					setProblem(text("wpSwitchFailed") + result.message);
					return false;
				}
				notify(text("wpApplied") + presetLabel(preset, t));
				return true;
			};

			/**
			 * Apply one preset to every selected session.
			 *
			 * Sequential, not `Promise.all`: each switch is a Host command on a distinct
			 * session, and firing a hundred of them at once buys nothing while making the
			 * failure story unreadable (which of N interleaved rejections was the cause?).
			 * One at a time keeps the first real error attributable.
			 *
			 * Partial success is reported as partial. Silently claiming success when three
			 * of ten sessions refused would be worse than the original bug: the user would
			 * believe a permission change that never happened.
			 * @param preset - preset key to apply to every selected row.
			 */
			const applyBulkPreset = async (preset) => {
				setProblem(null);
				const live = new Set(selectableRows.map((row) => row.id));
				const targets = rows.filter((row) => effectiveSelection.has(row.id) && live.has(row.id));
				if (targets.length === 0) return;
				setBulkBusy(true);
				let changed = 0;
				let skipped = 0;
				const failures = [];
				try {
					for (const row of targets) {
						if (preset === row.current) { skipped += 1; continue; }
						const result = await dispatchCommand(panel.remoteCommands, row.id, "/permission " + preset);
						if (result.ok) changed += 1;
						else failures.push(row.title + ": " + result.message);
					}
				} finally {
					setBulkBusy(false);
				}
				if (failures.length === 0) {
					notify(text("wpBulkDone").replace("{n}", String(changed)).replace("{s}", String(skipped)));
					setSelected(new Set());
					setBulkPreset(null);
					return;
				}
				const detail = failures.length > MAX_REPORTED_FAILURES
					? failures.slice(0, MAX_REPORTED_FAILURES).join("; ") + " …(+" + (failures.length - MAX_REPORTED_FAILURES) + ")"
					: failures.join("; ");
				setProblem(text("wpBulkFailed").replace("{n}", String(failures.length)).replace("{d}", detail));
			};

			/**
			 * Bulk entry point: Full access still passes the risk gate first.
			 *
			 * One confirmation for the whole batch, not one per session: the gate exists
			 * to make the user consciously accept reduced confirmation, and asking ten
			 * times for the same acceptance trains them to click through it.
			 */
			const requestBulk = () => {
				setProblem(null);
				if (bulkPreset === null || selectedCount === 0) return;
				const targets = rows.filter((row) => effectiveSelection.has(row.id) && row.current !== FULL_ACCESS_PRESET);
				if (bulkPreset === FULL_ACCESS_PRESET && targets.length > 0) {
					setGate({ kind: "bulk" });
					return;
				}
				applyBulkPreset(bulkPreset);
			};

			/** Route a preset choice through the Full-access confirmation gate first. */
			const switchSession = (row, preset) => {
				setProblem(null);
				if (row.capable !== true) return;
				if (preset === FULL_ACCESS_PRESET && row.current !== FULL_ACCESS_PRESET) {
					setGate({ kind: "session", id: row.id });
					return;
				}
				applySessionPreset(row, preset);
			};

			const switchDefault = (preset) => {
				setProblem(null);
				if (preset === FULL_ACCESS_PRESET && panel.current !== FULL_ACCESS_PRESET) {
					setGate({ kind: "default" });
					return;
				}
				if (preset !== panel.current) panel.select(preset).catch((cause) => setProblem(text("wpDefaultFailed") + describe(cause)));
			};

			const confirmGate = () => {
				if (gate === null) return;
				const pending = gate;
				setGate(null);
				if (pending.kind === "session") {
					const row = rows.find((entry) => entry.id === pending.id);
					/* Apply directly - switchSession() would reopen the gate just confirmed. */
					if (row !== void 0) applySessionPreset(row, FULL_ACCESS_PRESET);
				} else if (pending.kind === "bulk") {
					/* Likewise direct: requestBulk() would reopen the gate just confirmed. */
					applyBulkPreset(FULL_ACCESS_PRESET);
				} else {
					panel.select(FULL_ACCESS_PRESET).catch((cause) => setProblem(text("wpDefaultFailed") + describe(cause)));
				}
			};

			/*
			 * New-session default choices come from the Host catalog's
			 * `defaultOptions`, NOT from the settings schema.
			 *
			 * The schema for `defaultPreset` is `z.string().volatile()` — a plain
			 * string with no enum — so the schema-derived list held only the current
			 * value and the dropdown could not switch anything. The official
			 * settings row reads `catalog.defaultOptions`, which is the configured
			 * subset of presets eligible as a default.
			 *
			 * The current value is merged in when the catalog omits it. The official
			 * row THROWS on that mismatch, but a thrown error here would blank the
			 * whole panel; showing the live value alongside the selectable ones keeps
			 * the control honest and the page alive. `defaultPresetOptions` stays as
			 * the fallback for the window before the catalog lands.
			 */
			const defaultChoices = panel.defaultCatalog.length > 0
				? panel.defaultCatalog.map((option) => ({ value: option.value, label: presetLabel(option.value, t) }))
				: panel.options.map((option) => ({ value: option.id, label: presetLabel(option.id, t) }));
			const defaultOptions = panel.current !== null && !defaultChoices.some((option) => option.value === panel.current)
				? [{ value: panel.current, label: presetLabel(panel.current, t) }, ...defaultChoices]
				: defaultChoices;
			const defaultBusy = panel.status === "loading" || panel.status === "saving";
			/*
			 * The bulk picker offers the same selectable presets as a row. It starts
			 * with no value (null) rather than defaulting to a preset: a bulk control
			 * that arrives pre-armed is one stray click away from changing every
			 * selected session, and Apply stays disabled until a choice is made.
			 */
			const bulkOptions = panel.catalog.map((option) => ({ value: option.value, label: presetLabel(option.value, t) }));
			const defaultState = panel.status === "error"
				? text("wpLoadFailed") + (panel.error ?? "")
				: panel.status === "unavailable" ? text("wpDefaultUnavailable") : null;
			return React.createElement("div", { className: "dshk-page" }, [
				React.createElement("p", { className: "dshk-intro", key: "intro" }, t("wpIntro")),
				React.createElement("div", { className: "dshk-card", key: "default" }, [
					React.createElement("div", { className: "dshk-wpHead", key: "head" }, [
						React.createElement("h4", { key: "h" }, t("wpDefaultSection")),
						React.createElement(PresetDropdown, {
							key: "sel",
							value: panel.current,
							options: defaultOptions,
							disabled: panel.writable !== true || defaultBusy,
							onSwitch: switchDefault,
							placeholder: defaultBusy ? text("wpReading") : text("wpUnavailable"),
							t,
						}),
					]),
					React.createElement("div", { className: "dshk-hint", key: "hint" }, defaultState !== null ? defaultState : t("wpDefaultHint")),
				]),
				React.createElement("div", { className: "dshk-card", key: "sessions" }, [
					React.createElement("div", { className: "dshk-wpHead", key: "head" }, [
						React.createElement("div", { className: "dshk-wpHeadMain", key: "hmain" }, [
							/*
							 * Select-all lives beside the heading, and only when there is
							 * something selectable: a disabled checkbox over an empty or
							 * entirely unreadable list is noise that promises nothing.
							 */
							selectableRows.length > 0 ? React.createElement("label", { className: "dshk-pickAll", key: "all", title: t("wpSelectAll") }, React.createElement("input", {
								type: "checkbox",
								checked: allSelected,
								"aria-label": t("wpSelectAll"),
								onChange: toggleAll,
							})) : null,
							React.createElement("h4", { key: "h" }, t("wpSessionSection") + " · " + t("wpCount") + rows.length),
						]),
						React.createElement("button", {
							type: "button",
							className: "dshk-btn",
							key: "btn",
							onClick: () => {
								/* 0.2.1 has no client list store to refresh: re-read the Remote. */
								loadSessionCatalog().catch(() => {});
							},
						}, t("wpRefresh")),
					]),
					/*
					 * The bulk bar appears only once something is ticked. It carries its own
					 * preset picker and Apply button so the whole batch is one decision, and
					 * it shows the count because "apply to selected" is only trustworthy if
					 * the user can see how many that is.
					 */
					selectedCount > 0 ? React.createElement("div", { className: "dshk-bulk", key: "bulk" }, [
						React.createElement("span", { className: "dshk-bulkCount", key: "c" }, t("wpSelectedCount").replace("{n}", String(selectedCount))),
						React.createElement(PresetDropdown, {
							key: "sel",
							value: bulkPreset,
							options: bulkOptions,
							disabled: bulkBusy,
							onSwitch: (preset) => setBulkPreset(preset),
							t,
						}),
						React.createElement("button", {
							type: "button",
							className: "dshk-btn dshk-bulkApply",
							key: "apply",
							disabled: bulkPreset === null || bulkBusy,
							onClick: requestBulk,
						}, bulkBusy ? t("wpBulkWorking") : t("wpBulkApply")),
						React.createElement("button", {
							type: "button",
							className: "dshk-btn",
							key: "clear",
							disabled: bulkBusy,
							onClick: () => {
								setSelected(new Set());
								setBulkPreset(null);
							},
						}, t("wpBulkClear")),
					]) : null,
					rows.length === 0 ? React.createElement("div", { className: "dshk-wpState", key: "empty" }, t("wpEmpty")) : rows.map((row) => React.createElement(PermissionRow, {
						key: row.id,
						t,
						title: row.title,
						subtitle: row.subtitle,
						tags: row.tags,
						value: row.current,
						options: row.options,
						placeholder: row.placeholder,
						disabled: row.capable !== true,
						onSwitch: (preset) => switchSession(row, preset),
						/* Selection is offered only for rows that can actually be changed. */
						selectable: row.capable === true,
						selected: effectiveSelection.has(row.id),
						onToggle: () => toggleSelected(row.id),
					})),
					/*
					 * Say out loud what the archive filter removed. A row that vanishes
					 * without explanation reads as a bug; a count tells the user the
					 * session still exists and where it went (the archive), and that its
					 * permissions are deliberately not managed from here.
					 */
					archivedCount > 0 ? React.createElement("div", { className: "dshk-wpState", key: "archived" }, t("wpArchivedSkipped") + archivedCount) : null,
				]),
				problem !== null ? React.createElement("div", { className: "dshk-note", key: "problem" }, problem) : null,
				/*
				 * The Full-access confirmation is a CENTERED MODAL, portalled to <body>.
				 *
				 * It used to render as a card in the panel's own flow, i.e. after the whole
				 * session list - so with a long list the user had to scroll to the very bottom
				 * to find the dialog they had just triggered. A fixed overlay escapes the
				 * panel's scroll container entirely and puts the gate where the eye already is.
				 */
				gate !== null && gateHost !== null ? createPortal(React.createElement("div", {
					className: "dshk-overlay",
					key: "gate",
					onMouseDown: (event) => {
						if (event.target === event.currentTarget) setGate(null);
					},
				}, React.createElement("div", {
					className: "dshk-modal",
					role: "dialog",
					"aria-modal": "true",
					"aria-label": t("wpConfirmTitle"),
				}, [
					React.createElement("h4", { key: "h" }, t("wpConfirmTitle")),
					React.createElement("div", { className: "dshk-hint", key: "d" }, t("wpConfirmDesc")),
					React.createElement("label", { className: "dshk-switch dshk-modalAck", key: "ack" }, React.createElement("input", {
						type: "checkbox",
						autoFocus: true,
						checked: acknowledged,
						onChange: (event) => setAcknowledged(event.target.checked),
					}), text("wpAcknowledge")),
					React.createElement("div", { className: "dshk-keys", key: "btns" }, [
						React.createElement("button", {
							type: "button",
							className: "dshk-btn",
							key: "cancel",
							onClick: () => setGate(null),
						}, t("cancel")),
						React.createElement("button", {
							type: "button",
							className: "dshk-btn dshk-recording",
							key: "ok",
							disabled: acknowledged !== true,
							onClick: confirmGate,
						}, t("confirmEnable")),
					]),
				])), gateHost) : null,
			]);
		}

		ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({
			name: "settings.section",
			id: "workspace-permissions",
			order: 61,
			label: () => translate("wpNav"),
			locale: NS,
		}, PermissionsSection)), "dsh-permission-panel: permissions panel");
	}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
