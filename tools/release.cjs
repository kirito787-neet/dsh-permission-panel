#!/usr/bin/env node
/**
 * 一次发版的本地入口：
 *
 *   node tools/release.cjs patch     # 3.2.0 -> 3.2.1
 *   node tools/release.cjs minor     # 3.2.0 -> 3.3.0
 *   node tools/release.cjs major     # 3.2.0 -> 4.0.0
 *   node tools/release.cjs 3.4.1     # 指定确切版本
 *   node tools/release.cjs patch --dry-run
 *
 * 它只做「本地这一半」：改版本号、跑全套测试、提交、打 tag。
 * 真正的发布由 .github/workflows/release.yml 在 tag 推上去之后完成——
 * 那里会再跑一遍测试，然后 npm publish 并创建 GitHub Release。
 *
 * 为什么不在这里直接 npm publish：发布凭据只该存在两个地方——CI 的
 * NPM_TOKEN secret，或者你本人的登录态。把 token 摊在本地脚本的参数里，
 * 它就会出现在 shell 历史、日志和任何一次录屏里。
 */

const { spawnSync } = require("node:child_process");
const { readFileSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");

const ROOT = join(__dirname, "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const target = args.find((arg) => !arg.startsWith("--"));

if (target === void 0) {
	console.error("用法: node tools/release.cjs <patch|minor|major|x.y.z> [--dry-run]");
	process.exit(1);
}

const GIT_PROXY = process.env.DSH_RELEASE_PROXY ?? "";

/** 给 git 加上代理（本机 git 读不到 Windows 系统代理时用 DSH_RELEASE_PROXY 指定）。 */
function gitArgs(list) {
	return GIT_PROXY === "" ? list : ["-c", "http.proxy=" + GIT_PROXY, ...list];
}

/** 在仓库根目录跑一条命令，失败即整体退出。 */
function run(command, commandArgs, options = {}) {
	const shown = [command, ...commandArgs].join(" ");
	if (dryRun && options.mutates === true) {
		console.log("[dry-run] " + shown);
		return;
	}
	console.log("$ " + shown);
	const result = spawnSync(command, commandArgs, {
		cwd: ROOT,
		encoding: "utf8",
		shell: process.platform === "win32",
		stdio: options.capture === true ? ["ignore", "pipe", "pipe"] : "inherit",
	});
	if (result.status !== 0) {
		if (options.capture === true) {
			process.stderr.write((result.stdout ?? "") + (result.stderr ?? ""));
		}
		console.error("命令失败，已停止: " + shown);
		process.exit(result.status ?? 1);
	}
}

/** 读取一条命令的标准输出（用于问 git 状态）。 */
function capture(command, commandArgs) {
	const result = spawnSync(command, commandArgs, {
		cwd: ROOT,
		encoding: "utf8",
		shell: process.platform === "win32",
	});
	if (result.status !== 0) {
		console.error("命令失败: " + [command, ...commandArgs].join(" ") + "\n" + (result.stderr ?? ""));
		process.exit(result.status ?? 1);
	}
	return (result.stdout ?? "").trim();
}

/** 把 patch/minor/major/x.y.z 解析成一个具体的版本号。 */
function nextVersion(current, spec) {
	if (/^\d+\.\d+\.\d+$/u.test(spec)) {
		if (spec === current) {
			console.error("新版本号与当前版本相同: " + current);
			process.exit(1);
		}
		return spec;
	}
	const [major, minor, patch] = current.split(".").map((part) => Number.parseInt(part, 10));
	if (spec === "major") return `${major + 1}.0.0`;
	if (spec === "minor") return `${major}.${minor + 1}.0`;
	if (spec === "patch") return `${major}.${minor}.${patch + 1}`;
	console.error("不认识的版本参数: " + spec + "（只接受 patch / minor / major / x.y.z）");
	process.exit(1);
}

const packagePath = join(ROOT, "package.json");
const source = readFileSync(packagePath, "utf8");
const manifest = JSON.parse(source);
const current = manifest.version;
const version = nextVersion(current, target);
const tag = "v" + version;

// ---- 前置检查：发版过程中出任何意外，都会留下一个半成品版本号 -----------------

const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== "master") {
	console.error("发版必须在 master 上进行，当前在 " + branch + "。");
	process.exit(1);
}

const dirty = capture("git", ["status", "--porcelain"]);
if (dirty !== "") {
	console.error("工作树不干净，先提交或收起这些改动：\n" + dirty);
	process.exit(1);
}

// 本地落后于远端时打出的 tag 会指向一个别人拉不到的提交。
run("git", gitArgs(["fetch", "origin", "master"]));
const behind = capture("git", ["rev-list", "--count", "HEAD..origin/master"]);
if (behind !== "0") {
	console.error("本地 master 落后 origin/master " + behind + " 个提交，先 git pull。");
	process.exit(1);
}

const existing = spawnSync("git", ["rev-parse", "-q", "--verify", "refs/tags/" + tag], {
	cwd: ROOT,
	encoding: "utf8",
	shell: process.platform === "win32",
});
if (existing.status === 0) {
	console.error("tag 已存在: " + tag);
	process.exit(1);
}

// ---- 改版本、跑测试、提交、打 tag -------------------------------------------

console.log(`\n发版 ${current} -> ${version}\n`);
manifest.version = version;
// 保留原有的缩进：package.json 是手写文件，重排整个文件会让 diff 变成噪音。
writeFileSync(packagePath, JSON.stringify(manifest, void 0, 2) + "\n");

// 版本号先改再测：测试里若有断言版本号的用例，应该先看到真实的失败。
run("npm", ["test"]);

run("git", gitArgs(["add", "package.json"]), { mutates: true });
run("git", gitArgs(["commit", "-m", `chore(release): ${tag}`]), { mutates: true });
run("git", gitArgs(["tag", "-a", tag, "-m", tag]), { mutates: true });

console.log(`
版本号已改好，测试已通过，tag ${tag} 已在本地创建。
要真正发布，推上去：

    git push origin master --follow-tags

推完之后 GitHub Actions 会跑测试、发布到 npm、并创建 GitHub Release。
看进度：gh run watch
`);
