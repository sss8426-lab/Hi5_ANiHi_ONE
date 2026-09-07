import dataCoreWorker from "./router";

interface Env {
  ASSETS?: Fetcher;
  DB?: D1Database;
  FILES?: R2Bucket;
  DATA_CORE_SUPER_ADMIN_EMAILS?: string;
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "GET") {
      const url = new URL(request.url);
      if (
        url.pathname === "/data-core/readiness" ||
        url.pathname === "/data-core/readiness/"
      ) {
        url.pathname = "/data-core/readiness.html";
        return dataCoreWorker.fetch(
          new Request(url.toString(), { headers: request.headers }),
          env,
        );
      }
    }
    return dataCoreWorker.fetch(request, env);
  },
};

export default worker;
