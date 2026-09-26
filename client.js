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
		/** Live Workspace registry, for the archive set (late-bound in apply). */
		let workspacesRef = null;
		/** localStorage key holding the user's shortcut preferences. */
		const STORAGE_KEY = "dsh.hotkeyToolkit.v1";
		/** Electron preload bridge exposing argument-free Desktop actions. */
		const ACTIONS_BRIDGE = "dshDesktopActions";
		/** Loopback fallbacks, used when the renderer runs without the preload bridge. */
		const RELOAD_PATH = "/api/desktop/developer/reload";
		const RESTART_PATH = "/api/desktop/restart";
		/** URL marker the Electron main process appends when it owns the window. */
		const MODE_MARKER = "dsh-desktop-mode";

		const zh = {
			nav: "快捷键工具包",
			title: "快捷键工具包",
			intro: "快捷键已并入官方「设置 → 快捷键」界面，可录制、可恢复默认。本页只保留插件自身的开关。",
			introWeb: "快捷键已并入官方「设置 → 快捷键」界面。本页只保留插件自身的开关；重启与模式切换仅在 DSH Desktop 中可用。",
			shortcutSection: "快捷键",
			shortcutHint: "刷新界面、重启 DSH 与三个模式切换都已在官方快捷键列表中，可在「设置 → 快捷键」里查看与修改。",
			shortcutRefreshNote: "「刷新界面」默认不绑定：Ctrl+R 已被官方「刷新页面」占用，请在上方界面自行指定组合键。",
			openShortcuts: "打开快捷键设置",
			switchSection: "快捷键开关",
			switchSectionHint: "逐个启用或停用本插件提供的快捷键。停用后命令仍保留在官方快捷键列表中，键位与冲突检测都不变，只是按下时不执行（也不会拦截该按键）。",
			switch_refresh: "刷新界面",
			switch_restart: "重启 DSH",
			switch_compatibility: "切换到兼容模式",
			switch_extended: "切换到扩展模式",
			switch_advanced: "切换到增强模式",
			switchHint_refresh: "重新加载渲染进程；插件与设置都会重新读取。",
			switchHint_restart: "重新启动 DSH Desktop 应用。",
			switchHint_compatibility: "切到兼容模式并重启 DSH Desktop 生效。",
			switchHint_extended: "切到扩展模式并重启 DSH Desktop 生效。",
			switchHint_advanced: "切到增强模式并重启 DSH Desktop 生效。",
			/* Labels shown as rows in the official shortcut list (Settings → Keyboard shortcuts). */
			cmdRefresh: "刷新界面（快捷键工具包）",
			cmdRestart: "重启 DSH（快捷键工具包）",
			cmdModeCompatibility: "切换到兼容模式（快捷键工具包）",
			cmdModeExtended: "切换到扩展模式（快捷键工具包）",
			cmdModeAdvanced: "切换到增强模式（快捷键工具包）",
			cmdAliasRefresh: "刷新界面 重载 重新加载",
			cmdAliasRestart: "重启 DSH 重新启动",
			cmdAliasMode: "切换窗口模式 兼容 扩展 增强",
			reloading: "正在刷新界面…",
			restarting: "DSH 正在重启…",
			savedRestarting: "模式已保存，DSH 正在重启…",
			modeFailed: "模式切换失败：",
			actionFailed: "操作失败：",
			noShortcut: "快捷键未绑定或不可用。",
			subpluginSection: "子插件",
			modelSearch: "模型搜索",
			modelSearchHint: "在模型列表里提供搜索框（保留原版两级菜单）。关闭后恢复官方原生模型菜单。",
			modelSearchOff: "已关闭：正在使用官方原生模型菜单。",
			desktopOnly: "该操作仅在 DSH Desktop 中可用。",
			scopeUnavailable: "设置作用域不可用。",
			webCarrierNote: "当前运行在浏览器（Web）载体中：重启 DSH 与窗口模式切换仅在 DSH Desktop 中可用，因此在官方快捷键列表里默认不绑定。",
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
			intro: "Shortcuts now live in the official Settings → Keyboard shortcuts dialog, where they can be recorded and restored to defaults. This page keeps only the plugin's own switches.",
			introWeb: "Shortcuts now live in the official Settings → Keyboard shortcuts dialog. This page keeps only the plugin's own switches; Restart and the mode switches are available in DSH Desktop only.",
			shortcutSection: "Shortcuts",
			shortcutHint: "Refresh, Restart DSH, and the three mode switches are all in the official shortcut list, editable from Settings → Keyboard shortcuts.",
			shortcutRefreshNote: "\"Refresh interface\" ships unbound: Ctrl+R already belongs to the official \"Refresh page\", so pick a combination for it in that dialog.",
			openShortcuts: "Open keyboard shortcuts",
			switchSection: "Shortcut switches",
			switchSectionHint: "Enable or disable each shortcut this plugin contributes. A disabled command stays in the official shortcut list with its keys and conflict checks intact — it simply does not run when pressed (and does not swallow the key).",
			switch_refresh: "Refresh interface",
			switch_restart: "Restart DSH",
			switch_compatibility: "Switch to Compatibility mode",
			switch_extended: "Switch to Extended mode",
			switch_advanced: "Switch to Advanced mode",
			switchHint_refresh: "Reloads the renderer; plugins and settings are read again.",
			switchHint_restart: "Relaunches the DSH Desktop application.",
			switchHint_compatibility: "Switches to Compatibility mode and restarts DSH Desktop to apply it.",
			switchHint_extended: "Switches to Extended mode and restarts DSH Desktop to apply it.",
			switchHint_advanced: "Switches to Advanced mode and restarts DSH Desktop to apply it.",
			/* Labels shown as rows in the official shortcut list (Settings → Keyboard shortcuts). */
			cmdRefresh: "Refresh interface (Hotkey Toolkit)",
			cmdRestart: "Restart DSH (Hotkey Toolkit)",
			cmdModeCompatibility: "Switch to Compatibility mode (Hotkey Toolkit)",
			cmdModeExtended: "Switch to Extended mode (Hotkey Toolkit)",
			cmdModeAdvanced: "Switch to Advanced mode (Hotkey Toolkit)",
			cmdAliasRefresh: "refresh interface reload",
			cmdAliasRestart: "restart DSH relaunch",
			cmdAliasMode: "switch window mode compatibility extended advanced",
			reloading: "Refreshing the interface…",
			restarting: "DSH is restarting…",
			savedRestarting: "Mode saved — DSH is restarting…",
			modeFailed: "Mode switch failed: ",
			actionFailed: "Operation failed: ",
			noShortcut: "The shortcut is unbound or unavailable.",
			subpluginSection: "Sub-plugins",
			modelSearch: "Model search",
			modelSearchHint: "Adds a search box to the model list (keeping the shipped two-level menu). Turn it off to restore the official model menu.",
			modelSearchOff: "Off — the official model menu is in use.",
			desktopOnly: "This action is only available in DSH Desktop.",
			scopeUnavailable: "Settings scope unavailable.",
			webCarrierNote: "Running on the browser (Web) carrier: Restart DSH and the window-mode switches exist only in DSH Desktop, so they ship unbound in the official shortcut list.",
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
			".dshk-statusWhy{margin-top:4px;color:var(--dsw-alias-state-error-primary,#e05a5a);font-size:11px;line-height:16px;word-break:break-all}",
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
		 *  - `modelSearch`: the model-selector sub-plugin switch. ON, this plugin
		 *    shadows the official `conversation.input.model` seat with its searchable
		 *    menu; OFF, the seat is retired and the official two-level menu returns.
		 *  - `shortcuts`: one arm/disarm switch PER command this plugin contributes.
		 *    These are gates on the action, not on the binding: the command stays
		 *    registered, keeps its keys, and keeps its row in the official dialog —
		 *    its `resolve` simply refuses while disarmed. That is what makes the
		 *    switch reversible without churning the shortcut registry (every
		 *    register/unregister invalidates open edit drafts and briefly disables
		 *    editing) and without ever losing a recorded combination.
		 */
		const DEFAULT_CONFIG = {
			modelSearch: true,
			shortcuts: {
				refresh: true,
				restart: true,
				compatibility: true,
				extended: true,
				advanced: true,
			},
		};

		/** Every per-command switch this plugin exposes, in display order. */
		const SHORTCUT_SWITCHES = ["refresh", "restart", "compatibility", "extended", "advanced"];

		/**
		 * Merge a stored payload over the defaults.
		 *
		 * Tolerant by design, for two separate reasons:
		 *  - the pre-1.5 payload carried `enabled`, `refresh`, `restart`, and `modes`;
		 *    those fields are simply ignored now, so an existing profile upgrades
		 *    without losing its model-search choice;
		 *  - `shortcuts` is merged key-by-key, so a payload written before a new
		 *    switch existed still gets the shipped default for the missing keys
		 *    rather than inheriting `undefined` (which would read as "off").
		 */
		function normalizeConfig(raw) {
			const next = { modelSearch: DEFAULT_CONFIG.modelSearch, shortcuts: { ...DEFAULT_CONFIG.shortcuts } };
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
		 * @param action - switch key (`refresh`, `restart`, or a mode id).
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
		const COMMAND_REFRESH = "hotkeyToolkit.refresh";
		const COMMAND_RESTART = "hotkeyToolkit.restart";
		const COMMAND_MODE = {
			compatibility: "hotkeyToolkit.modeCompatibility",
			extended: "hotkeyToolkit.modeExtended",
			advanced: "hotkeyToolkit.modeAdvanced",
		};
		/** The official command-id grammar, mirrored so we can self-validate. */
		const COMMAND_ID_PATTERN = /^[a-z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)+$/u;

		/**
		 * Every command id this plugin contributes, as one list.
		 *
		 * Checked against `COMMAND_ID_PATTERN` at load time. This is not defensive
		 * padding: the renderer's registry accepts a malformed id silently, and the
		 * damage only appears later, when the user's first edit makes the persistence
		 * layer classify the whole shortcut document `invalid` — which turns the
		 * entire 设置 → 快捷键 page read-only and leaves the user's own file
		 * unreadable. Failing loudly here costs one console error; failing there costs
		 * the user every shortcut they ever customized.
		 */
		const COMMAND_IDS = [COMMAND_REFRESH, COMMAND_RESTART].concat(MODE_IDS.map((id) => COMMAND_MODE[id]));
		for (const id of COMMAND_IDS) {
			if (!COMMAND_ID_PATTERN.test(id)) {
				throw new Error("hotkey-toolkit: command id " + JSON.stringify(id) + " violates the official shortcut grammar");
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
		 * Three constraints drive the shape below, each verified against the official
		 * validators by `test/binding-audit.cjs`:
		 *
		 *  1. **Refresh ships NO default.** The official `page.refresh`
		 *     (`ui-sidebar-right`) already owns `Ctrl+R`, and its Web twin owns
		 *     `Ctrl+Alt+R`. Declaring either here would throw
		 *     `Conflicting shortcut defaults`. The row still appears in
		 *     设置 → 快捷键 and the user can bind it; that is strictly better than
		 *     fighting the official command for a key it already owns.
		 *  2. **Restart and the mode switches declare Desktop profiles only.** They
		 *     are Desktop-only by nature — a browser carrier has no application to
		 *     relaunch and no window mode to switch — so a Web default would advertise
		 *     a binding that can never fire. It also sidesteps a genuine minefield:
		 *     on Web, `Ctrl+Shift+R` is `session.rename`, `Ctrl+Alt+R` is
		 *     `page.refresh`, and `web:linux` admits ONLY `Mod+/`,
		 *     `Mod+Shift+,`, `Mod+Shift+.` — every other combination is rejected by
		 *     `isWebBindingAllowed`. Omitting a profile is legal and means "unbound".
		 *  3. The Desktop defaults stay on the combinations this plugin already
		 *     shipped (`Ctrl+Shift+R`, `Ctrl+Alt+1/2/3`), which are free on all three
		 *     Desktop platforms.
		 */
		const DESKTOP_BINDINGS = {
			restart: { code: "KeyR", modifiers: ["primary", "shift"] },
			compatibility: { code: "Digit1", modifiers: ["primary", "alt"] },
			extended: { code: "Digit2", modifiers: ["primary", "alt"] },
			advanced: { code: "Digit3", modifiers: ["primary", "alt"] },
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
				const value = new URLSearchParams(window.location.search).get(MODE_MARKER);
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
			console.error("hotkey-toolkit: " + where + " failed:", cause);
			if (typeof window !== "undefined") {
				window.__dshHotkeyPanel = { where, message, at: Date.now() };
			}
		}

		/**
		 * Refresh the interface.
		 *
		 * Under the Desktop shell this is the Desktop-owned reload action, which
		 * re-reads plugins and settings. On a plain browser carrier there is no such
		 * endpoint, so fall back to reloading the page itself: same observable
		 * effect (a fresh renderer boot) through the only mechanism the carrier has.
		 * `location.reload()` never returns, so nothing after it is reachable.
		 */
		async function refreshInterface() {
			notify(text("reloading"));
			if (!hasDesktopHost()) {
				if (typeof window !== "undefined") window.location.reload();
				return;
			}
			await desktopAction("reload");
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

		/**
		 * Switch the window mode.
		 *
		 * Writes ride the same Host settings the Desktop settings page uses, in the
		 * order that page established: a non-compatibility mode withdraws browser and
		 * LAN access BEFORE the mode lands, so the app never boots a mode the
		 * marker-free carrier cannot render. The Desktop Host watches this namespace
		 * and relaunches itself when mode/port/material move, so no explicit restart
		 * call is needed here: writing the mode IS the restart trigger.
		 *
		 * `ConfigForm.set` resolves `true` only on Host acceptance; a refusal is not a
		 * throw, so the result is checked rather than assumed. A silently-refused
		 * write would otherwise report "mode saved" while nothing changed.
		 * @param form - the `dsh-desktop` config form, or null when unavailable.
		 * @param mode - target mode.
		 */
		async function switchMode(form, mode) {
			if (!hasDesktopHost()) throw new Error(text("desktopOnly"));
			if (form === null || form === void 0) throw new Error(text("scopeUnavailable"));
			if (mode !== "compatibility") {
				if (!await form.set("networkExposure", "loopback")) throw new Error(text("scopeUnavailable"));
				if (!await form.set("openBrowser", false)) throw new Error(text("scopeUnavailable"));
			}
			if (!await form.set("mode", mode)) throw new Error(text("scopeUnavailable"));
			notify(text("savedRestarting"));
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

		/**
		 * Ask the Host for one session's projections, without opening it.
		 *
		 * WHY THIS EXISTS. The panel lists EVERY session, but a session the user has
		 * never opened carries no `permissions` projection: `sessions.list` fills
		 * `projectionValues` only from what the Host has already pushed (the live
		 * control baseline, or list hints from the persisted checkpoint). A row whose
		 * projection is absent cannot know its current preset, so `current` is null
		 * and the row renders as "unavailable" — which is exactly the "some sessions
		 * still show unavailable" half of the report.
		 *
		 * `refreshProjections(id)` is the supported cold read: it goes through
		 * `remote.session.projections`, which is answered by a Host-side
		 * `observeSession` that never activates an Agent. That is the whole point —
		 * reading a preset must not be as expensive as opening the conversation, and
		 * must not depend on the user having visited the session.
		 *
		 * Deliberately NOT `retain()`: retaining materializes a client scope and
		 * starts the session's history `open()`, so doing it for every row would open
		 * every conversation in the sidebar. Projections are the cheap, purpose-built
		 * read for exactly this "show me metadata about sessions I have not opened"
		 * case.
		 *
		 * Failures are swallowed on purpose: a session whose projection cannot be read
		 * keeps its row, disabled, and the panel's own refresh can retry. Throwing here
		 * would take out the whole list because one session misbehaved.
		 * @param id - session to read projections for.
		 */
		function ensureProjections(id) {
			if (sessionsRef === null || typeof sessionsRef.refreshProjections !== "function") return;
			Promise.resolve(sessionsRef.refreshProjections(id)).catch(() => {});
		}

		/**
		 * Dispatch one slash command to a session BY ID, without materializing it.
		 *
		 * WHY NOT `binding()`. This used to be
		 * `sessionsRef.binding(id)?.session` then `session.command(line)`, which threw
		 * the reported "该会话暂时无法下发指令（尚未装载）" for every session the user had
		 * not opened. `binding(id)` only returns a binding for a scope that already
		 * exists — it never creates one; `retain()` is what materializes. So the panel
		 * could only ever drive the handful of sessions that happened to be open.
		 *
		 * `remote.commands.execute(sessionId, line, [])` is the same surface the
		 * official ui-plan chip uses, and it takes the id directly. The Host resolves
		 * it through `resolveAgent(sessionId)`, which RESUMES a cold session on demand
		 * — so an unopened session is a perfectly valid target, and no client-side
		 * scope, history open, or retention is involved.
		 *
		 * Falls back to the binding when the remote namespace is unavailable, so a
		 * carrier that composes sessions without `remote.commands` keeps whatever
		 * range it had rather than losing the feature entirely.
		 * @param remoteCommands - the `remote.commands` namespace, or undefined.
		 * @param id - target session.
		 * @param line - full command line, leading slash included.
		 * @returns `{ ok: true }`, or `{ ok: false, message }` describing the refusal.
		 */
		async function dispatchCommand(remoteCommands, id, line) {
			if (remoteCommands !== void 0 && remoteCommands !== null && typeof remoteCommands.execute === "function") {
				try {
					const result = await remoteCommands.execute(id, line, []);
					if (!result.ok) {
						return { ok: false, message: result.error && result.error.message ? result.error.message : String(result.error) };
					}
					if (result.value === void 0) return { ok: false, message: "the host offers no " + line.split(" ")[0] + " command" };
					return { ok: true };
				} catch (cause) {
					return { ok: false, message: describe(cause) };
				}
			}
			try {
				const binding = sessionsRef !== null ? sessionsRef.binding(id) : void 0;
				const session = binding !== void 0 && binding !== null ? binding.session : void 0;
				if (session === void 0 || typeof session.command !== "function") return { ok: false, message: text("wpSessionUnreachable") };
				const result = await session.command(line);
				if (!result.ok) {
					return { ok: false, message: result.error && result.error.message ? result.error.message : String(result.error) };
				}
				if (!result.value.matched) return { ok: false, message: "the host offers no " + line.split(" ")[0] + " command" };
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
			const snapshot = React.useSyncExternalStore(
				(listener) => (workspacesRef === null ? () => {} : workspacesRef.list.subscribe(listener)),
				() => (workspacesRef === null ? null : workspacesRef.list.getSnapshot()),
			);
			const ids = snapshot !== null && snapshot !== void 0 && Array.isArray(snapshot.archivedSessionIds)
				? snapshot.archivedSessionIds
				: [];
			return React.useMemo(() => new Set(ids), [snapshot]);
		}

		/**
		 * Settings page.
		 *
		 * Deliberately small: keyboard recording is gone. It used to be a bespoke
		 * recorder writing this plugin's own localStorage, which meant two recorders,
		 * two stores, and two disagreeing answers to "what is Ctrl+R bound to". The
		 * bindings now live in the official shortcut service and are edited in
		 * 设置 → 快捷键, so this page only owns what is genuinely the plugin's:
		 * the model-search sub-plugin switch, plus a pointer to the official dialog.
		 *
		 * The sub-plugin switch is read per render, not cached at activation: the same
		 * bundle serves both carriers and the page can outlive an activation.
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
				const desktopOnly = action !== "refresh";
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
					React.createElement("div", { className: "dshk-hint", key: "rn" }, t("shortcutRefreshNote")),
					desktop ? null : React.createElement("div", { className: "dshk-hint dshk-platformNote", key: "pn" }, t("webCarrierNote")),
				]),
				React.createElement("div", { className: "dshk-card", key: "switches" }, [
					React.createElement("h4", { key: "h" }, t("switchSection")),
					React.createElement("div", { className: "dshk-hint", key: "hh" }, t("switchSectionHint")),
					...switchRows,
				]),
				React.createElement("div", { className: "dshk-card", key: "subplugins" }, [
					React.createElement("h4", { key: "h" }, t("subpluginSection")),
					React.createElement("div", { className: "dshk-row", key: "modelSearch" }, [
						React.createElement("div", { className: "dshk-rowCopy", key: "c" }, [
							React.createElement("div", { className: "dshk-rowLabel", key: "l" }, t("modelSearch")),
							React.createElement("div", { className: "dshk-rowHint", key: "h" }, t("modelSearchHint")),
						]),
						React.createElement("label", { className: "dshk-switch", key: "s" }, React.createElement("input", {
							type: "checkbox",
							checked: config.modelSearch,
							onChange: (event) => configStore.update({ modelSearch: event.target.checked }),
						})),
					]),
					config.modelSearch ? null : React.createElement("div", { className: "dshk-hint", key: "off" }, t("modelSearchOff")),
				]),
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

		/*
		 * What the seat reads before its per-session directory is resolvable. The status
		 * is "loading" on purpose: the model pane only paints a row for "loading"/"ready"
		 * and an "idle" status would render the search box above an empty list.
		 *
		 * Frozen and shared: React re-reads getSnapshot every render and only bails out
		 * when the value is cached, so a fresh object literal would crash the seat.
		 */
		const LOADING_SEAT_SNAPSHOT = Object.freeze({ current: null, status: "loading", error: null, groups: [], failures: [] });
		/*
		 * Last failures seen while building the seat face, parked on a global so a
		 * user can read them back with `window.__dshHotkeySeat`. Degrading quietly is
		 * right for the UI, but it must not hide the cause from a bug report.
		 */
		const SEAT_DIAGNOSTICS = [];
		const SEAT_DIAG_KEY = "dsh.hotkeyToolkit.seatDiag";
		const recordSeatStep = (where, message) => {
			try {
				SEAT_DIAGNOSTICS.push({ at: Date.now(), where, message });
				if (SEAT_DIAGNOSTICS.length > 30) SEAT_DIAGNOSTICS.shift();
				if (typeof window !== "undefined") window.__dshHotkeySeat = { failures: SEAT_DIAGNOSTICS };
				window.localStorage.setItem(SEAT_DIAG_KEY, JSON.stringify(SEAT_DIAGNOSTICS));
			} catch {
				/* diagnostics must never break the seat */
			}
		};
		const reportSeatFailure = (where, error) => recordSeatStep(where, String(error && error.message ? error.message : error));
		/** Compact description of a directory snapshot, for diagnostics. */
		const summarizeSeatSnapshot = (snap) => {
			if (snap === null || snap === void 0) return "no-snapshot";
			return [
				"status=" + String(snap.status),
				"groups=" + (Array.isArray(snap.groups) ? snap.groups.length : "non-array"),
				"failures=" + (Array.isArray(snap.failures) ? snap.failures.length : "non-array"),
				"current=" + (snap.current === null || snap.current === void 0 ? "null" : "set"),
				"error=" + (snap.error === null || snap.error === void 0 ? "null" : String(snap.error)),
			].join(" ");
		};
		/** One-line summary of the most recent failure, for the loading row. */
		const lastSeatFailure = () => {
			const last = SEAT_DIAGNOSTICS[SEAT_DIAGNOSTICS.length - 1];
			return last === void 0 ? "" : last.where + ": " + last.message;
		};
		/*
		 * Resolve the per-session directory on demand instead of up front.
		 *
		 * `modelDirectories.directoryFor()` throws while a session's scope/binding is
		 * still unresolved (cold boot, session restore), and an injected face is computed
		 * ONCE per binding — so resolving eagerly pins an empty directory for the rest of
		 * the session and the menu opens with no rows. This proxy resolves on first
		 * subscription (and again on every open, via load()), reports a loading snapshot
		 * until it can, then notifies React so the real store takes over.
		 */
		function createLazyDirectory(resolveDirectory) {
			let directory = null;
			let innerUnsubscribe = null;
			let preloaded = false;
			let warmPending = false;
			let retryTimer = null;
			let retryAttempts = 0;
			let exhaustedSnapshot = null;
			const listeners = new Set();
			const notify = () => {
				for (const listener of [...listeners]) {
					try {
						listener();
					} catch {
						/* a broken listener is not the seat's problem */
					}
				}
			};
			/*
			 * Fetch the catalog once a directory exists. Safe to call repeatedly:
			 * `preloaded` makes it a one-shot per directory.
			 */
			const warm = () => {
				const current = directory;
				if (current === null || preloaded) return;
				preloaded = true;
				recordSeatStep("warm", "start");
				/*
				 * A failed warm-up must not latch: leaving `preloaded` set would make this a
				 * permanent one-shot, so a later open would never retry and the menu would sit
				 * on its loading row forever.
				 */
				const giveUp = (error) => {
					preloaded = false;
					reportSeatFailure("directory.load", error);
					/*
					 * Retry on our own rather than waiting for React to resubscribe: a
					 * transient failure would otherwise leave the trigger on its loading label
					 * until the user opened the menu and paid the round-trip.
					 */
					scheduleRetry();
				};
				try {
					const started = current.load();
					if (started !== void 0 && started !== null && typeof started.then === "function") {
						started.then(() => {
							recordSeatStep("warm", "ok");
							const snap = directory === null || directory.store === void 0 ? null : directory.store.getSnapshot();
							recordSeatStep("store@load", summarizeSeatSnapshot(snap));
							/*
							 * The catalog may still be in flight when load() resolves, so look again
							 * once more: a store that never leaves "loading" is the endless spinner,
							 * and this is the line that says whether the request or the projection
							 * behind it is what stalled.
							 */
							if (typeof setTimeout === "function") {
								setTimeout(() => {
									const later = directory === null || directory.store === void 0 ? null : directory.store.getSnapshot();
									recordSeatStep("store@3s", summarizeSeatSnapshot(later));
								}, 3000);
							}
						}, giveUp);
					}
				} catch (error) {
					giveUp(error);
				}
			};
			/*
			 * A session binds some time AFTER the composer mounts and nothing notifies the
			 * seat, so poll briefly until the directory resolves. Without this the catalog
			 * is only fetched when the user opens the menu - the round-trip they would
			 * otherwise wait through. Bounded: gives up after ~10s and is cleared on success.
			 */
			const scheduleRetry = () => {
				if (retryTimer !== null) return;
				if (typeof setInterval !== "function") return;
				retryTimer = setInterval(() => {
					retryAttempts += 1;
					resolve();
					warm();
					/*
					 * Stop once the catalog is actually in flight/settled. `preloaded` is true
					 * exactly while a load is outstanding or succeeded.
					 */
					if (preloaded || retryAttempts >= 40) {
						clearInterval(retryTimer);
						retryTimer = null;
						/*
						 * Budget spent and the session never resolved: say so instead of leaving the
						 * menu on a loading row that never ends.
						 */
						if (!preloaded && directory === null) {
							/*
							 * Freeze the reason once: getSnapshot must return a cached value or React
							 * treats every render as a change and loops until it crashes the seat.
							 */
							const why = lastSeatFailure() || "session never resolved";
							recordSeatStep("give-up", why);
							exhaustedSnapshot = Object.freeze({ current: null, status: "error", error: why, groups: [], failures: [] });
							notify();
						}
					}
				}, 250);
			};
			const resolve = () => {
				if (directory !== null) return directory;
				let next;
				try {
					next = resolveDirectory();
				} catch (error) {
					reportSeatFailure("modelDirectories.directoryFor", error);
					/*
					 * The session is not bound yet. Remember that a warm-up is still owed so
					 * a later nudge (retryWarmUp) can perform it - otherwise the very first
					 * open pays the full Host round-trip.
					 */
					warmPending = !preloaded;
					scheduleRetry();
					return null;
				}
				if (next === null || next === void 0) return null;
				directory = next;
				recordSeatStep("resolved", "ok");
				if (next.store !== void 0 && next.store !== null && typeof next.store.subscribe === "function") {
					innerUnsubscribe = next.store.subscribe(notify);
				}
				notify();
				if (warmPending) {
					warmPending = false;
					warm();
				}
				return directory;
			};
			return {
				store: {
					subscribe: (listener) => {
						listeners.add(listener);
						/*
						 * Warm the catalog as soon as the seat mounts. The composer mounts long before
						 * anyone opens the menu, so preloading here is what lets the list appear at
						 * once instead of after a Host round-trip on the first open.
						 */
						resolve();
						warm();
						return () => {
							listeners.delete(listener);
							if (listeners.size === 0 && innerUnsubscribe !== null) {
								try {
									innerUnsubscribe();
								} catch {
									/* the inner store may already be gone */
								}
								innerUnsubscribe = null;
							}
						};
					},
					getSnapshot: () => {
						const current = directory;
						if (current !== null && current.store !== void 0 && current.store !== null && typeof current.store.getSnapshot === "function") {
							return current.store.getSnapshot();
						}
						return exhaustedSnapshot === null ? LOADING_SEAT_SNAPSHOT : exhaustedSnapshot;
					},
				},
				load: () => {
					const current = resolve();
					if (current !== null && typeof current.load === "function") {
						try {
							current.load();
						} catch (error) {
							reportSeatFailure("directory.load", error);
						}
					}
				},
				select: (selection) => {
					const current = resolve();
					if (current === null || typeof current.select !== "function") return Promise.resolve(false);
					return current.select(selection).then(() => true, () => false);
				},
				/*
				 * Called when the session may have become resolvable (the sessions list
				 * changed). Retries a warm-up that the cold start had to skip.
				 */
				retryWarmUp: () => {
					resolve();
					warm();
				},
			};
		}
		/**
		 * The composer's model seat: the official two-level menu, kept exactly as
		 * shipped - the root level holds the Model / Effort rows and each drills into
		 * its own list - with the model list additionally carrying a search field.
		 *
		 * The field lives in the MODEL pane, directly above the provider-grouped
		 * options it filters, so the level the user searches on is the level that
		 * shows the results. Opening the menu therefore lands on the root rows, and
		 * "Model" drills into the searchable list.
		 *
		 * Registered at a LOWER priority than the shipped seat, so this renders while
		 * the plugin is live and the official seat returns untouched on unload or on any
		 * crash that abdicates this entry. The injected face is the official one (the
		 * shared per-session ModelDirectory store and verbs), which is what keeps this
		 * seat and the /model popup reading one state.
		 */
		function ModelSelect(props) {
			const { locked, available, directory, load, select, t } = props;
			const rawState = React.useSyncExternalStore((fn) => directory.subscribe(fn), () => directory.getSnapshot());
			/*
			 * A render crash RETIRES this seat: the slot runtime abdicates a shadowing
			 * entry on the first render error, which hands the composer back to the
			 * shipped two-level menu and silently drops the search box. Normalize every
			 * field the render reads so a partial store snapshot degrades instead of
			 * throwing.
			 */
			const state = React.useMemo(() => {
				if (rawState !== null && rawState !== void 0 && Array.isArray(rawState.groups) && Array.isArray(rawState.failures)) return rawState;
				return {
					current: rawState?.current ?? null,
					status: rawState?.status ?? "idle",
					error: rawState?.error ?? null,
					groups: Array.isArray(rawState?.groups) ? rawState.groups : [],
					failures: Array.isArray(rawState?.failures) ? rawState.failures : [],
				};
			}, [rawState]);
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
			const rawReasoning = currentChoice?.model.reasoning;
			const reasoning = rawReasoning === void 0 || rawReasoning === null ? void 0 : (Array.isArray(rawReasoning.efforts) ? rawReasoning : { ...rawReasoning, efforts: [] });
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
				/*
				 * The search field is the point of this pane, so it takes focus as soon
				 * as the model list is on screen - but only once its position has been
				 * measured, and never while the field is already focused (a fresh focus()
				 * on every render would fight the user's selection).
				 */
				if (document.activeElement !== searchRef.current) searchRef.current?.focus();
			}, [open, pane, menuPos]);

			if (!available) return null;

			const show = () => {
				setPane("root");
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
					if (query !== "") {
						setQuery("");
					} else if (pane !== "root") {
						setPane("root");
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
			/*
			 * Root level, mirroring the shipped seat: one "Model" cell (the current
			 * model, drilling into the searchable list) and, when the model exposes
			 * levels, one "Effort" cell. The search field belongs to the MODEL pane, so
			 * it sits directly over the model options it filters instead of above the
			 * Model/Effort rows.
			 */
			const rootPane = [];
			rootPane.push(React.createElement("button", {
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
			if (reasoning !== void 0) rootPane.push(React.createElement("button", {
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
			const modelPane = [];
			modelPane.push(searchField);
			if (state.status === "loading") modelPane.push(React.createElement("div", { className: "dshk-status", key: "loading" }, [
				React.createElement("div", { key: "text" }, t("status.loading")),
				/*
				 * Surface what the directory actually reports. The composer seat is the one
				 * place a user can read, and a loading row with no reason is exactly the
				 * report this exists to prevent: a pending catalog (status=loading) and a
				 * missing projection (status=idle) are different bugs.
				 */
				React.createElement("div", { key: "why", className: "dshk-statusWhy" }, summarizeSeatSnapshot(state)),
			]));
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
			/*
			 * Any settled status with no rows must still say something: matching only
			 * "ready" left the menu showing a bare search box over nothing when the
			 * directory reported "idle" or "error".
			 */
			if (needle === "" && state.status !== "loading" && choices.length === 0) modelPane.push(React.createElement("div", {
				className: state.error === null ? "dshk-empty" : "dshk-error",
				key: "empty",
			}, state.error === null ? t("empty.models") : t("loadFailed", { message: state.error })));

			const panes = [];
			if (pane === "root") {
				panes.push(...rootPane);
			} else if (pane === "effort") {
				/*
				 * Back returns to the ROOT rows, not straight to the model list: with the
				 * shipped two-level shape restored, "back" means one level up.
				 */
				panes.push(React.createElement("button", {
					ref: itemRef(),
					type: "button",
					role: "menuitem",
					className: "dshk-cell",
					key: "back",
					onClick: () => setPane("root"),
				}, [
					React.createElement("span", { className: "dshk-cellLabel", key: "l" }, t("menu.back")),
					React.createElement("span", { className: "dshk-cellValue", key: "v" }, t("menu.effort")),
				]));
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
			} else {
				panes.push(...modelPane);
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
			"menu.back": "返回",
			"searchPlaceholder": "搜索模型…",
			"searchEmpty": "没有匹配的模型",
			"searchClear": "清除搜索",
			"effort.providerDefault": "供应商默认",
			"status.loading": "正在加载模型列表…",
			"empty.models": "没有可用的模型",
			"loadFailed": "模型列表加载失败：{message}",
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
			"menu.back": "Back",
			"searchPlaceholder": "Search models…",
			"searchEmpty": "No matching model",
			"searchClear": "Clear search",
			"effort.providerDefault": "Provider default",
			"status.loading": "Loading models…",
			"empty.models": "No model available",
			"loadFailed": "Could not load models: {message}",
			"empty.efforts": "This model exposes no effort levels",
			"retry": "Retry",
			"warning.groupLoad": "{name} failed to load: {message}",
		};

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
		 * `remote.session` is load-bearing even though this plugin never calls it:
		 * `modelDirectories` is a cordis Service whose tracker rebinds `this.ctx` to
		 * the CALLING context, so `directoryFor()` resolves `this.ctx.remote.session`
		 * through THIS fiber. Omitting it makes every call throw, which surfaces as a
		 * model list that never leaves its loading row.
		 *
		 * `workspaces` and `shortcuts` are deliberately NOT listed here. Both are
		 * injected lazily via `ctx.inject([...], ...)` inside `apply`, so a carrier
		 * without them still gets the settings page, the permissions panel, and the
		 * model seat instead of the whole plugin waiting forever for a service that
		 * never arrives.
		 *
		 * The difference between the two gates is not cosmetic. A name in THIS array
		 * is a hard requirement: cordis leaves the plugin PENDING forever when it is
		 * missing. A nested `ctx.inject` is a soft one: the callback simply never
		 * runs, and the feature that depends on it degrades. `workspaces` is
		 * genuinely optional here — the archive set only REFINES the permissions
		 * panel, and `useArchivedIds()` already fails open to an empty set — so it
		 * must not be able to take the whole plugin down with it.
		 */
		const inject = [
			"locale",
			"remote",
			"remote.commands",
			"remote.session",
			"remote.settings",
			"remote.permissionPresets",
			"sessions",
			"slots",
		];

		/**
		 * Client plugin body: dictionaries + stylesheet, the settings page, the
		 * official shortcut commands, the permissions panel, and the searchable model
		 * seat (itself gated behind the model-search sub-plugin switch).
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "hotkey-toolkit: dictionaries");
			ctx.effect(() => installStyles(), "hotkey-toolkit: styles");
			ctx.effect(() => ctx.locale.register(SEAT_NS, { zh: seatZh, en: seatEn }), "hotkey-toolkit: seat dictionaries");
			translate = ctx.locale.bind(NS);

			/*
			 * The Desktop settings form is resolved ONCE here so its disposer belongs to
			 * this plugin's fiber; resolving per keystroke would leak a form on every
			 * shortcut.
			 *
			 * Resolved only when the Desktop shell is carrying this page: `dsh-desktop`
			 * is a Desktop-owned namespace, and a browser carrier serves no settings row
			 * for it. `switchMode` refuses without a form, so the failure stays local to
			 * the Desktop-only action instead of breaking activation.
			 *
			 * NOTE ON THE API. DSH 0.1.7 removed `ctx.settingsScope` outright — there is
			 * no compatibility shim, and a nested `ctx.inject(['settingsScope'], …)`
			 * does not fail activation, it simply NEVER FIRES. That is a silent
			 * failure: the panel renders, every callback is wired to `null`, and the
			 * feature looks broken rather than absent. The supported surface is
			 * `ctx.configForms.get(entryId)`, so that is what is used here.
			 */
			let modeForm = null;
			if (hasDesktopHost()) {
				ctx.inject(["configForms"], (scope) => {
					try {
						modeForm = scope.configForms.get(DESKTOP_NS);
					} catch (cause) {
						reportPanelFailure("configForms.get(" + DESKTOP_NS + ")", cause);
					}
				});
			}

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

			/*
			 * The Workspace registry, for the archive set.
			 *
			 * Archiving is the user saying "this session is done". An archived session
			 * runs no model step (the Host's own archived-session gate refuses them), so
			 * offering a permission switch for it would be a control that cannot do
			 * anything — the /permission command has no effect on work that never runs.
			 * The panel therefore lists active sessions only and reports how many were
			 * skipped, rather than silently hiding them.
			 *
			 * Bound here rather than read per render so the snapshot subscription belongs
			 * to this plugin's fiber.
			 */
			ctx.inject(["workspaces"], (scope) => {
				workspacesRef = scope.workspaces;
			});

			ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "hotkey-toolkit",
				order: 60,
				label: () => translate("nav"),
				locale: NS,
			}, SettingsSection)), "hotkey-toolkit: settings page");

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
							console.error("hotkey-toolkit: could not register shortcut " + id, cause);
							notify(text("actionFailed") + describe(cause));
							return () => {};
						}
					}, "hotkey-toolkit: command " + id);
				};

				/*
				 * Refresh interface — NO default binding, by design.
				 *
				 * `Ctrl+R` is already the official `page.refresh` (ui-sidebar-right), and
				 * its Web twin owns `Ctrl+Alt+R`. Declaring either here would throw
				 * `Conflicting shortcut defaults` and, worse, would mean two commands
				 * fighting over one key. The row still appears in the official dialog and
				 * the user binds it there; `test/binding-audit.cjs` pins this decision.
				 */
				contribute(COMMAND_REFRESH, "refresh", {
					labelKey: "cmdRefresh",
					aliases: [translate("cmdAliasRefresh"), "refresh", "reload"],
					defaults: {},
					regions: ["page", "editable", "terminal"],
					modals: ["settings", "shortcuts"],
					resolve: () => ({ status: "handled", run: () => {
						refreshInterface().catch((cause) => notify(text("actionFailed") + describe(cause)));
					} }),
				});

				/*
				 * Restart DSH — Desktop-only.
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

				/* The three window-mode switches, Desktop-only for the same reasons. */
				for (const mode of MODE_IDS) {
					contribute(COMMAND_MODE[mode], mode, {
						labelKey: "cmdMode" + mode.charAt(0).toUpperCase() + mode.slice(1),
						aliases: [translate("cmdAliasMode"), mode],
						defaults: desktopBindingsFor(mode),
						regions: ["page", "editable", "terminal"],
						modals: ["settings", "shortcuts"],
						resolve: () => {
							if (!hasDesktopHost()) return { status: "blocked", reason: text("desktopOnly") };
							/* Already in this mode: nothing to do, but do not consume the key. */
							if (currentMode() === mode) return { status: "pass" };
							/*
							 * The form is resolved lazily and may be absent when the Desktop
							 * settings surface is unavailable; report rather than throw.
							 */
							if (modeForm === null || modeForm === void 0) return { status: "blocked", reason: text("scopeUnavailable") };
							const form = modeForm;
							return { status: "handled", run: () => {
								switchMode(form, mode).catch((cause) => notify(text("modeFailed") + describe(cause)));
							} };
						},
					});
				}
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
				/* The catalog is independent of the settings read; a failure here is
				 * reported on its own so one bad transport does not mask the other. */
				await this.loadCatalog();
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
				const value = raw !== null && typeof raw === "object" ? raw.defaultPreset : void 0;
				if (typeof value !== "string") {
					this.fail(new Error("permission settings has no defaultPreset value"));
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
		 * The real `defaultPreset` schema is `z.string().volatile()` — no enum — so
		 * this usually yields nothing beyond the current value. It is kept because a
		 * deployment MAY constrain the field to a union of consts, in which case the
		 * schema is a better answer than a hardcoded list. Absent the service, the
		 * plugin simply keeps its built-in fallback.
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
			const { t, title, subtitle, tags, value, options, disabled, onSwitch, selectable, selected, onToggle } = props;
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
			React.useEffect(() => {
				for (const id of sessions.ids) {
					const summary = sessions.byId[id];
					if (summary === void 0 || summary.parentId !== void 0) continue;
					if (archivedIds.has(id)) continue;
					if (summary.projectionValues !== void 0 && summary.projectionValues.permissions !== void 0) continue;
					ensureProjections(id);
				}
			}, [sessionKey, archivedIds]);

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
								if (sessionsRef !== null) sessionsRef.refresh().catch(() => {});
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
		}, PermissionsSection)), "hotkey-toolkit: permissions panel");
		/*
		 * Model search — a TOGGLEABLE sub-plugin.
		 *
		 * The seat shadows the official `conversation.input.model` cell with a
		 * searchable menu. That is a real trade (the official menu is replaced
		 * wholesale), so it is the user's call, not an unconditional takeover.
		 *
		 * Mechanism. `slots.inject()` returns a disposer, and the dynamic facade
		 * assigns a page-local priority LOWER than every shipped entry, so a
		 * registration into this single cell wins it automatically — no `priority`
		 * needed (passing one would be overwritten anyway). Registering installs the
		 * seat; disposing it retires the seat and the official ModelSelect re-renders
		 * in the same cell, because the cell falls to its next live survivor.
		 *
		 * A disposed `slots.inject` handle cannot be re-armed, so the toggle re-arms by
		 * calling `slots.inject` again. The preference is read on every flip and also
		 * subscribed to, so the switch in 设置 → 插件 takes effect immediately.
		 *
		 * Failing safe: if the seat ever crashes, the slot runtime abdicates it and the
		 * official menu returns on its own — the same end state as turning the switch
		 * off. This is why the seat is a sub-plugin at all.
		 */
		ctx.inject(["slots", "modelDirectories", "sessions"], (scope) => {
			const models = scope.modelDirectories;
			const sessions = scope.sessions;
			/** The live seat registration's disposer, or null while the seat is retired. */
			let seatOff = null;
			/** Register the seat. Safe to call only while no registration is live. */
			const mountSeat = () => {
				seatOff = scope.slots.inject("conversation.input.model", () => scope.slots.register({
					name: "conversation.input.model",
					locale: SEAT_NS,
					inject: (sessionId) => {
						/*
						 * directoryFor throws for a session whose scope/binding is not resolved
						 * yet (cold boot, session restore). Letting that escape would crash the
						 * entry and abdicate the seat, so degrade to a read-only face instead.
						 */
						/*
						 * `available` defaults to true: it may only become false when this is
						 * positively an addressed subagent session. The seat renders null when
						 * unavailable, so reporting false on an unexpected error would delete the
						 * composer button outright.
						 *
						 * The directory is resolved LAZILY, never here. This face is computed once per
						 * binding, so calling directoryFor() now would throw during cold boot and pin an
						 * empty directory for the whole session.
						 */
						let available = true;
						try {
							available = sessions.subagentAddress(sessionId) === void 0;
						} catch (error) {
							reportSeatFailure("sessions.subagentAddress", error);
						}
						const lazy = createLazyDirectory(() => models.directoryFor(sessionId));
						return {
							available,
							directory: lazy.store,
							load: () => {
								if (available) lazy.load();
							},
							select: (selection) => available ? lazy.select(selection) : Promise.resolve(false),
						};
					},
				}, ModelSelect));
			};
			/** Retire the seat, handing the cell back to the official menu. */
			const unmountSeat = () => {
				if (seatOff === null) return;
				const off = seatOff;
				seatOff = null;
				off();
			};
			/** Bring the live seat in line with the stored preference. */
			const syncSeat = () => {
				const wanted = configStore.getSnapshot().modelSearch;
				if (wanted && seatOff === null) mountSeat();
				else if (!wanted && seatOff !== null) unmountSeat();
			};
			/* Apply the stored preference now, then follow every later flip. */
			syncSeat();
			scope.effect(() => configStore.subscribe(syncSeat), "hotkey-toolkit: model-search switch");
			/* Release the seat with the plugin fiber even if the switch is left on. */
			scope.effect(() => () => { unmountSeat(); }, "hotkey-toolkit: model-search seat teardown");
		});
	}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
