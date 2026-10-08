async function getAdminSessionToken(secret) {
  const data = new TextEncoder().encode("27busan-admin:" + secret);
  const hash = await crypto.subtle.digest("SHA-256", data);

  return [...new Uint8Array(hash)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function isAdmin(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const expected = await getAdminSessionToken(env.ADMIN_PASSWORD);

  return cookie
    .split(";")
    .map(x => x.trim())
    .some(x => x === `admin_session=${expected}`);
}

function loginPage(error = "") {
  return new Response(`
<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>27Busan｜管理員登入</title>

<style>
  *{box-sizing:border-box}

  body{
    margin:0;
    min-height:100vh;
    display:grid;
    place-items:center;
    background:#f5f7fb;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft JhengHei",Arial,sans-serif;
    color:#1f2937;
  }

  .login{
    width:min(400px,calc(100% - 32px));
    background:#fff;
    padding:28px;
    border:1px solid #dfe3ea;
    border-radius:16px;
    box-shadow:0 12px 35px rgba(15,23,42,.08);
  }

  h1{
    margin:0 0 6px;
    font-size:24px;
  }

  p{
    margin:0 0 20px;
    color:#6b7280;
    font-size:14px;
  }

  label{
    display:block;
    font-weight:700;
    font-size:13px;
    margin-bottom:6px;
  }

  input{
    width:100%;
    padding:11px 12px;
    border:1px solid #dfe3ea;
    border-radius:9px;
    font:inherit;
  }

  button{
    width:100%;
    margin-top:14px;
    padding:11px;
    border:0;
    border-radius:9px;
    background:#2563eb;
    color:#fff;
    font:inherit;
    font-weight:700;
    cursor:pointer;
  }

  .error{
    margin-bottom:14px;
    padding:9px 10px;
    background:#fef2f2;
    color:#b91c1c;
    border-radius:8px;
    font-size:13px;
  }
</style>
</head>

<body>

  <form class="login" method="POST" action="/api/admin/login">

    <h1>🏨 27Busan 後台</h1>
    <p>請輸入管理密碼</p>

    ${error ? `<div class="error">${error}</div>` : ""}

    <label>管理密碼</label>
    <input
      name="password"
      type="password"
      autocomplete="current-password"
      required
      autofocus
    >

    <button type="submit">登入</button>

  </form>

</body>
</html>
`, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // -------------------------
    // 管理員登入
    // -------------------------
    if (
      url.pathname === "/api/admin/login" &&
      request.method === "POST"
    ) {
      const form = await request.formData();
      const password = String(form.get("password") || "");

      if (password !== env.ADMIN_PASSWORD) {
        return loginPage("密碼錯誤");
      }

      const token = await getAdminSessionToken(env.ADMIN_PASSWORD);

      return new Response(null, {
        status: 303,
        headers: {
          "Location": "/admin.html",
          "Set-Cookie":
            `admin_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`
        }
      });
    }

    // -------------------------
    // 保護 admin.html
    // -------------------------
    if (
  url.pathname === "/admin" ||
  url.pathname === "/admin.html"
) {
  if (!(await isAdmin(request, env))) {
    return loginPage();
  }

  return env.ASSETS.fetch(request);
}

    // -------------------------
    // 保護未來所有 admin API
    // -------------------------
    if (url.pathname.startsWith("/api/admin/")) {
      if (!(await isAdmin(request, env))) {
        return Response.json(
          {
            ok: false,
            message: "Unauthorized"
          },
          {
            status: 401
          }
        );
      }
    }
    // -------------------------
// 新增地點
// -------------------------
if (
  url.pathname === "/api/admin/places" &&
  request.method === "POST"
) {
  try {
    const body = await request.json();

    if (!body.name || !String(body.name).trim()) {
      return Response.json(
        {
          ok: false,
          message: "名稱不能空白"
        },
        {
          status: 400
        }
      );
    }

    const emptyToNull = value => {
      if (value === undefined || value === null || value === "") {
        return null;
      }
      return value;
    };

    const numberOrNull = value => {
      if (value === undefined || value === null || value === "") {
        return null;
      }

      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };

    const boolOrNull = value => {
      if (value === undefined || value === null || value === "") {
        return null;
      }

      return value ? 1 : 0;
    };

    const result = await env.DB.prepare(`
      INSERT INTO places (
        type,
        name,
        area,
        platform,
        url,
        map_url,
        lat,
        lng,
        rating,
        rating_max,
        review_count,
        total_price,
        bedrooms,
        bed_description,
        has_kitchen,
        has_living_room,
        has_elevator,
        cancel_policy,
        note,
        image_url,
        updated_at
      )
      VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, CURRENT_TIMESTAMP
      )
    `).bind(
      body.type || "hotel",
      String(body.name).trim(),
      emptyToNull(body.area),
      emptyToNull(body.platform),

      emptyToNull(body.bookingUrl),
      emptyToNull(body.mapUrl),

      numberOrNull(body.lat),
      numberOrNull(body.lng),

      numberOrNull(body.rating),
      numberOrNull(body.ratingMax),
      numberOrNull(body.reviewCount),

      numberOrNull(body.totalPrice),

      numberOrNull(body.bedrooms),
      emptyToNull(body.bedDescription),

      boolOrNull(body.hasKitchen),
      boolOrNull(body.hasLivingRoom),
      boolOrNull(body.hasElevator),

      emptyToNull(body.cancelPolicy),
      emptyToNull(body.note),

      emptyToNull(body.image)
    ).run();

    return Response.json({
      ok: true,
      id: result.meta?.last_row_id ?? null
    });

  } catch (err) {
    return Response.json(
      {
        ok: false,
        message: err.message
      },
      {
        status: 500
      }
    );
  }
}

    // -------------------------
    // 測試 D1
    // -------------------------
    if (url.pathname === "/api/test") {
      const row = await env.DB
        .prepare("SELECT COUNT(*) AS count FROM places")
        .first();

      return Response.json({
        ok: true,
        places: row.count
      });
    }

    // -------------------------
    // 公開讀取地點資料
    // -------------------------
    if (
      url.pathname === "/api/places" &&
      request.method === "GET"
    ) {
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
          row.has_kitchen == null
            ? null
            : Boolean(row.has_kitchen),

        hasLivingRoom:
          row.has_living_room == null
            ? null
            : Boolean(row.has_living_room),

        hasElevator:
          row.has_elevator == null
            ? null
            : Boolean(row.has_elevator),

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

    // 其他檔案照常提供
    return env.ASSETS.fetch(request);
  }
};
