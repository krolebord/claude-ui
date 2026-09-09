import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import simpleGit from "simple-git";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectGitService } from "../../src/main/project-git-service";
import { defineProjectState } from "../../src/main/project-service";

describe("selected changes with real Git", () => {
  let repo: string;
  let git: ReturnType<typeof simpleGit>;
  let service: ProjectGitService;

  beforeEach(async () => {
    vi.stubEnv("PAGER", undefined);
    vi.stubEnv("GIT_PAGER", undefined);
    repo = await mkdtemp("/var/tmp/agent-ui-git-");
    git = simpleGit({
      baseDir: repo,
      unsafe: { allowUnsafeHooksPath: true },
    });
    await git.init();
    await git.addConfig("user.name", "Test");
    await git.addConfig("user.email", "test@example.com");
    await git.addConfig("commit.gpgsign", "false");
    await git.addConfig("core.hooksPath", "/dev/null");
    for (const name of [
      "removed file.md",
      "unstaged.md",
      "modified.md",
      "unrelated.md",
    ]) {
      await writeFile(path.join(repo, name), `original ${name}\n`);
    }
    await git.add(".");
    await git.commit("Initial files");
    service = new ProjectGitService(defineProjectState());
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(repo, { recursive: true, force: true });
  });

  it.each([false, true])("commits a deletion, staged=%s", async (staged) => {
    await rm(path.join(repo, "removed file.md"));
    if (staged) await git.add(["removed file.md"]);
    const indexBefore = await readFile(path.join(repo, ".git/index"));

    const diff = await service.getSelectedChangesDiff(repo, [
      "removed file.md",
    ]);
    expect(diff).toContain("deleted file mode");
    expect(await readFile(path.join(repo, ".git/index"))).toEqual(indexBefore);

    await service.commitSelectedChanges(repo, {
      paths: ["removed file.md"],
      subject: "Delete file",
    });
    expect(await git.raw(["show", "--format=", "--name-status", "HEAD"])).toBe(
      "D\tremoved file.md\n",
    );
    expect((await git.status()).isClean()).toBe(true);
  });

  it("commits mixed selections and preserves unrelated staged changes", async () => {
    await rm(path.join(repo, "removed file.md"));
    await writeFile(path.join(repo, "unrelated.md"), "unrelated staged edit\n");
    await git.add(["removed file.md", "unrelated.md"]);
    await rm(path.join(repo, "unstaged.md"));
    await writeFile(path.join(repo, "modified.md"), "selected edit\n");
    await writeFile(path.join(repo, "new.md"), "selected new file\n");
    const paths = ["removed file.md", "unstaged.md", "modified.md", "new.md"];
    const indexBefore = await readFile(path.join(repo, ".git/index"));

    const diff = await service.getSelectedChangesDiff(repo, paths);
    for (const name of paths) expect(diff).toContain(name);
    expect(diff).not.toContain("unrelated.md");
    expect(await readFile(path.join(repo, ".git/index"))).toEqual(indexBefore);

    await service.commitSelectedChanges(repo, {
      paths,
      subject: "Selected changes",
    });
    expect(await git.raw(["show", "--format=", "--name-status", "HEAD"])).toBe(
      "M\tmodified.md\nA\tnew.md\nD\tremoved file.md\nD\tunstaged.md\n",
    );
    expect(await git.raw(["diff", "--cached", "--name-only"])).toBe(
      "unrelated.md\n",
    );
    expect(await git.raw(["show", "HEAD:unrelated.md"])).toBe(
      "original unrelated.md\n",
    );
  });

  it("stages a file recreated after its deletion was staged", async () => {
    await rm(path.join(repo, "removed file.md"));
    await git.add(["removed file.md"]);
    await writeFile(
      path.join(repo, "removed file.md"),
      "replacement contents\n",
    );

    const diff = await service.getSelectedChangesDiff(repo, [
      "removed file.md",
    ]);
    expect(diff).toContain("+replacement contents");
    expect(diff).not.toContain("deleted file mode");
    await service.commitSelectedChanges(repo, {
      paths: ["removed file.md"],
      subject: "Replace file",
    });
    expect(await git.raw(["show", "HEAD:removed file.md"])).toBe(
      "replacement contents\n",
    );
    expect((await git.status()).isClean()).toBe(true);
  });

  it("commits a staged rename with further working-tree edits", async () => {
    await git.mv("removed file.md", "renamed.md");
    await writeFile(
      path.join(repo, "renamed.md"),
      "updated renamed contents\n",
    );
    const paths = ["removed file.md", "renamed.md"];

    const diff = await service.getSelectedChangesDiff(repo, paths);
    expect(diff).toContain("+updated renamed contents");
    await service.commitSelectedChanges(repo, {
      paths,
      subject: "Rename and edit",
    });
    expect(await git.raw(["show", "HEAD:renamed.md"])).toBe(
      "updated renamed contents\n",
    );
    expect(await git.raw(["ls-tree", "--name-only", "HEAD"])).not.toContain(
      "removed file.md",
    );
    expect((await git.status()).isClean()).toBe(true);
  });
});
