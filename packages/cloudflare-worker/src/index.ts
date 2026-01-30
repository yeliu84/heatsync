const TARGET_HOST = "heatsync.ai-builders.space";

export default {
  /**
   * Handle HTTP requests - proxy to backend
   */
  fetch: async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const targetUrl = new URL(url.pathname + url.search, `https://${TARGET_HOST}`);

    const modifiedRequest = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: "follow",
    });

    const response = await fetch(modifiedRequest);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  },

  /**
   * Handle cron trigger - keep backend warm
   * Runs every 4 minutes to prevent Koyeb deep sleep (5 min threshold)
   */
  scheduled: async () => {
    const response = await fetch(`https://${TARGET_HOST}/`, {
      method: "HEAD",
    });

    console.log(`Keep-alive ping: ${response.status} at ${new Date().toISOString()}`);
  },
};
