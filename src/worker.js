export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 測試 D1
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

      // 轉成目前 index.html 原本使用的欄位格式
      const data = result.results.map(row => ({
        id: row.id,
        type: row.type,

        name: row.name,
        area: row.area,
        platform: row.platform,

        bookingUrl: row.url,
        mapUrl: row.map_url,

        lat: row.lat,
        lng: row.lng,

        rating: row.rating,
        ratingMax: row.rating_max,
        reviewCount: row.review_count,

        totalPrice: row.total_price,

        bedrooms: row.bedrooms,
        bedDescription: row.bed_description,

        hasKitchen:
          row.has_kitchen == null ? null : Boolean(row.has_kitchen),

        hasLivingRoom:
          row.has_living_room == null ? null : Boolean(row.has_living_room),

        hasElevator:
          row.has_elevator == null ? null : Boolean(row.has_elevator),

        cancelPolicy: row.cancel_policy,
        note: row.note,

        image: row.image_url || "",
        images: []
      }));

      return Response.json({
        ok: true,
        data
      });
    }

    return env.ASSETS.fetch(request);
  }
};
