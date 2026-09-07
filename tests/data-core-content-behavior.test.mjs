import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { Miniflare } from "miniflare";

const ORGANIZATION_ID = "org-hi5-anihi";
const CAMPUS_A = "campus-anihi-admission";
const CAMPUS_B = "campus-design-admission";

const users = {
  admin: { id: "admin", email: "admin@example.test", name: "Admin" },
  a: { id: "user-a", email: "a@example.test", name: "User A" },
  b: { id: "user-b", email: "b@example.test", name: "User B" },
};

function authHeaders(user) {
  return {
    "oai-authenticated-user-id": user.id,
    "oai-authenticated-user-email": user.email,
    "oai-authenticated-user-full-name": encodeURIComponent(user.name),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
}

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("behavior", `${process.pid}-${Date.now()}`);
  const mod = await import(workerUrl.href);
  return mod.default;
}

function contentTypeFor(pathname) {
  const ext = extname(pathname);
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function createAssetsBinding() {
  return {
    async fetch(request) {
      const pathname = new URL(request.url).pathname;
      const safePath = pathname.replace(/^\/+/, "");
      try {
        const body = await readFile(join(process.cwd(), "public", safePath));
        return new Response(body, {
          headers: { "content-type": contentTypeFor(pathname) },
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },
  };
}

async function createHarness() {
  const mf = new Miniflare({
    script: "export default { fetch() { return new Response('ok'); } }",
    modules: true,
    d1Databases: ["DB"],
    d1Persist: false,
    r2Buckets: ["FILES"],
    r2Persist: false,
  });
  const worker = await loadWorker();
  const env = {
    DB: await mf.getD1Database("DB"),
    FILES: await mf.getR2Bucket("FILES"),
    ASSETS: createAssetsBinding(),
    DATA_CORE_SUPER_ADMIN_EMAILS: users.admin.email,
  };

  async function request(method, pathname, user, body) {
    const headers = new Headers(user ? authHeaders(user) : undefined);
    let requestBody;
    if (body !== undefined) {
      headers.set("content-type", "application/json");
      requestBody = JSON.stringify(body);
    }
    const response = await worker.fetch(
      new Request(`http://localhost${pathname}`, { method, headers, body: requestBody }),
      env,
      { waitUntil() {}, passThroughOnException() {} },
    );
    const type = response.headers.get("content-type") || "";
    const parsed = type.includes("application/json")
      ? await response.json()
      : await response.text();
    return { response, body: parsed };
  }

  async function seedMembership(user, campusId, role = "TEACHER") {
    await request("GET", "/api/data-core/context", user);
    const now = new Date().toISOString();
    await env.DB
      .prepare(
        `INSERT INTO memberships (
           id, organization_id, campus_id, user_id, role, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        `membership:${user.id}:${campusId}:${role}`,
        ORGANIZATION_ID,
        campusId,
        `oai:${user.id}`,
        role,
        now,
        now,
      )
      .run();
  }

  async function seedFile({ id, campusId, ownerUserId, visibility = "campus" }) {
    const now = new Date().toISOString();
    await env.DB
      .prepare(
        `INSERT INTO file_objects (
           id, organization_id, campus_id, data_record_id, owner_user_id,
           area, category, source_app, r2_key, original_file_name, mime_type,
           size_bytes, visibility, created_at, deleted_at
         ) VALUES (?, ?, ?, NULL, ?, 'academy-public', 'student-artwork', 'data-core',
           ?, ?, 'image/png', 128, ?, ?, NULL)`,
      )
      .bind(
        id,
        ORGANIZATION_ID,
        campusId,
        ownerUserId ? `oai:${ownerUserId}` : null,
        `data-core/test/${id}.png`,
        `${id}.png`,
        visibility,
        now,
      )
      .run();
  }

  async function createDraft(user, payload) {
    const result = await request("POST", "/api/data-core/content", user, payload);
    assert.equal(result.response.status, 201, JSON.stringify(result.body));
    return result.body.draft;
  }

  await request("GET", "/api/data-core/context", users.admin);
  await seedMembership(users.a, CAMPUS_A);
  await seedMembership(users.b, CAMPUS_A);
  await seedMembership(users.b, CAMPUS_B);
  await seedFile({ id: "file-shared", campusId: CAMPUS_A, ownerUserId: users.a.id, visibility: "campus" });
  await seedFile({ id: "file-private-b", campusId: CAMPUS_A, ownerUserId: users.b.id, visibility: "private" });
  await seedFile({ id: "file-other-campus", campusId: CAMPUS_B, ownerUserId: users.b.id, visibility: "public" });

  return { mf, env, request, createDraft };
}

test("content API enforces draft lifecycle, file reuse, filters, and permissions", async () => {
  const h = await createHarness();
  try {
    const blog = await h.createDraft(users.a, {
      campusId: CAMPUS_A,
      sourceApp: "blog",
      title: "Blog draft",
      summary: "first",
      content: "blog body",
      publishStatus: "draft",
      relatedFileIds: ["file-shared"],
      tags: ["class", "story"],
    });
    assert.equal(blog.recordType, "blog-draft");
    assert.equal(blog.sourceApp, "blog");
    assert.deepEqual(blog.metadata.relatedFileIds, ["file-shared"]);
    assert.equal(blog.content, "blog body");

    const fetchedBlog = await h.request("GET", `/api/data-core/content/${blog.id}`, users.a);
    assert.equal(fetchedBlog.response.status, 200);
    assert.equal(fetchedBlog.body.draft.title, "Blog draft");

    const patchedBlog = await h.request("PATCH", `/api/data-core/content/${blog.id}`, users.a, {
      campusId: CAMPUS_A,
      sourceApp: "blog",
      title: "Blog draft updated",
      content: "updated body",
      publishStatus: "ready",
      relatedFileIds: ["file-shared"],
    });
    assert.equal(patchedBlog.response.status, 200);
    assert.equal(patchedBlog.body.draft.metadata.publishStatus, "ready");
    assert.equal(patchedBlog.body.draft.content, "updated body");

    const instagram = await h.createDraft(users.a, {
      campusId: CAMPUS_A,
      sourceApp: "instagram",
      title: "Instagram draft",
      content: "caption",
      publishStatus: "review",
      relatedFileIds: ["file-shared"],
    });
    assert.equal(instagram.recordType, "instagram-draft");
    assert.equal(instagram.sourceApp, "instagram");
    assert.deepEqual(instagram.metadata.relatedFileIds, ["file-shared"]);
    assert.deepEqual(instagram.metadata.imageSpec, {
      width: 2160,
      height: 2700,
      aspectRatio: "4:5",
    });

    const patchedInstagram = await h.request(
      "PATCH",
      `/api/data-core/content/${instagram.id}`,
      users.a,
      {
        campusId: CAMPUS_A,
        sourceApp: "instagram",
        title: "Instagram draft updated",
        content: "caption updated",
        publishStatus: "ready",
        relatedFileIds: ["file-shared"],
      },
    );
    assert.equal(patchedInstagram.response.status, 200);
    assert.equal(patchedInstagram.body.draft.metadata.imageSpec.width, 2160);
    assert.equal(patchedInstagram.body.draft.metadata.imageSpec.height, 2700);
    assert.equal(patchedInstagram.body.draft.metadata.imageSpec.aspectRatio, "4:5");

    const blogList = await h.request("GET", "/api/data-core/content?sourceApp=blog", users.a);
    const instagramList = await h.request("GET", "/api/data-core/content?sourceApp=instagram", users.a);
    assert.equal(blogList.response.status, 200);
    assert.equal(instagramList.response.status, 200);
    assert.ok(blogList.body.drafts.some((draft) => draft.id === blog.id));
    assert.ok(blogList.body.drafts.every((draft) => draft.sourceApp === "blog"));
    assert.ok(instagramList.body.drafts.some((draft) => draft.id === instagram.id));
    assert.ok(instagramList.body.drafts.every((draft) => draft.sourceApp === "instagram"));

    const userBDraft = await h.createDraft(users.b, {
      campusId: CAMPUS_A,
      sourceApp: "blog",
      title: "User B draft",
      content: "owned by user b",
      relatedFileIds: ["file-shared"],
    });
    const userAPatchUserB = await h.request(
      "PATCH",
      `/api/data-core/content/${userBDraft.id}`,
      users.a,
      {
        campusId: CAMPUS_A,
        sourceApp: "blog",
        title: "take over",
      },
    );
    assert.equal(userAPatchUserB.response.status, 403);
    const userADeleteUserB = await h.request("DELETE", `/api/data-core/content/${userBDraft.id}`, users.a);
    assert.equal(userADeleteUserB.response.status, 403);

    const campusBCreate = await h.request("POST", "/api/data-core/content", users.a, {
      campusId: CAMPUS_B,
      sourceApp: "blog",
      title: "wrong campus",
      content: "not allowed",
    });
    assert.equal(campusBCreate.response.status, 403);

    const privateFileLink = await h.request("POST", "/api/data-core/content", users.a, {
      campusId: CAMPUS_A,
      sourceApp: "blog",
      title: "private file",
      relatedFileIds: ["file-private-b"],
    });
    assert.equal(privateFileLink.response.status, 403);

    const otherCampusFileLink = await h.request("POST", "/api/data-core/content", users.a, {
      campusId: CAMPUS_A,
      sourceApp: "blog",
      title: "other campus file",
      relatedFileIds: ["file-other-campus"],
    });
    assert.equal(otherCampusFileLink.response.status, 400);

    const deleteBlog = await h.request("DELETE", `/api/data-core/content/${blog.id}`, users.a);
    const deleteInstagram = await h.request("DELETE", `/api/data-core/content/${instagram.id}`, users.a);
    assert.equal(deleteBlog.response.status, 200);
    assert.equal(deleteInstagram.response.status, 200);
    assert.equal(deleteBlog.body.ok, true);
    assert.equal(deleteInstagram.body.ok, true);

    const deletedBlogFetch = await h.request("GET", `/api/data-core/content/${blog.id}`, users.a);
    const deletedInstagramFetch = await h.request("GET", `/api/data-core/content/${instagram.id}`, users.a);
    assert.equal(deletedBlogFetch.response.status, 404);
    assert.equal(deletedInstagramFetch.response.status, 404);
  } finally {
    await h.mf.dispose();
  }
});

test("smoke checks admissions, competition, roadmap, knowledge, and readiness routes", async () => {
  const h = await createHarness();
  try {
    const publicRoutes = [
      "/",
      "/admissions-web/renderer/index.html",
      "/data-core",
      "/data-core/content",
      "/data-core/content/blog",
      "/data-core/content/instagram",
      "/data-core/operations",
      "/data-core/roadmap",
      "/data-core/readiness",
    ];
    for (const route of publicRoutes) {
      const result = await h.request("GET", route, undefined);
      assert.equal(result.response.status, 200, `${route} should render`);
    }

    const health = await h.request("GET", "/api/data-core/health", undefined);
    assert.equal(health.response.status, 200);
    assert.equal(health.body.ok, true);

    const protectedApiRoutes = [
      "/api/data-core/competitions?limit=1",
      "/api/data-core/roadmap/goals",
      "/api/data-core/admin/knowledge/admissions/status",
      "/api/data-core/knowledge/nodes?limit=1",
    ];
    for (const route of protectedApiRoutes) {
      const result = await h.request("GET", route, undefined);
      assert.equal(result.response.status, 401, `${route} should reach the protected router`);
    }
  } finally {
    await h.mf.dispose();
  }
});
