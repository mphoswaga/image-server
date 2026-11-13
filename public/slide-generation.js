(function (root) {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const interrupted = () =>
    new Error(
      "The connection was interrupted while preparing your slides. Your lesson plan is unchanged. Click create slides again to reconnect.",
    );
  function sorted(value) {
    if (Array.isArray(value)) return value.map(sorted);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, sorted(value[key])]),
      );
    return value;
  }
  async function request(url, options) {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        if (response.redirected || response.status === 401)
          throw new Error("Please sign in again before creating slides.");
        throw interrupted();
      }
      if (response.status >= 500 && !data.jobId) throw interrupted();
      return { response, data };
    } finally {
      clearTimeout(timer);
    }
  }
  async function generate(body, onProgress = () => {}) {
    body = JSON.parse(JSON.stringify(body));
    const bytes = new TextEncoder().encode(JSON.stringify(sorted(body)));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const storageKey =
      "lc-slide-request-" +
      Array.from(new Uint8Array(digest), (n) =>
        n.toString(16).padStart(2, "0"),
      ).join("");
    let id;
    try {
      id = sessionStorage.getItem(storageKey);
    } catch {}
    id ||= crypto.randomUUID();
    try {
      sessionStorage.setItem(storageKey, id);
    } catch {}
    const forget = () => {
      try {
        sessionStorage.removeItem(storageKey);
      } catch {}
    };
    const started = Date.now();
    onProgress("Preparing your slides…");
    let reply;
    // A retry repeats the same receipt ID. It never starts a second paid job.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        reply = await request("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...body,
            background: true,
            generationRequestId: id,
          }),
        });
        break;
      } catch (error) {
        if (error.message.includes("sign in")) {
          forget();
          throw error;
        }
        if (attempt === 2) throw interrupted();
        onProgress("Reconnecting to your slide request…");
        await wait(2000);
      }
    }
    // Older clients/tests and immediate validation responses retain their contract.
    if (!reply.data.jobId) {
      forget();
      return reply;
    }
    let job = reply.data,
      failures = 0;
    while (job.status === "running") {
      if (Date.now() - started > 30 * 60 * 1000) throw interrupted();
      onProgress(
        Date.now() - started > 45000
          ? "Still preparing your slides. Longer lessons can take a few minutes…"
          : "Preparing your slides…",
      );
      await wait(Math.max(1000, Math.min(5000, job.pollAfterMs || 2000)));
      try {
        const polled = await request(
          "/api/generate/jobs/" + encodeURIComponent(job.jobId),
          { cache: "no-store" },
        );
        if (!polled.response.ok) {
          if ([401, 403, 404].includes(polled.response.status)) {
            forget();
            return polled;
          }
          throw interrupted();
        }
        if (!polled.data.jobId) throw interrupted();
        job = polled.data;
        failures = 0;
      } catch (error) {
        if (error.message.includes("sign in")) {
          forget();
          throw error;
        }
        if (++failures >= 8) throw interrupted();
        onProgress("Reconnecting… your slide request is still running.");
      }
    }
    forget();
    const status = job.httpStatus || 500;
    return {
      response: { status, ok: status >= 200 && status < 300 },
      data: job.result || {
        error: "Slides could not be prepared. Please try again.",
      },
    };
  }
  root.SlideGeneration = { generate };
})(window);
