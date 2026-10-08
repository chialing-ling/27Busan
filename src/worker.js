export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 測試 D1 是否連線
    if (url.pathname === "/api/test") {
      const row = await env.DB
        .prepare("SELECT COUNT(*) AS count FROM places")
        .first();

      return Response.json({
        ok: true,
        places: row.count
      });
    }

    // 取得地點清單
    if (url.pathname === "/api/places" && request.method === "GET") {
      const type = url.searchParams.get("type");

      let query = `
        SELECT *
        FROM places
      `;

      const params = [];

      if (type) {
        query += ` WHERE type = ?`;
        params.push(type);
      }

      query += ` ORDER BY id ASC`;

      const stmt = env.DB.prepare(query);
      const result = params.length
        ? await stmt.bind(...params).all()
        : await stmt.all();

      return Response.json({
        ok: true,
        data: result.results
      });
    }

    return env.ASSETS.fetch(request);
  }
};
