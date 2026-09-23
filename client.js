window.__ModuleLoader__.load({
	id: "dsh-hotkey-toolkit",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const reactModule = require("react");
		const React = reactModule.default && reactModule.default.useState ? reactModule.default : reactModule;
		const reactDomModule = require("react-dom");
		const createPortal = reactDomModule.createPortal || (reactDomModule.default && reactDomModule.default.createPortal);

		/** Dictionary namespace owned by this plugin. */
		const NS = "hotkeyToolkit";
		/** Namespace of the Desktop-owned settings section this plugin drives. */
		const DESKTOP_NS = "dsh-desktop";
		/** Host settings namespace carrying the new-session default permission preset. */
		const PERMISSION_SETTINGS_NS = "permission";
		/** Fallback options for the default-preset cell when the schema offers none. */
		const FALLBACK_PRESETS = ["read-only", "workspace-write", "danger-full-access"];
		/** Default-preset options derived from the schema's own choices when available. */
		let defaultPresetOptions = (current) => FALLBACK_PRESETS.map((value) => ({ id: value, label: value }));
		/** Live sessions service binding + its list snapshot store (late-bound in apply). */
		let sessionsStore = null;
		let sessionsRef = null;
		/** localStorage key holding the user's shortcut preferences. */
		const STORAGE_KEY = "dsh.hotkeyToolkit.v1";
		/** Electron preload bridge exposing argument-free Desktop actions. */
		const ACTIONS_BRIDGE = "dshDesktopActions";
		/** Loopback fallbacks, used when the renderer runs without the preload bridge. */
		const RELOAD_PATH = "/api/desktop/developer/reload";
		const RESTART_PATH = "/api/desktop/restart";

		const zh = {
			nav: "快捷键工具包",
			title: "快捷键工具包",
			intro: "全屏生效的快捷键：刷新界面、重启 DSH，以及切换窗口模式。改动即时生效，无需重载。",
			enable: "启用快捷键",
			enableHint: "关闭后所有快捷键立即失效（模型搜索不受影响）。",
			actionSection: "动作快捷键",
			refresh: "刷新界面",
			refreshHint: "重新加载渲染进程；插件与设置都会重新读取。",
			restart: "重启 DSH",
			restartHint: "重新启动 DSH Desktop 应用。",
			modeSection: "模式切换快捷键",
			modeHint: "切换窗口模式需要重启 DSH 才会生效；按下快捷键后会先保存设置，再自动重启。",
			modeCompatibility: "兼容模式",
			modeExtended: "扩展模式",
			modeAdvanced: "增强模式",
			current: "当前模式",
			record: "录制",
			recording: "请按下组合键…（Esc 取消）",
			clear: "清除",
			unset: "未设置",
			conflict: "该组合键已被占用，请换一个。",
			needModifier: "组合键至少需要 Ctrl / Alt / Win 之一。",
			reset: "恢复默认",
			saved: "已保存。",
			savedRestarting: "模式已保存，DSH 正在重启…",
			restarting: "DSH 正在重启…",
			reloading: "正在刷新界面…",
			modeApplied: "已切换到",
			searchPlaceholder: "搜索模型…",
			searchEmpty: "没有匹配的模型",
			searchClear: "清除搜索",
			modeFailed: "模式切换失败：",
			actionFailed: "操作失败：",
			wpNav: "工作区权限",
			wpIntro: "查看并调整每个会话的工作区权限（沙盒模式 + 审批策略），并可设置新会话的默认权限；改动即时生效。",
			wpSessionSection: "会话权限",
			wpDefaultSection: "新会话默认权限",
			wpDefaultHint: "仅对之后新建的会话生效，已有会话不受影响。",
			wpRefresh: "刷新列表",
			wpEmpty: "当前没有会话。",
			wpUnavailable: "不可用",
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
			nav: "Hotkey Toolkit",
			title: "Hotkey Toolkit",
			intro: "App-wide shortcuts: refresh the interface, restart DSH, and switch the window mode. Changes apply immediately, no reload needed.",
			enable: "Enable shortcuts",
			enableHint: "Turning this off disables every shortcut at once (model search is unaffected).",
			actionSection: "Action shortcuts",
			refresh: "Refresh interface",
			refreshHint: "Reloads the renderer; plugins and settings are read again.",
			restart: "Restart DSH",
			restartHint: "Relaunches the DSH Desktop application.",
			modeSection: "Mode switch shortcuts",
			modeHint: "Switching the window mode requires a DSH restart; the shortcut saves the setting and then restarts automatically.",
			modeCompatibility: "Compatibility mode",
			modeExtended: "Extended mode",
			modeAdvanced: "Advanced mode",
			current: "Current mode",
			record: "Record",
			recording: "Press a combination… (Esc cancels)",
			clear: "Clear",
			unset: "Unset",
			conflict: "That combination is already taken.",
			needModifier: "A combination needs at least Ctrl / Alt / Win.",
			reset: "Restore defaults",
			saved: "Saved.",
			savedRestarting: "Mode saved — DSH is restarting…",
			restarting: "DSH is restarting…",
			reloading: "Refreshing the interface…",
			modeApplied: "Switched to",
			searchPlaceholder: "Search models…",
			searchEmpty: "No matching model",
			searchClear: "Clear search",
			modeFailed: "Mode switch failed: ",
			actionFailed: "Operation failed: ",
			wpNav: "Workspace Permissions",
			wpIntro: "View and adjust each session's workspace permissions (sandbox mode + approval policy), plus the default for new sessions. Changes apply immediately.",
			wpSessionSection: "Session permissions",
			wpDefaultSection: "Default permission for new sessions",
			wpDefaultHint: "Applies to sessions created afterwards only; existing sessions keep their permissions.",
			wpRefresh: "Refresh list",
			wpEmpty: "No sessions right now.",
			wpUnavailable: "Unavailable",
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
			".dshk-toast{position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:2147483003;padding:9px 16px;border-radius:10px;background:var(--dsw-specific-menu,#26282d);color:var(--dsw-alias-label-primary,#e8eaee);box-shadow:var(--dsw-elevation-prominent,0 10px 32px rgba(0,0,0,.35));border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.24));font-size:12px;line-height:18px;pointer-events:none;max-width:min(420px,90vw);text-align:center}",
			".dshk-root{min-width:0;position:relative}",
			".dshk-trigger{min-width:0;max-width:min(360px,45cqw);height:28px;color:var(--dsw-alias-label-secondary,#c8ccd4);cursor:pointer;background:0 0;border:none;border-radius:24px;outline:none;align-items:center;gap:4px;padding:0 4px 0 8px;font-size:13px;font-weight:500;line-height:20px;display:flex}",
			".dshk-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14))}",
			".dshk-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3,rgba(128,128,128,.45))}",
			".dshk-trigger:disabled{color:var(--dsw-alias-label-dimmed,#7b828c);cursor:default}",
			".dshk-triggerLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}",
			".dshk-triggerEffort{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-caption,#9aa0aa);flex-shrink:1000;overflow:hidden}",
			".dshk-triggerIcon{flex:none;display:none}",
			"@container (width<=360px){.dshk-triggerIcon{display:block}.dshk-triggerLabel,.dshk-triggerEffort{display:none}}",
			".dshk-chevron{color:var(--dsw-alias-label-caption,#9aa0aa);flex:none;transition:transform .12s}",
			".dshk-chevronOpen{transform:rotate(180deg)}",
			".dshk-menu{z-index:1100;background:var(--dsw-specific-menu,#26282d);width:max-content;min-width:min(240px,100vw - 32px);max-width:min(420px,100vw - 32px);max-height:min(360px,100vh - 96px);box-shadow:var(--dsw-elevation-prominent,0 10px 32px rgba(0,0,0,.35));color:var(--dsw-alias-label-primary,#e8eaee);border:0;border-radius:20px;flex-direction:column;padding:4px;display:flex;position:fixed;overflow:hidden}",
			".dshk-status,.dshk-empty{color:var(--dsw-alias-label-tertiary,#9aa0aa);padding:10px;font-size:13px;line-height:20px}",
			".dshk-error{background:var(--dsw-alias-interactive-bg-hover-danger,rgba(224,80,80,.14));color:var(--dsw-alias-state-error-primary,#e05a5a);border-radius:8px;margin-bottom:4px;padding:7px 8px;font-size:12px;line-height:18px}",
			".dshk-searchWrap{padding:2px 4px 6px;flex:none}",
			".dshk-search{display:flex;align-items:center;gap:6px;height:32px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08))}",
			".dshk-search:focus-within{border-color:var(--dsw-alias-border-l3,rgba(128,128,128,.5))}",
			".dshk-searchIcon{flex:none;color:var(--dsw-alias-label-caption,#9aa0aa)}",
			".dshk-searchInput{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary,#e8eaee);font:inherit;font-size:13px;line-height:20px}",
			".dshk-searchInput::placeholder{color:var(--dsw-alias-label-dimmed,#7b828c)}",
			".dshk-searchClear{flex:none;display:grid;place-items:center;width:18px;height:18px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--dsw-alias-label-caption,#9aa0aa);cursor:pointer}",
			".dshk-searchClear:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.16));color:var(--dsw-alias-label-primary,#e8eaee)}",
			".dshk-groups{min-height:0;overflow-y:auto;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}",
			".dshk-group+.dshk-group{margin-top:4px}",
			".dshk-groupTitle{z-index:1;background:var(--dsw-specific-menu,#26282d);color:var(--dsw-alias-label-tertiary,#9aa0aa);padding:5px 8px 3px;font-size:12px;font-weight:500;line-height:18px;position:sticky;top:0}",
			".dshk-option{box-sizing:border-box;width:auto;min-width:100%;min-height:38px;color:inherit;text-align:left;cursor:pointer;background:0 0;border:none;border-radius:10px;outline:none;align-items:center;gap:8px;padding:6px 8px;display:flex}",
			".dshk-option:hover:not(:disabled),.dshk-option:focus-visible{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14))}",
			".dshk-option:disabled{color:var(--dsw-alias-label-dimmed,#7b828c);cursor:default}",
			".dshk-optionCopy{flex-direction:column;flex:1;min-width:0;display:flex}",
			".dshk-modelName{color:inherit;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:20px;overflow:hidden}",
			".dshk-modelId{color:var(--dsw-alias-label-caption,#9aa0aa);text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:16px;overflow:hidden}",
			".dshk-check{color:var(--dsw-alias-label-primary,#e8eaee);flex:0 0 18px;place-items:center;display:grid}",
			".dshk-cell{box-sizing:border-box;width:auto;min-width:100%;height:40px;color:var(--dsw-alias-label-primary,#e8eaee);cursor:pointer;text-align:left;background:0 0;border:none;border-radius:10px;align-items:center;gap:8px;padding:0 10px;font-size:14px;line-height:22px;display:flex}",
			".dshk-cell:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14))}",
			".dshk-cellLabel{white-space:nowrap;flex:none}",
			".dshk-cellValue{text-overflow:ellipsis;white-space:nowrap;text-align:right;min-width:0;color:var(--dsw-alias-label-tertiary,#9aa0aa);flex:auto;overflow:hidden}",
			".dshk-cellChevron{color:var(--dsw-alias-label-tertiary,#9aa0aa);flex:none}",
		".dshk-wpHead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px}",
		".dshk-wpRow{display:flex;align-items:center;gap:12px;padding:9px 0;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.16))}",
		".dshk-wpRow:first-of-type{border-top:none}",
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
		const STYLE_ID = "dsh-hotkey-toolkit-styles";

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

		const MODE_IDS = ["compatibility", "extended", "advanced"];

		/** Shipped defaults: every action reachable without colliding with browser defaults. */
		const DEFAULT_CONFIG = {
			enabled: true,
			refresh: "Ctrl+R",
			restart: "Ctrl+Shift+R",
			modes: {
				compatibility: "Ctrl+Alt+1",
				extended: "Ctrl+Alt+2",
				advanced: "Ctrl+Alt+3",
			},
		};

		/** Narrow one stored combo to a usable string, or null when unusable. */
		function readCombo(value) {
			return typeof value === "string" && value.length > 0 && value.length <= 64 ? value : null;
		}

		/**
		 * Resolve one stored action field.
		 *
		 * An ABSENT field keeps the shipped default; a present-but-unusable one (the
		 * Clear button writes null) stays unbound. Collapsing the two onto readCombo
		 * would resurrect the default the user just cleared.
		 * @param container - the stored object holding the field.
		 * @param field - field name.
		 * @param fallback - the shipped default used when the field is absent.
		 * @returns the bound combo, or null when the user cleared it.
		 */
		function readField(container, field, fallback) {
			if (!Object.prototype.hasOwnProperty.call(container, field)) return fallback;
			return readCombo(container[field]);
		}

		/** Merge a stored payload over the defaults, rejecting malformed fields. */
		function normalizeConfig(raw) {
			const next = {
				enabled: DEFAULT_CONFIG.enabled,
				refresh: DEFAULT_CONFIG.refresh,
				restart: DEFAULT_CONFIG.restart,
				modes: {
					compatibility: DEFAULT_CONFIG.modes.compatibility,
					extended: DEFAULT_CONFIG.modes.extended,
					advanced: DEFAULT_CONFIG.modes.advanced,
				},
			};
			if (raw === null || typeof raw !== "object") return next;
			if (typeof raw.enabled === "boolean") next.enabled = raw.enabled;
			next.refresh = readField(raw, "refresh", DEFAULT_CONFIG.refresh);
			next.restart = readField(raw, "restart", DEFAULT_CONFIG.restart);
			if (raw.modes !== null && typeof raw.modes === "object") {
				for (const id of MODE_IDS) next.modes[id] = readField(raw.modes, id, DEFAULT_CONFIG.modes[id]);
			}
			return next;
		}

		/**
		 * Shortcut preference store: one module-level snapshot so the settings page and
		 * the global key handler always read the same value. Persistence rides
		 * localStorage, mirroring the other client-only DSH plugins; the key handler
		 * reads the live snapshot on every keystroke, so a change needs no rebind.
		 */
		function createConfigStore() {
			let snapshot = DEFAULT_CONFIG;
			const listeners = new Set();
			const emit = () => {
				for (const listener of listeners) listener();
			};
			try {
				const stored = window.localStorage.getItem(STORAGE_KEY);
				if (stored !== null) snapshot = normalizeConfig(JSON.parse(stored));
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
				reset() {
					snapshot = normalizeConfig(DEFAULT_CONFIG);
					try {
						window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
					} catch {}
					emit();
				},
			};
		}
		const configStore = createConfigStore();
		/** Subscribe React to the shortcut store. */
		function useConfig() {
			return React.useSyncExternalStore((listener) => configStore.subscribe(listener), () => configStore.getSnapshot());
		}

		/** event.code values that are themselves modifiers (never a combo key). */
		const MODIFIER_CODES = {
			ControlLeft: "Ctrl",
			ControlRight: "Ctrl",
			AltLeft: "Alt",
			AltRight: "Alt",
			ShiftLeft: "Shift",
			ShiftRight: "Shift",
			MetaLeft: "Meta",
			MetaRight: "Meta",
		};
		/** event.code to displayable key token, for codes whose name is not the token. */
		const KEY_ALIASES = {
			Space: "Space",
			Comma: ",",
			Period: ".",
			Slash: "/",
			Semicolon: ";",
			Quote: "'",
			BracketLeft: "[",
			BracketRight: "]",
			Minus: "-",
			Equal: "=",
			Backquote: "Backquote",
			Backslash: "Backslash",
			Enter: "Enter",
			NumpadEnter: "Enter",
			Tab: "Tab",
			Delete: "Delete",
			Backspace: "Backspace",
			Insert: "Insert",
			Home: "Home",
			End: "End",
			PageUp: "PageUp",
			PageDown: "PageDown",
			ArrowUp: "ArrowUp",
			ArrowDown: "ArrowDown",
			ArrowLeft: "ArrowLeft",
			ArrowRight: "ArrowRight",
		};

		/** Resolve one KeyboardEvent's non-modifier key token, or null for a bare modifier. */
		function keyTokenOf(event) {
			const code = typeof event.code === "string" ? event.code : "";
			if (code === "" || MODIFIER_CODES[code] !== void 0) return null;
			if (code.startsWith("Key") && code.length === 4) return code.slice(3).toUpperCase();
			if (code.startsWith("Digit") && code.length === 6) return code.slice(5);
			if (code.startsWith("Numpad") && code.length === 7) return code.slice(6);
			if (/^F[0-9]{1,2}$/.test(code)) return code;
			if (KEY_ALIASES[code] !== void 0) return KEY_ALIASES[code];
			return code;
		}

		/** Canonicalise one keydown into a stable combo string, or null when unusable. */
		function comboFromEvent(event) {
			const token = keyTokenOf(event);
			if (token === null) return null;
			const parts = [];
			if (event.ctrlKey) parts.push("Ctrl");
			if (event.altKey) parts.push("Alt");
			if (event.shiftKey) parts.push("Shift");
			if (event.metaKey) parts.push("Meta");
			if (parts.length === 0) return null;
			return parts.concat([token]).join("+");
		}

		/** Whether a recorded combo is safe to bind: at least one strong modifier. */
		function isBindable(combo) {
			if (typeof combo !== "string" || combo.length === 0) return false;
			const parts = combo.split("+");
			return parts.includes("Ctrl") || parts.includes("Alt") || parts.includes("Meta");
		}

		/** Render one combo as keycaps. */
		function keyCaps(combo, t) {
			if (combo === null || combo === void 0 || combo === "") return React.createElement("span", { className: "dshk-key dshk-unset" }, t("unset"));
			return combo.split("+").map((part, index) => React.createElement("span", { className: "dshk-key", key: index }, part));
		}

		/** Invoke one argument-free Desktop action, preferring the preload bridge. */
		async function desktopAction(action) {
			const bridge = typeof window !== "undefined" ? window[ACTIONS_BRIDGE] : void 0;
			if (bridge !== void 0 && bridge !== null && typeof bridge.invoke === "function") {
				await bridge.invoke(action);
				return;
			}
			const path = action === "reload" ? RELOAD_PATH : RESTART_PATH;
			const response = await fetch(path, {
				method: "POST",
				credentials: "same-origin",
				redirect: "error",
				cache: "no-store",
				headers: { "content-type": "application/json" },
				body: "{}",
			});
			if (!response.ok) throw new Error("HTTP " + String(response.status));
		}

		/** Read the mode this renderer booted with, from the Electron-owned URL marker. */
		function currentMode() {
			if (typeof window === "undefined") return null;
			try {
				const value = new URLSearchParams(window.location.search).get("dsh-desktop-mode");
				return MODE_IDS.includes(value) ? value : null;
			} catch {
				return null;
			}
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

		/** Refresh the interface through the Desktop-owned reload action. */
		async function refreshInterface() {
			notify(text("reloading"));
			await desktopAction("reload");
		}

		/** Relaunch DSH Desktop through the Desktop-owned restart action. */
		async function restartApplication() {
			notify(text("restarting"));
			await desktopAction("restart");
		}

		/**
		 * Switch the window mode.
		 *
		 * Writes ride the same Host settings the Desktop settings page uses, in the
		 * order that page established: a non-compatibility mode withdraws browser and
		 * LAN access BEFORE the mode lands, so the app never boots a mode the
		 * marker-free carrier cannot render. The Desktop Host watches this namespace
		 * and relaunches itself when mode/port/material move, so no explicit restart
		 * call is needed here: writing the mode IS the restart trigger.
		 * @param scope - bound dsh-desktop settings scope, or undefined when absent.
		 * @param mode - target mode.
		 */
		async function switchMode(scope, mode) {
			if (scope === void 0 || scope === null) throw new Error("settings scope unavailable");
			if (mode !== "compatibility") {
				await scope.set("networkExposure", "loopback");
				await scope.set("openBrowser", false);
			}
			await scope.set("mode", mode);
			notify(text("savedRestarting"));
		}

		/** Preset machine value that must pass an explicit risk gate before switching. */
		const FULL_ACCESS_PRESET = "danger-full-access";
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

		/**
		 * Subscribe React to the sessions list snapshot (useSyncExternalStore:
		 * plain subscribe + getSnapshot on the controller's snapshot store).
		 */
		function useSessions() {
			return React.useSyncExternalStore(
				(listener) => sessionsStore.subscribe(listener),
				() => sessionsStore.getSnapshot(),
			);
		}

		/** One recorded-shortcut row: label, optional hint, keycaps, and controls. */
		function ShortcutRow(props) {
			const { t, label, hint, combo, onRecord, recording, onClear } = props;
			return React.createElement("div", { className: "dshk-row" }, [
				React.createElement("div", { className: "dshk-rowCopy", key: "copy" }, [
					React.createElement("div", { className: "dshk-rowLabel", key: "l" }, label),
					hint !== void 0 && hint !== "" ? React.createElement("div", { className: "dshk-rowHint", key: "h" }, hint) : null,
				]),
				React.createElement("div", { className: "dshk-keys", key: "keys" }, [
					recording
						? React.createElement("span", { className: "dshk-key", key: "rec" }, t("recording"))
						: React.createElement(React.Fragment, { key: "caps" }, keyCaps(combo, t)),
					React.createElement("button", {
						type: "button",
						className: recording ? "dshk-btn dshk-recording" : "dshk-btn",
						key: "btn",
						onClick: onRecord,
					}, recording ? t("recording") : t("record")),
					React.createElement("button", {
						type: "button",
						className: "dshk-btn",
						key: "clr",
						onClick: onClear,
					}, t("clear")),
				]),
			]);
		}

		/**
		 * Settings page.
		 *
		 * Owns nothing but this plugin's own localStorage preferences: which combos are
		 * bound, and whether the whole set is armed. Mode switching itself rides the
		 * Desktop Host's settings; this page never writes them directly.
		 */
		function SettingsSection(props) {
			const { t } = props;
			const config = useConfig();
			const [recording, setRecording] = React.useState(null);
			const [problem, setProblem] = React.useState(null);
			const mode = currentMode();
			const modeLabel = mode === null ? null : t("mode" + mode.charAt(0).toUpperCase() + mode.slice(1));

			/*
			 * Stand the global listener down while this page captures a combination.
			 * Both listeners sit in the window capture phase and the global one registered
			 * first, so without this flag the OLD binding would fire mid-recording.
			 */
			React.useEffect(() => {
				recordingActive = recording !== null;
				return () => {
					recordingActive = false;
				};
			}, [recording]);

			React.useEffect(() => {
				if (recording === null) return;
				const onKeyDown = (event) => {
					event.preventDefault();
					event.stopPropagation();
					if (event.key === "Escape") {
						setRecording(null);
						return;
					}
					const combo = comboFromEvent(event);
					if (combo === null) return;
					if (!isBindable(combo)) {
						setProblem(t("needModifier"));
						return;
					}
					const taken = [config.refresh, config.restart].concat(MODE_IDS.map((id) => config.modes[id]));
					const others = taken.filter((entry) => entry !== null && entry !== recording.combo);
					if (others.includes(combo)) {
						setProblem(t("conflict"));
						return;
					}
					setProblem(null);
					if (recording.kind === "mode") configStore.update({ modes: { ...config.modes, [recording.mode]: combo } });
					else configStore.update({ [recording.kind]: combo });
					setRecording(null);
				};
				window.addEventListener("keydown", onKeyDown, true);
				return () => {
					window.removeEventListener("keydown", onKeyDown, true);
				};
			}, [recording, config, t]);

			const record = (kind, combo, modeId) => {
				setProblem(null);
				setRecording(recording !== null && recording.kind === kind && recording.mode === modeId ? null : { kind, combo, mode: modeId });
			};
			const clear = (kind, modeId) => {
				setProblem(null);
				setRecording(null);
				if (kind === "mode") configStore.update({ modes: { ...config.modes, [modeId]: null } });
				else configStore.update({ [kind]: null });
			};

			const header = modeLabel === null ? t("actionSection") : t("actionSection") + " · " + t("current") + ": " + modeLabel;
			return React.createElement("div", { className: "dshk-page" }, [
				React.createElement("p", { className: "dshk-intro", key: "intro" }, t("intro")),
				React.createElement("div", { className: "dshk-card", key: "enable" }, React.createElement("div", { className: "dshk-row" }, [
					React.createElement("div", { className: "dshk-rowCopy", key: "c" }, [
						React.createElement("div", { className: "dshk-rowLabel", key: "l" }, t("enable")),
						React.createElement("div", { className: "dshk-rowHint", key: "h" }, t("enableHint")),
					]),
					React.createElement("label", { className: "dshk-switch", key: "s" }, React.createElement("input", {
						type: "checkbox",
						checked: config.enabled,
						onChange: (event) => configStore.update({ enabled: event.target.checked }),
					})),
				])),
				React.createElement("div", { className: "dshk-card", key: "actions" }, [
					React.createElement("h4", { key: "h" }, header),
					React.createElement("div", { className: "dshk-hint", key: "hh" }, t("refreshHint")),
					React.createElement(ShortcutRow, {
						key: "refresh",
						t,
						label: t("refresh"),
						combo: config.refresh,
						recording: recording !== null && recording.kind === "refresh",
						onRecord: () => record("refresh", config.refresh),
						onClear: () => clear("refresh"),
					}),
					React.createElement(ShortcutRow, {
						key: "restart",
						t,
						label: t("restart"),
						combo: config.restart,
						recording: recording !== null && recording.kind === "restart",
						onRecord: () => record("restart", config.restart),
						onClear: () => clear("restart"),
					}),
				]),
				React.createElement("div", { className: "dshk-card", key: "modes" }, [
					React.createElement("h4", { key: "h" }, t("modeSection")),
					React.createElement("div", { className: "dshk-hint", key: "hh" }, t("modeHint")),
					...MODE_IDS.map((id) => React.createElement(ShortcutRow, {
						key: id,
						t,
						label: t("mode" + id.charAt(0).toUpperCase() + id.slice(1)),
						hint: mode === id ? t("current") : void 0,
						combo: config.modes[id],
						recording: recording !== null && recording.kind === "mode" && recording.mode === id,
						onRecord: () => record("mode", config.modes[id], id),
						onClear: () => clear("mode", id),
					})),
				]),
				problem !== null ? React.createElement("div", { className: "dshk-note", key: "problem" }, problem) : null,
				React.createElement("div", { className: "dshk-card", key: "reset" }, React.createElement("button", {
					type: "button",
					className: "dshk-btn",
					onClick: () => {
						setRecording(null);
						setProblem(null);
						configStore.reset();
					},
				}, t("reset"))),
			]);
		}

		/** Search glyph: keeps the seat free of the primitives package. */
		function SearchIcon() {
			return React.createElement("svg", { className: "dshk-searchIcon", width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" }, React.createElement("path", {
				d: "M7.25 12.5a5.25 5.25 0 1 0 0-10.5 5.25 5.25 0 0 0 0 10.5Zm3.9-1.35 3.1 3.1",
				stroke: "currentColor",
				strokeWidth: "1.4",
				strokeLinecap: "round",
			}));
		}
		/** Clear glyph for the search field. */
		function ClearIcon() {
			return React.createElement("svg", { width: 10, height: 10, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" }, React.createElement("path", {
				d: "M3.5 3.5l9 9m0-9l-9 9",
				stroke: "currentColor",
				strokeWidth: "1.6",
				strokeLinecap: "round",
			}));
		}
		/** Right chevron used by the root pane's drill-in cells. */
		function ChevronRight() {
			return React.createElement("svg", { className: "dshk-cellChevron", width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" }, React.createElement("path", {
				d: "M6 3.5l4.5 4.5L6 12.5",
				stroke: "currentColor",
				strokeWidth: "1.4",
				strokeLinecap: "round",
				strokeLinejoin: "round",
			}));
		}
		/** Down chevron for the trigger. */
		function ChevronDown(props) {
			return React.createElement("svg", { className: props.className, width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" }, React.createElement("path", {
				d: "M4 6.25 8 10.25l4-4",
				stroke: "currentColor",
				strokeWidth: "1.4",
				strokeLinecap: "round",
				strokeLinejoin: "round",
			}));
		}
		/** Selected-model check. */
		function CheckIcon() {
			return React.createElement("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" }, React.createElement("path", {
				d: "M3.5 8.5 6.5 11.5 12.5 4.5",
				stroke: "currentColor",
				strokeWidth: "1.5",
				strokeLinecap: "round",
				strokeLinejoin: "round",
			}));
		}
		/** Model glyph shown when the trigger collapses to its icon. */
		function ModelIcon() {
			return React.createElement("svg", { className: "dshk-triggerIcon", width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" }, React.createElement("path", {
				d: "M8 2.5 14 6v4.5L8 14 2 10.5V6l6-3.5Z",
				stroke: "currentColor",
				strokeWidth: "1.3",
				strokeLinejoin: "round",
			}));
		}

		/** Case-insensitive substring test over the fields a user may search by. */
		function matchesQuery(model, group, needle) {
			if (needle === "") return true;
			if (String(model.name).toLowerCase().includes(needle)) return true;
			if (String(model.id).toLowerCase().includes(needle)) return true;
			if (String(group.name).toLowerCase().includes(needle)) return true;
			if (String(group.id).toLowerCase().includes(needle)) return true;
			return false;
		}

		/**
		 * The composer's model seat: the official two-level Model/Effort menu with a
		 * model search field on top of the provider-grouped list.
		 *
		 * Registered at a LOWER priority than the shipped seat, so this renders while
		 * the plugin is live and the official seat returns untouched on unload or on any
		 * crash that abdicates this entry. The injected face is the official one (the
		 * shared per-session ModelDirectory store and verbs), which is what keeps this
		 * seat and the /model popup reading one state.
		 */
		function ModelSelect(props) {
			const { locked, available, directory, load, select, t } = props;
			const state = React.useSyncExternalStore((fn) => directory.subscribe(fn), () => directory.getSnapshot());
			const [open, setOpen] = React.useState(false);
			const [pane, setPane] = React.useState("root");
			const [query, setQuery] = React.useState("");
			const [menuPos, setMenuPos] = React.useState(null);
			const [failure, setFailure] = React.useState(null);
			const rootRef = React.useRef(null);
			const triggerRef = React.useRef(null);
			const menuRef = React.useRef(null);
			const searchRef = React.useRef(null);
			const itemRefs = React.useRef([]);
			const id = React.useId();

			const choices = React.useMemo(() => state.groups.flatMap((group) => group.models.map((model) => ({
				group,
				model,
				selection: {
					provider: group.id,
					model: model.id,
					...(model.reasoning?.defaultEffort === void 0 ? {} : { reasoningEffort: model.reasoning.defaultEffort }),
				},
			}))), [state.groups]);
			const currentIndex = state.current === null ? -1 : choices.findIndex((c) => c.selection.provider === state.current.provider && c.selection.model === state.current.model);
			const currentChoice = choices[currentIndex];
			const reasoning = currentChoice?.model.reasoning;
			const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort;
			const effortLabel = reasoning === void 0 ? void 0 : effectiveEffort === void 0 ? t("effort.providerDefault") : (reasoning.efforts.find((level) => level.id === effectiveEffort)?.name ?? effectiveEffort);
			const effortChoices = React.useMemo(() => reasoning === void 0 ? [] : [
				...(reasoning.defaultEffort === void 0 ? [{ key: "provider-default", effort: void 0, label: t("effort.providerDefault") }] : []),
				...reasoning.efforts.map((effort) => ({ key: "effort:" + effort.id, effort: effort.id, label: effort.name })),
			], [reasoning, t]);
			const busy = state.status === "selecting";

			const needle = query.trim().toLowerCase();
			/*
			 * Provider groups narrowed to the models that MATCH. The narrowed list has to
			 * survive the fold: returning the group itself would list every sibling the user
			 * just filtered out.
			 */
			const filtered = React.useMemo(() => {
				if (needle === "") return state.groups.map((group) => ({ group, models: group.models }));
				return state.groups.map((group) => ({
					group,
					models: group.models.filter((model) => matchesQuery(model, group, needle)),
				})).filter((entry) => entry.models.length > 0);
			}, [state.groups, needle]);
			const flatFiltered = React.useMemo(() => filtered.flatMap((entry) => entry.models.map((model) => ({ group: entry.group, model }))), [filtered]);

			React.useEffect(() => {
				if (!open) return;
				const closeOutside = (event) => {
					if (rootRef.current?.contains(event.target) === true) return;
					if (menuRef.current?.contains(event.target) === true) return;
					setOpen(false);
				};
				document.addEventListener("mousedown", closeOutside);
				return () => {
					document.removeEventListener("mousedown", closeOutside);
				};
			}, [open]);
			React.useLayoutEffect(() => {
				if (!open) {
					setMenuPos(null);
					return;
				}
				const place = () => {
					const rect = triggerRef.current?.getBoundingClientRect();
					if (rect === void 0) return;
					const MARGIN = 12;
					const lw = menuRef.current?.offsetWidth ?? 0;
					const lh = menuRef.current?.offsetHeight ?? 0;
					let x = rect.right - lw;
					let y = rect.top - 8 - lh;
					if (lw > 0) x = Math.min(Math.max(x, MARGIN), window.innerWidth - lw - MARGIN);
					if (lh > 0) y = Math.min(Math.max(y, MARGIN), window.innerHeight - lh - MARGIN);
					setMenuPos({ left: x, top: y });
				};
				place();
				window.addEventListener("scroll", place, true);
				window.addEventListener("resize", place);
				return () => {
					window.removeEventListener("scroll", place, true);
					window.removeEventListener("resize", place);
				};
			}, [open, pane, state, query]);
			React.useEffect(() => {
				if (!open || pane !== "model" || menuPos === null) return;
				searchRef.current?.focus();
			}, [open, pane, menuPos]);

			if (!available) return null;

			const show = () => {
				setPane("model");
				setQuery("");
				setFailure(null);
				setOpen(true);
				load();
			};
			const close = (restoreFocus = false) => {
				setOpen(false);
				setPane("root");
				setQuery("");
				if (restoreFocus) queueMicrotask(() => {
					triggerRef.current?.focus();
				});
			};
			const moveFocus = (offset) => {
				const items = itemRefs.current.filter((item) => item !== null && item !== void 0);
				if (items.length === 0) return;
				const active = items.findIndex((item) => item === document.activeElement);
				items[(Math.max(active, 0) + offset + items.length) % items.length]?.focus();
			};
			const onRootKeyDown = (event) => {
				if (event.key === "Escape" && open) {
					event.preventDefault();
					if (pane !== "root") {
						setPane("root");
						setQuery("");
					} else close(true);
					return;
				}
				if (!open) return;
				if (event.key === "ArrowDown" || event.key === "ArrowUp") {
					if (pane === "model" && document.activeElement === searchRef.current) return;
					event.preventDefault();
					moveFocus(event.key === "ArrowDown" ? 1 : -1);
				}
			};
			const onBlur = (event) => {
				if (event.relatedTarget instanceof Node && (rootRef.current?.contains(event.relatedTarget) === true || menuRef.current?.contains(event.relatedTarget) === true)) return;
				close();
			};
			const settle = (accepted) => {
				if (accepted) {
					if (rootRef.current !== null) close(true);
					return;
				}
				setFailure(directory.getSnapshot().error ?? t("retry"));
			};
			const choose = (selection) => {
				if (state.current?.provider === selection.provider && state.current.model === selection.model && selection.reasoningEffort === void 0) {
					close(true);
					return;
				}
				setFailure(null);
				select(selection).then(settle, () => setFailure(directory.getSnapshot().error ?? t("retry")));
			};
			const chooseEffort = (effort) => {
				if (state.current === null) return;
				if (effectiveEffort === effort) {
					close(true);
					return;
				}
				const selection = {
					provider: state.current.provider,
					model: state.current.model,
					...(effort === void 0 ? {} : { reasoningEffort: effort }),
				};
				setFailure(null);
				select(selection).then(settle, () => setFailure(directory.getSnapshot().error ?? t("retry")));
			};

			const waiting = state.current === null && state.status === "loading";
			const modelLabel = waiting ? t("trigger.loading") : (currentChoice?.model.name ?? (state.current === null ? t("trigger.fallback") : state.current.provider + "/" + state.current.model));
			const triggerLabel = effortLabel === void 0 ? modelLabel : modelLabel + " \u00b7 " + effortLabel;
			const triggerAria = waiting ? t("trigger.loading") : state.current === null ? t("trigger.selectAria") : (effortLabel === void 0 ? t("trigger.aria", { model: modelLabel }) : t("trigger.ariaEffort", { model: modelLabel, effort: effortLabel }));

			itemRefs.current = [];
			let itemIndex = 0;
			const itemRef = () => {
				const at = itemIndex++;
				return (node) => {
					itemRefs.current[at] = node;
				};
			};

			const modelPane = [];
			if (reasoning !== void 0) modelPane.push(React.createElement("button", {
				ref: itemRef(),
				type: "button",
				role: "menuitem",
				className: "dshk-cell",
				key: "effort",
				onClick: () => setPane("effort"),
			}, [
				React.createElement("span", { className: "dshk-cellLabel", key: "l" }, t("menu.effort")),
				React.createElement("span", { className: "dshk-cellValue", key: "v" }, effortLabel),
				React.createElement(ChevronRight, { key: "c" }),
			]));
			const searchField = React.createElement("div", { className: "dshk-searchWrap", key: "search" }, React.createElement("div", { className: "dshk-search" }, [
				React.createElement(SearchIcon, { key: "icon" }),
				React.createElement("input", {
					key: "input",
					ref: searchRef,
					className: "dshk-searchInput",
					type: "text",
					value: query,
					placeholder: t("searchPlaceholder"),
					"aria-label": t("searchPlaceholder"),
					onChange: (event) => setQuery(event.target.value),
					onKeyDown: (event) => {
						if (event.key === "Escape" && query !== "") {
							event.preventDefault();
							event.stopPropagation();
							setQuery("");
							return;
						}
						if (event.key === "Enter" && flatFiltered.length > 0) {
							event.preventDefault();
							choose({ provider: flatFiltered[0].group.id, model: flatFiltered[0].model.id });
						}
					},
				}),
				query === "" ? null : React.createElement("button", {
					key: "clear",
					type: "button",
					className: "dshk-searchClear",
					title: t("searchClear"),
					"aria-label": t("searchClear"),
					onClick: () => setQuery(""),
				}, React.createElement(ClearIcon, {})),
			]));
			modelPane.push(searchField);
			if (state.status === "loading") modelPane.push(React.createElement("div", { className: "dshk-status", key: "loading" }, t("status.loading")));
			if (failure !== null) modelPane.push(React.createElement("div", { className: "dshk-error", key: "failure" }, failure));
			for (const entry of state.failures) modelPane.push(React.createElement("div", { className: "dshk-error", key: "fail:" + entry.id }, t("warning.groupLoad", { name: entry.name, message: entry.message })));
			modelPane.push(React.createElement("div", { className: "dshk-groups", key: "groups" }, filtered.map((entry) => {
				const group = entry.group;
				const headingId = id + "-" + group.id;
				return React.createElement("section", { role: "group", "aria-labelledby": headingId, className: "dshk-group", key: group.id }, [
					React.createElement("div", { className: "dshk-groupTitle", id: headingId, key: "title" }, group.name),
					...entry.models.map((model) => {
						const selected = state.current?.provider === group.id && state.current.model === model.id;
						return React.createElement("button", {
							ref: itemRef(),
							type: "button",
							role: "menuitemradio",
							"aria-checked": selected,
							className: "dshk-option",
							title: model.name,
							disabled: busy,
							key: model.id,
							onClick: () => {
								choose({ provider: group.id, model: model.id });
							},
						}, [
							React.createElement("span", { className: "dshk-optionCopy", key: "copy" }, [
								React.createElement("span", { className: "dshk-modelName", key: "name" }, model.name),
								String(model.id) === String(model.name) ? null : React.createElement("span", { className: "dshk-modelId", key: "mid" }, model.id),
							]),
							React.createElement("span", { className: "dshk-check", key: "check" }, selected ? React.createElement(CheckIcon, {}) : null),
						]);
					}),
				]);
			})));
			if (needle !== "" && flatFiltered.length === 0 && state.status !== "loading") modelPane.push(React.createElement("div", { className: "dshk-empty", key: "emptySearch" }, t("searchEmpty")));
			if (needle === "" && state.status === "ready" && choices.length === 0) modelPane.push(React.createElement("div", { className: "dshk-empty", key: "empty" }, t("empty.models")));

			const panes = [];
			if (pane === "root") {
				panes.push(React.createElement("button", {
					ref: itemRef(),
					type: "button",
					role: "menuitem",
					className: "dshk-cell",
					key: "model",
					onClick: () => setPane("model"),
				}, [
					React.createElement("span", { className: "dshk-cellLabel", key: "l" }, t("menu.model")),
					React.createElement("span", { className: "dshk-cellValue", key: "v" }, modelLabel),
					React.createElement(ChevronRight, { key: "c" }),
				]));
				if (reasoning !== void 0) panes.push(React.createElement("button", {
					ref: itemRef(),
					type: "button",
					role: "menuitem",
					className: "dshk-cell",
					key: "effort",
					onClick: () => setPane("effort"),
				}, [
					React.createElement("span", { className: "dshk-cellLabel", key: "l" }, t("menu.effort")),
					React.createElement("span", { className: "dshk-cellValue", key: "v" }, effortLabel),
					React.createElement(ChevronRight, { key: "c" }),
				]));
			} else if (pane === "model") {
				panes.push(...modelPane);
			} else {
				if (failure !== null) panes.push(React.createElement("div", { className: "dshk-error", key: "failure" }, failure));
				if (effortChoices.length === 0) {
					panes.push(React.createElement("div", { className: "dshk-empty", key: "empty" }, t("empty.efforts")));
				} else {
					for (const level of effortChoices) panes.push(React.createElement("button", {
						ref: itemRef(),
						type: "button",
						role: "menuitemradio",
						"aria-checked": effectiveEffort === level.effort,
						className: "dshk-option",
						disabled: busy,
						key: level.key,
						onClick: () => {
							chooseEffort(level.effort);
						},
					}, [
						React.createElement("span", { className: "dshk-optionCopy", key: "copy" }, React.createElement("span", { className: "dshk-modelName", key: "n" }, level.label)),
						React.createElement("span", { className: "dshk-check", key: "check" }, effectiveEffort === level.effort ? React.createElement(CheckIcon, {}) : null),
					]));
				}
			}

			return React.createElement("div", {
				ref: rootRef,
				className: "dshk-root",
				onKeyDown: onRootKeyDown,
				onBlur,
			}, [
				React.createElement("button", {
					ref: triggerRef,
					type: "button",
					className: "dshk-trigger",
					"aria-label": triggerAria,
					"aria-haspopup": "menu",
					"aria-expanded": open,
					"aria-controls": open ? id + "-menu" : void 0,
					title: triggerLabel,
					disabled: locked,
					key: "trigger",
					onClick: () => {
						if (open) close();
						else show();
					},
				}, [
					React.createElement(ModelIcon, { key: "icon" }),
					React.createElement("span", { className: "dshk-triggerLabel", key: "label" }, modelLabel),
					effortLabel === void 0 ? null : React.createElement("span", { className: "dshk-triggerEffort", key: "effort" }, effortLabel),
					React.createElement(ChevronDown, { className: open ? "dshk-chevron dshk-chevronOpen" : "dshk-chevron", key: "chev" }),
				]),
				open ? createPortal(React.createElement("div", {
					ref: menuRef,
					id: id + "-menu",
					className: "dshk-menu",
					style: menuPos ?? { visibility: "hidden", left: 0, top: 0, position: "fixed" },
					role: "menu",
					"aria-label": t("menu.aria"),
					"aria-busy": state.status === "loading" || busy,
				}, panes), document.body) : null,
			]);
		}

		/** The model seat's locale namespace, mirroring the official seat's key set. */
		const SEAT_NS = "hotkeyToolkit.seat";
		const seatZh = {
			"trigger.loading": "加载中…",
			"trigger.fallback": "选择模型",
			"trigger.selectAria": "选择模型",
			"trigger.aria": "当前模型 {model}",
			"trigger.ariaEffort": "当前模型 {model}，思考强度 {effort}",
			"menu.aria": "模型选择",
			"menu.model": "模型",
			"menu.effort": "思考强度",
			"effort.providerDefault": "供应商默认",
			"status.loading": "正在加载模型列表…",
			"empty.models": "没有可用的模型",
			"empty.efforts": "该模型没有可选的思考强度",
			"retry": "重试",
			"warning.groupLoad": "{name} 加载失败：{message}",
		};
		const seatEn = {
			"trigger.loading": "Loading…",
			"trigger.fallback": "Select model",
			"trigger.selectAria": "Select model",
			"trigger.aria": "Current model {model}",
			"trigger.ariaEffort": "Current model {model}, effort {effort}",
			"menu.aria": "Model selection",
			"menu.model": "Model",
			"menu.effort": "Effort",
			"effort.providerDefault": "Provider default",
			"status.loading": "Loading models…",
			"empty.models": "No model available",
			"empty.efforts": "This model exposes no effort levels",
			"retry": "Retry",
			"warning.groupLoad": "{name} failed to load: {message}",
		};

		/** Required services: the console registry, locale, and the seat's own faces. */
		const inject = ["slots", "locale"];

		/**
		 * Set while the settings page is capturing a new combination, so the global
		 * listener stands down instead of firing the old binding mid-recording.
		 */
		let recordingActive = false;

		/**
		 * Client plugin body: dictionary + stylesheet, the settings page, the global
		 * shortcut listener, and the searchable model seat.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "hotkey-toolkit: dictionaries");
			ctx.effect(() => installStyles(), "hotkey-toolkit: styles");
			ctx.effect(() => ctx.locale.register(SEAT_NS, { zh: seatZh, en: seatEn }), "hotkey-toolkit: seat dictionaries");
			translate = ctx.locale.bind(NS);

			/*
			 * The Desktop settings scope is bound ONCE here so its disposer belongs to this
			 * plugin's fiber; binding per keystroke would leak a scope on every shortcut.
			 */
			let modeScope;
			ctx.inject(["settingsScope"], (scope) => {
				modeScope = scope.settingsScope.bind({ namespace: DESKTOP_NS });
			});

			/*
			 * The sessions service (list snapshot store + session verbs), bound once so
			 * its lifetime belongs to this plugin's fiber. The permissions panel reads
			 * the list snapshot for every session's permission projection and issues
			 * /permission commands through each session's binding.
			 */
			ctx.inject(["sessions"], (scope) => {
				sessionsStore = scope.sessions.list;
				sessionsRef = scope.sessions;
			});

			ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "hotkey-toolkit",
				order: 60,
				label: () => translate("nav"),
				locale: NS,
			}, SettingsSection)), "hotkey-toolkit: settings page");

			/*
			 * Global shortcut listener.
			 *
			 * Capture phase so a focused composer, editor, or plugin field cannot swallow
			 * the combination first, and preventDefault so Chromium's own Ctrl+R never
			 * races the Desktop-owned reload. The settings page suspends this listener
			 * while it records a new combination.
			 */
			ctx.effect(() => {
				const onKeyDown = (event) => {
					if (recordingActive || event.repeat) return;
					const config = configStore.getSnapshot();
					if (!config.enabled) return;
					const combo = comboFromEvent(event);
					if (combo === null) return;
					if (combo === config.refresh) {
						event.preventDefault();
						event.stopPropagation();
						refreshInterface().catch((cause) => notify(text("actionFailed") + describe(cause)));
						return;
					}
					if (combo === config.restart) {
						event.preventDefault();
						event.stopPropagation();
						restartApplication().catch((cause) => notify(text("actionFailed") + describe(cause)));
						return;
					}
					for (const mode of MODE_IDS) {
						if (combo !== config.modes[mode]) continue;
						if (currentMode() === mode) return;
						event.preventDefault();
						event.stopPropagation();
						switchMode(modeScope, mode).catch((cause) => notify(text("modeFailed") + describe(cause)));
						return;
					}
				};
				window.addEventListener("keydown", onKeyDown, true);
				return () => {
					window.removeEventListener("keydown", onKeyDown, true);
				};
			}, "hotkey-toolkit: global shortcuts");

			/*
		 * Permissions panel state: the default-preset cell (settings mirror read +
		 * remote.settings.mutate write, mirroring the official permission row) and the
		 * confirmation gate standing between Full access and one click.
		 */
		const permissionPanel = {
			describeFace: null,
			settingsCtx: null,
			unfollow: null,
			current: null,
			options: [],
			revision: 0,
			writable: false,
			saving: false,
			status: "idle",
			error: null,
			version: 0,
			notify() {
				this.version += 1;
				for (const listener of permissionPanelListeners) listener();
			},
			async load() {
				const face = this.describeFace;
				if (face === null) return;
				if (this.unfollow === null) {
					this.unfollow = face.subscribe(() => this.derive());
				}
				this.status = "loading";
				this.error = null;
				this.notify();
				try {
					await face.ensure();
				} catch (cause) {
					this.fail(cause);
					return;
				}
				this.derive();
			},
			derive() {
				const face = this.describeFace;
				if (face === null) return;
				const mirrored = face.getSnapshot();
				const view = mirrored.view === void 0 ? null : mirrored.view.namespaces.find((entry) => entry.ns === PERMISSION_SETTINGS_NS) ?? null;
				if (view === null) {
					this.current = null;
					this.options = [];
					this.writable = false;
					this.status = mirrored.status === "unavailable" ? "unavailable" : "loading";
					this.notify();
					return;
				}
				const value = view.value !== null && typeof view.value === "object" ? view.value.defaultPreset : void 0;
				if (typeof value !== "string") {
					this.fail(new Error("permission settings has no defaultPreset value"));
					return;
				}
				this.current = value;
				this.options = defaultPresetOptions(value);
				this.writable = mirrored.view.writable === true;
				this.revision = view.revision;
				this.status = "ready";
				this.error = null;
				this.notify();
			},
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
					this.describeFace.acceptView(response.value);
					notify(text("wpDefaultSaved"));
				} catch (cause) {
					this.fail(cause);
				} finally {
					this.saving = false;
				}
			},
			fail(cause) {
				this.status = "error";
				this.error = describe(cause);
				this.notify();
			},
			dispose() {
				if (this.unfollow !== null) {
					this.unfollow();
					this.unfollow = null;
				}
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
		ctx.effect(() => () => {
			permissionPanel.dispose();
		}, "hotkey-toolkit: permissions panel mirror dispose");
		ctx.inject(["settingsScope", "remote", "settingsSchema"], (scope) => {
			permissionPanel.describeFace = scope.settingsScope.describe();
			permissionPanel.settingsCtx = scope;
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

		/** One permission row: session title, optional tags, and the preset selector. */
		function PermissionRow(props) {
			const { t, title, subtitle, tags, value, options, disabled, onSwitch } = props;
			return React.createElement("div", { className: "dshk-wpRow", key: title }, [
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
				const { value, options, disabled, onSwitch, t } = props;
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
				React.createElement("span", { className: "dshk-wpValue", key: "v" }, current !== void 0 ? current.label : t("wpUnavailable")),
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
			usePermissionPanel();
			const panel = permissionPanel;
			const [gate, setGate] = React.useState(null);
			const [acknowledged, setAcknowledged] = React.useState(false);
			const [problem, setProblem] = React.useState(null);

			React.useEffect(() => {
				panel.load();
			}, [panel]);

			React.useEffect(() => {
				if (gate === null) return;
				setAcknowledged(false);
			}, [gate]);

			const rows = React.useMemo(() => {
				const out = [];
				for (const id of sessions.ids) {
					const summary = sessions.byId[id];
					if (summary === void 0 || summary.parentId !== void 0) continue;
					const values = summary.projectionValues;
					const permission = values !== void 0 ? values.permissions : void 0;
					const options = permission !== void 0 && permission !== null && Array.isArray(permission.options)
						? permission.options.filter((option) => option && option.value !== "custom").map((option) => ({ value: option.value, label: presetLabel(option.value, t) }))
						: [];
					const current = permission !== void 0 && permission !== null && typeof permission.currentValue === "string" ? permission.currentValue : null;
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
						capable: options.length > 0,
					});
				}
				out.sort((a, b) => a.title.localeCompare(b.title));
				return out;
			}, [sessions, t]);

			const switchSession = async (row, preset) => {
				setProblem(null);
				if (row.capable !== true) return;
				if (preset === FULL_ACCESS_PRESET && row.current !== FULL_ACCESS_PRESET) {
					setGate({ kind: "session", id: row.id });
					return;
				}
				if (preset === row.current) return;
				try {
					const binding = sessionsRef !== null ? sessionsRef.binding(row.id) : void 0;
					const session = binding !== void 0 && binding !== null ? binding.session : void 0;
					if (session === void 0 || typeof session.command !== "function") throw new Error(text("wpSessionUnreachable"));
					const result = await session.command("/permission " + preset);
					if (!result.ok) throw new Error(result.error && result.error.message ? result.error.message : String(result.error));
					if (!result.value.matched) throw new Error("the host offers no /permission command");
					notify(text("wpApplied") + presetLabel(preset, t));
				} catch (cause) {
					setProblem(text("wpSwitchFailed") + describe(cause));
				}
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
					if (row !== void 0) switchSession(row, FULL_ACCESS_PRESET);
				} else {
					panel.select(FULL_ACCESS_PRESET).catch((cause) => setProblem(text("wpDefaultFailed") + describe(cause)));
				}
			};

			const defaultOptions = panel.options.map((option) => ({ value: option.id, label: presetLabel(option.id, t) }));
			const defaultBusy = panel.status === "loading" || panel.status === "saving";
			const defaultState = panel.status === "error"
				? text("wpLoadFailed") + (panel.error ?? "")
				: panel.status === "unavailable" ? t("wpUnavailable") : null;
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
							t,
						}),
					]),
					React.createElement("div", { className: "dshk-hint", key: "hint" }, panel.status === "error" ? defaultState : t("wpDefaultHint")),
				]),
				React.createElement("div", { className: "dshk-card", key: "sessions" }, [
					React.createElement("div", { className: "dshk-wpHead", key: "head" }, [
						React.createElement("h4", { key: "h" }, t("wpSessionSection") + " · " + t("wpCount") + rows.length),
						React.createElement("button", {
							type: "button",
							className: "dshk-btn",
							key: "btn",
							onClick: () => {
								if (sessionsRef !== null) sessionsRef.refresh().catch(() => {});
							},
						}, t("wpRefresh")),
					]),
					rows.length === 0 ? React.createElement("div", { className: "dshk-wpState", key: "empty" }, t("wpEmpty")) : rows.map((row) => React.createElement(PermissionRow, {
						key: row.id,
						t,
						title: row.title,
						subtitle: row.subtitle,
						tags: row.tags,
						value: row.current,
						options: row.options,
						disabled: row.capable !== true,
						onSwitch: (preset) => switchSession(row, preset),
					})),
				]),
				problem !== null ? React.createElement("div", { className: "dshk-note", key: "problem" }, problem) : null,
				gate !== null ? React.createElement("div", {
					className: "dshk-card",
					key: "gate",
					style: { borderColor: "var(--dsw-alias-state-warn-label,#e0a03b)" },
				}, [
					React.createElement("h4", { key: "h" }, t("wpConfirmTitle")),
					React.createElement("div", { className: "dshk-hint", key: "d" }, t("wpConfirmDesc")),
					React.createElement("label", { className: "dshk-switch", key: "ack", style: { marginBottom: 8 } }, React.createElement("input", {
						type: "checkbox",
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
				]) : null,
			]);
		}

		ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({
			name: "settings.section",
			id: "workspace-permissions",
			order: 61,
			label: () => translate("wpNav"),
			locale: NS,
		}, PermissionsSection)), "hotkey-toolkit: permissions panel");
		ctx.inject(["slots", "modelDirectories", "sessions"], (scope) => {
				const models = scope.modelDirectories;
				const sessions = scope.sessions;
				scope.slots.inject("conversation.input.model", () => scope.slots.register({
					name: "conversation.input.model",
					priority: -1,
					locale: SEAT_NS,
					inject: (sessionId) => {
						const directory = models.directoryFor(sessionId);
						const available = sessions.subagentAddress(sessionId) === void 0;
						return {
							available,
							directory: directory.store,
							load: () => {
								if (available) directory.load().catch(() => {});
							},
							select: (selection) => available ? directory.select(selection).then(() => true, () => false) : Promise.resolve(false),
						};
					},
				}, ModelSelect));
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
